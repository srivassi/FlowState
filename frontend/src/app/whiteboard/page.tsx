'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import _dynamic from 'next/dynamic'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const PDFDocument = _dynamic(() => import('react-pdf').then(async m => {
  const { pdfjs } = m
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
  return { default: m.Document }
}), { ssr: false })

const PDFPage = _dynamic(() => import('react-pdf').then(m => ({ default: m.Page })), { ssr: false })

type Message = { role: 'user' | 'assistant'; content: string }

type StickyNote = {
  id: string
  x: number
  y: number
  width: number
  highlight_text: string | null
  page_number: number | null
  color: string
  title: string
  messages: Message[]
  parent_note_id: string | null
  minimised?: boolean
  page_id?: string
  type?: 'ai' | 'text'   // 'ai' = chat note (default), 'text' = plain text note
  content?: string        // body for text notes
}

type Section = { title: string; page: number; depth: number }

type Page = {
  id: string
  name: string
  pdf_url: string | null
  pdf_name: string | null
  sections?: Section[]
}

type Course = { id: string; name: string; color: string }

const NOTE_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FDE68A', '#F5D0FE', '#FECACA']

function renderMath(tex: string, display: boolean): React.ReactNode {
  try {
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' })
    return <span key={tex} dangerouslySetInnerHTML={{ __html: html }} />
  } catch {
    return <span>{display ? `$$${tex}$$` : `$${tex}$`}</span>
  }
}

function renderInlineContent(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Match $$...$$ (display), $...$ (inline), **...**, `...`
  const regex = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*(.+?)\*\*|`(.+?)`)/g
  let last = 0
  let match
  let key = 0
  while ((match = regex.exec(content)) !== null) {
    if (match.index > last) parts.push(<span key={key++}>{content.slice(last, match.index)}</span>)
    const m = match[0]
    if (m.startsWith('$$')) {
      parts.push(<span key={key++} style={{ display: 'block', textAlign: 'center', margin: '4px 0' }}>{renderMath(m.slice(2, -2).trim(), true)}</span>)
    } else if (m.startsWith('$')) {
      parts.push(<span key={key++}>{renderMath(m.slice(1, -1).trim(), false)}</span>)
    } else if (m.startsWith('**')) {
      parts.push(<strong key={key++}>{match[2]}</strong>)
    } else {
      parts.push(
        <code key={key++} style={{ backgroundColor: 'rgba(55,53,47,0.08)', borderRadius: 3, padding: '0 3px', fontFamily: 'monospace', fontSize: '0.9em' }}>
          {match[3]}
        </code>
      )
    }
    last = match.index + m.length
  }
  if (last < content.length) parts.push(<span key={key++}>{content.slice(last)}</span>)
  return parts
}

function renderMarkdown(text: string): React.ReactNode {
  return text.split('\n').map((line, li) => {
    const isBullet = /^[\s]*[-*•]\s/.test(line)
    const content = isBullet ? line.replace(/^[\s]*[-*•]\s/, '') : line
    return (
      <div key={li} style={isBullet ? { paddingLeft: 12, display: 'flex', gap: 4 } : {}}>
        {isBullet && <span style={{ opacity: 0.5, flexShrink: 0 }}>•</span>}
        <span>{renderInlineContent(content)}</span>
      </div>
    )
  })
}

function newNote(x: number, y: number, pageId: string, highlight?: string, type: 'ai' | 'text' = 'ai'): StickyNote {
  return {
    id: crypto.randomUUID(),
    x, y,
    width: 300,
    highlight_text: highlight || null,
    page_number: null,
    color: type === 'text' ? '#FFFFFF' : NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    title: highlight ? `"${highlight.slice(0, 40)}${highlight.length > 40 ? '…' : ''}"` : '',
    messages: [],
    parent_note_id: null,
    page_id: pageId,
    type,
    content: type === 'text' ? '' : undefined,
  }
}

export default function WhiteboardPage() {
  return (
    <Suspense>
      <WhiteboardInner />
    </Suspense>
  )
}

const PDF_OPTIONS = {
  cMapUrl: `https://unpkg.com/pdfjs-dist@4.4.168/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `https://unpkg.com/pdfjs-dist@4.4.168/standard_fonts/`,
}

function PDFViewer({ pdfUrl, numPages, pageWidth, onLoadSuccess, onLoadError, onMouseUp, onContextMenu, onDoubleClick }: {
  pdfUrl: string
  numPages: number
  pageWidth: number
  onLoadSuccess: (n: number) => void
  onLoadError: (err: Error) => void
  onMouseUp: () => void
  onContextMenu: (e: React.MouseEvent, page: number) => void
  onDoubleClick: (e: React.MouseEvent, page: number) => void
}) {
  return (
    <PDFDocument
      file={pdfUrl}
      onLoadSuccess={({ numPages: n }: { numPages: number }) => onLoadSuccess(n)}
      onLoadError={onLoadError}
      options={PDF_OPTIONS}
    >
      {Array.from({ length: numPages }, (_, i) => (
        <div key={i} id={`pdf-page-${i + 1}`} className="mb-2 shadow-md"
          onMouseUp={onMouseUp}
          onContextMenu={(e: React.MouseEvent) => onContextMenu(e, i + 1)}
          onDoubleClick={(e: React.MouseEvent) => onDoubleClick(e, i + 1)}>
          <PDFPage
            pageNumber={i + 1}
            width={pageWidth}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </div>
      ))}
    </PDFDocument>
  )
}

function WhiteboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const courseIdParam = searchParams.get('course')

  const [userId, setUserId] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourse, setSelectedCourse] = useState<string | null>(courseIdParam)

  // Pages
  const [pages, setPages] = useState<Page[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [noteMode, setNoteMode] = useState<'ai' | 'text'>('ai')
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')

  const activePage = useMemo(() => pages.find(p => p.id === activePageId) || null, [pages, activePageId])

  const [notes, setNotes] = useState<StickyNote[]>([])
  const activeNotes = useMemo(
    () => notes.filter(n => n.page_id === activePageId),
    [notes, activePageId]
  )

  const [activeNote, setActiveNote] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState<{ [noteId: string]: string }>({})
  const [loadingChat, setLoadingChat] = useState<{ [noteId: string]: boolean }>({})
  const [dragging, setDragging] = useState<{ noteId: string; offsetX: number; offsetY: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [flashcardGenStatus, setFlashcardGenStatus] = useState<null | 'generating' | 'done' | 'error'>(null)
  const [selection, setSelection] = useState<string>('')

  const [numPages, setNumPages] = useState<number>(0)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string; page: number } | null>(null)
  const [pageWidth, setPageWidth] = useState(700)
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // ── Page width ────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      if (canvasRef.current) setPageWidth(Math.min(700, canvasRef.current.clientWidth - 48))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // ── Auth ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      const c = await api.getCourses(uid).catch(() => [])
      setCourses(c)
      if (selectedCourse) loadWhiteboard(uid, selectedCourse)
    })
  }, [router])

  // ── Reset numPages/pdfError when active page changes ─────
  useEffect(() => {
    setNumPages(0)
    setPdfError(null)
  }, [activePageId])

  // ── Auto-extract sections for pages that have a PDF but no sections ──
  useEffect(() => {
    if (!activePage?.pdf_url) return
    if (activePage.sections !== undefined) return  // already extracted (even if empty array)
    api.extractSections(activePage.pdf_url)
      .then(({ sections }: { sections: any[] }) => {
        const updatedPages = pages.map(p =>
          p.id === activePage.id ? { ...p, sections } : p
        )
        setPages(updatedPages)
        scheduleSave(notes, updatedPages)
      })
      .catch(() => {
        // Mark as extracted (empty) so we don't retry
        const updatedPages = pages.map(p =>
          p.id === activePage.id ? { ...p, sections: [] } : p
        )
        setPages(updatedPages)
      })
  }, [activePage?.id, activePage?.pdf_url, activePage?.sections])

  // ── Focus rename input when editing ──────────────────────
  useEffect(() => {
    if (renamingPageId && renameInputRef.current) renameInputRef.current.focus()
  }, [renamingPageId])

  const loadWhiteboard = async (uid: string, courseId: string) => {
    const wb = await api.getWhiteboard(courseId, uid).catch(() => null)
    if (!wb) return

    const rawNotes: StickyNote[] = wb.sticky_notes || []

    if (wb.pages && Array.isArray(wb.pages) && wb.pages.length > 0) {
      // New multi-page format
      setPages(wb.pages)
      setActivePageId(wb.pages[0].id)
      setNotes(rawNotes)
    } else {
      // Legacy single-page: migrate
      const defaultPage: Page = {
        id: crypto.randomUUID(),
        name: 'Page 1',
        pdf_url: wb.pdf_url || null,
        pdf_name: wb.pdf_name || null,
      }
      setPages([defaultPage])
      setActivePageId(defaultPage.id)
      // Assign all legacy notes to this page
      setNotes(rawNotes.map((n: StickyNote) => ({ ...n, page_id: defaultPage.id })))
    }
  }

  const switchCourse = async (courseId: string) => {
    setSelectedCourse(courseId)
    setPages([])
    setActivePageId(null)
    setPdfError(null)
    setFlashcardGenStatus(null)
    setNotes([])
    if (userId) loadWhiteboard(userId, courseId)
  }

  // ── Auto-save ─────────────────────────────────────────────
  const scheduleSave = useCallback((updatedNotes: StickyNote[], updatedPages?: Page[]) => {
    if (!userId || !selectedCourse) return
    const pgs = updatedPages ?? pages
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await api.saveWhiteboard({
          course_id: selectedCourse,
          user_id: userId,
          sticky_notes: updatedNotes,
          pages: pgs,
          pdf_url: pgs[0]?.pdf_url || null,
          pdf_name: pgs[0]?.pdf_name || null,
        })
      } finally { setSaving(false) }
    }, 1500)
  }, [userId, selectedCourse, pages])

  const updateNotes = (updated: StickyNote[]) => {
    setNotes(updated)
    scheduleSave(updated)
  }

  const updatePages = (updated: Page[]) => {
    setPages(updated)
    scheduleSave(notes, updated)
  }

  // ── Page management ───────────────────────────────────────
  const addPage = () => {
    const newPage: Page = {
      id: crypto.randomUUID(),
      name: `Page ${pages.length + 1}`,
      pdf_url: null,
      pdf_name: null,
    }
    const updated = [...pages, newPage]
    updatePages(updated)
    setActivePageId(newPage.id)
    // Start renaming immediately
    setRenamingPageId(newPage.id)
    setRenameValue(newPage.name)
  }

  const deletePage = (pageId: string) => {
    if (pages.length <= 1) return
    const updated = pages.filter(p => p.id !== pageId)
    // Remove notes for this page
    const updatedNotes = notes.filter(n => n.page_id !== pageId)
    setNotes(updatedNotes)
    updatePages(updated)
    if (activePageId === pageId) setActivePageId(updated[0].id)
    scheduleSave(updatedNotes, updated)
  }

  const commitRename = () => {
    if (!renamingPageId) return
    const trimmed = renameValue.trim()
    const updated = pages.map(p => p.id === renamingPageId ? { ...p, name: trimmed || p.name } : p)
    setRenamingPageId(null)
    updatePages(updated)
  }

  // ── PDF upload ────────────────────────────────────────────
  const uploadPdf = async (file: File) => {
    if (!userId || !selectedCourse || !activePageId) return
    setSaving(true)
    setFlashcardGenStatus(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('user_id', userId)
      formData.append('course_id', selectedCourse)
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/whiteboard/upload-pdf`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert('Upload failed: ' + (e.detail || res.statusText)); return }
      const { pdf_url, pdf_name, sections } = await res.json()

      // Update the active page with the new PDF (and extracted sections)
      const updatedPages = pages.map(p => p.id === activePageId ? { ...p, pdf_url, pdf_name, sections: sections || [] } : p)
      setPages(updatedPages)

      if (saveTimer.current) clearTimeout(saveTimer.current)
      await api.saveWhiteboard({
        course_id: selectedCourse,
        user_id: userId,
        sticky_notes: notes,
        pages: updatedPages,
        pdf_url: updatedPages[0]?.pdf_url || null,
        pdf_name: updatedPages[0]?.pdf_name || null,
      })

      // Auto-generate flashcards
      setFlashcardGenStatus('generating')
      const courseName = courses.find(c => c.id === selectedCourse)?.name || 'Module'
      const setTitle = pdf_name.replace(/\.pdf$/i, '') || courseName
      const fcForm = new FormData()
      fcForm.append('file', file)
      fcForm.append('user_id', userId)
      fcForm.append('course_id', selectedCourse)
      fcForm.append('title', setTitle)
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/flashcards/generate`, { method: 'POST', body: fcForm })
        .then(r => { if (r.ok) setFlashcardGenStatus('done'); else setFlashcardGenStatus('error') })
        .catch(() => setFlashcardGenStatus('error'))
    } finally { setSaving(false) }
  }

  // ── Canvas interaction ────────────────────────────────────
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedCourse || !activePageId) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const note = newNote(e.clientX - rect.left, e.clientY - rect.top, activePageId, selection || undefined, noteMode)
    const updated = [...notes, note]
    updateNotes(updated)
    setActiveNote(note.id)
    setSelection('')
  }

  const handleMouseUp = () => {
    const sel = window.getSelection()?.toString().trim()
    if (sel) setSelection(sel)
  }

  const handleContextMenu = (e: React.MouseEvent, page: number) => {
    const sel = window.getSelection()?.toString().trim()
    if (!sel) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, text: sel, page })
  }

  const createNoteFromContext = () => {
    if (!contextMenu || !canvasRef.current || !activePageId) return
    const rect = canvasRef.current.getBoundingClientRect()
    const note = newNote(contextMenu.x - rect.left, contextMenu.y - rect.top, activePageId, contextMenu.text)
    note.page_number = contextMenu.page
    const updated = [...notes, note]
    updateNotes(updated)
    setActiveNote(note.id)
    setSelection('')
    setContextMenu(null)
  }

  // ── Drag ──────────────────────────────────────────────────
  const startDrag = (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation()
    const note = notes.find(n => n.id === noteId)!
    setDragging({ noteId, offsetX: e.clientX - note.x, offsetY: e.clientY - note.y })
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      setNotes(prev => prev.map(n => n.id === dragging.noteId
        ? { ...n, x: e.clientX - dragging.offsetX, y: e.clientY - dragging.offsetY }
        : n))
    }
    const onUp = () => {
      if (dragging) { setDragging(null); scheduleSave(notes) }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging, notes, scheduleSave])

  // ── AI Chat ───────────────────────────────────────────────
  const sendChat = async (noteId: string) => {
    const msg = chatInput[noteId]?.trim()
    if (!msg || !userId || !selectedCourse) return
    const note = notes.find(n => n.id === noteId)!

    setChatInput(prev => ({ ...prev, [noteId]: '' }))
    setLoadingChat(prev => ({ ...prev, [noteId]: true }))

    const withUser = notes.map(n => n.id === noteId
      ? { ...n, messages: [...n.messages, { role: 'user' as const, content: msg }] }
      : n)
    setNotes(withUser)

    try {
      const res = await api.chatOnNote({
        course_id: selectedCourse,
        user_id: userId,
        note_id: noteId,
        message: msg,
        prior_messages: note.messages,
        highlight_text: note.highlight_text || undefined,
        pdf_url: activePage?.pdf_url || undefined,
        page_number: note.page_number || undefined,
      })
      const updated = notes.map(n => n.id === noteId ? { ...n, messages: res.messages } : n)
      updateNotes(updated)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingChat(prev => ({ ...prev, [noteId]: false }))
    }
  }

  // ── Fork ─────────────────────────────────────────────────
  const forkNote = async (noteId: string) => {
    if (!userId || !selectedCourse) return
    try {
      const forked = await api.forkNote({ course_id: selectedCourse, user_id: userId, parent_note_id: noteId })
      const updated = [...notes, forked]
      updateNotes(updated)
      setActiveNote(forked.id)
    } catch (e) { console.error(e) }
  }

  const deleteNote = (noteId: string) => {
    const updated = notes.filter(n => n.id !== noteId)
    updateNotes(updated)
    if (activeNote === noteId) setActiveNote(null)
  }

  const toggleMinimise = (noteId: string) => {
    const updated = notes.map(n => n.id === noteId ? { ...n, minimised: !n.minimised } : n)
    updateNotes(updated)
  }

  const pageNotes = notes.filter(n => n.page_id === activePageId)
  const allMinimised = pageNotes.length > 0 && pageNotes.every(n => n.minimised)

  const toggleMinimiseAll = () => {
    const next = !allMinimised
    updateNotes(notes.map(n => n.page_id === activePageId ? { ...n, minimised: next } : n))
  }

  const tidyNotes = () => {
    const COLS = 2, NOTE_W = 320, NOTE_H = 38, GAP = 10, START_X = 20, START_Y = 20
    const updated = notes.map((n) => {
      if (n.page_id !== activePageId) return n
      const pageIdx = pageNotes.findIndex(p => p.id === n.id)
      const col = pageIdx % COLS, row = Math.floor(pageIdx / COLS)
      return { ...n, minimised: true, x: START_X + col * (NOTE_W + GAP), y: START_Y + row * (NOTE_H + GAP) }
    })
    updateNotes(updated)
  }

  const restoreNote = (noteId: string) => {
    const updated = notes.map(n => n.id === noteId ? { ...n, minimised: false } : n)
    updateNotes(updated)
    setActiveNote(noteId)
    setTimeout(() => {
      const el = document.getElementById(`note-${noteId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  const pdfUrl = activePage?.pdf_url || null

  return (
    <div className="flex h-screen flex-col" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", backgroundColor: '#FFFFFF', color: '#37352F' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #EDEDED', backgroundColor: '#FBFBFA' }}>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm transition-colors" style={{ color: 'rgba(55,53,47,0.5)' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#37352F')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(55,53,47,0.5)')}>
            ← Dashboard
          </Link>
          <span className="text-sm font-semibold" style={{ color: '#37352F' }}>Whiteboard</span>
          {saving && <span className="text-xs animate-pulse" style={{ color: 'rgba(55,53,47,0.4)' }}>Saving…</span>}
        </div>

        {/* Module selector */}
        <div className="flex items-center gap-1.5">
          {courses.map(c => (
            <button key={c.id} onClick={() => switchCourse(c.id)}
              className="rounded px-3 py-1 text-xs font-medium transition"
              style={selectedCourse === c.id
                ? { backgroundColor: c.color + '25', color: c.color, border: `1px solid ${c.color}50` }
                : { backgroundColor: 'transparent', color: 'rgba(55,53,47,0.65)', border: '1px solid #EDEDED' }}
              onMouseEnter={e => { if (selectedCourse !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = '#EFEFED' }}
              onMouseLeave={e => { if (selectedCourse !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {selectedCourse && activePageId && (
            <>
              {/* Note mode toggle */}
              <div className="flex rounded overflow-hidden" style={{ border: '1px solid #EDEDED' }}>
                <button
                  onClick={() => setNoteMode('ai')}
                  className="px-2.5 py-1 text-xs transition"
                  style={{
                    backgroundColor: noteMode === 'ai' ? '#37352F' : '#FFFFFF',
                    color: noteMode === 'ai' ? '#FFFFFF' : 'rgba(55,53,47,0.65)',
                  }}>
                  ✨ AI
                </button>
                <button
                  onClick={() => setNoteMode('text')}
                  className="px-2.5 py-1 text-xs transition"
                  style={{
                    backgroundColor: noteMode === 'text' ? '#37352F' : '#FFFFFF',
                    color: noteMode === 'text' ? '#FFFFFF' : 'rgba(55,53,47,0.65)',
                    borderLeft: '1px solid #EDEDED',
                  }}>
                  ✎ Text
                </button>
              </div>

              <button onClick={() => fileInputRef.current?.click()}
                className="rounded px-3 py-1.5 text-xs transition"
                style={{ border: '1px solid #EDEDED', color: '#37352F', backgroundColor: '#FFFFFF' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#EFEFED')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FFFFFF')}>
                {pdfUrl ? 'Replace PDF' : 'Upload PDF'}
              </button>
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                onChange={e => e.target.files?.[0] && uploadPdf(e.target.files[0])} />
            </>
          )}
          {flashcardGenStatus === 'generating' && (
            <div className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs" style={{ backgroundColor: '#EFF6FF', border: '1px solid #93C5FD', color: '#1D4ED8' }}>
              <span className="animate-spin">⟳</span> Generating flashcards…
            </div>
          )}
          {flashcardGenStatus === 'done' && (
            <div className="flex cursor-pointer items-center gap-1.5 rounded px-3 py-1.5 text-xs"
              style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', color: '#16A34A' }}
              onClick={() => selectedCourse && router.push(`/flashcards?course=${selectedCourse}`)}>
              ✓ Flashcards ready — view →
            </div>
          )}
          {flashcardGenStatus === 'error' && (
            <div className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626' }}>
              ⚠ Flashcard generation failed
            </div>
          )}
          {selection && (
            <div className="flex items-center gap-2 rounded px-3 py-1.5 text-xs" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
              <span>"{selection.slice(0, 30)}{selection.length > 30 ? '…' : ''}" selected</span>
              <span style={{ color: '#B45309' }}>— double-click to annotate</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {!selectedCourse ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mb-3 text-4xl">🎨</div>
            <div className="text-sm" style={{ color: 'rgba(55,53,47,0.5)' }}>Select a module above to open its whiteboard</div>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {/* ── Left sidebar: pages ── */}
          <div className="flex flex-col shrink-0 relative transition-all duration-200" style={{ width: sidebarCollapsed ? 0 : 220, borderRight: sidebarCollapsed ? 'none' : '1px solid #EDEDED', backgroundColor: '#FBFBFA', overflow: 'hidden' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #EDEDED', minWidth: 220 }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(55,53,47,0.4)' }}>Pages</span>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="rounded p-1 transition-colors hover:bg-[#EFEFED]"
                style={{ color: 'rgba(55,53,47,0.4)', fontSize: 12, lineHeight: 1 }}
                title="Hide sidebar">
                ‹
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-1" style={{ minWidth: 220 }}>
              {pages.map(page => (
                <div key={page.id}
                  onClick={() => { if (renamingPageId !== page.id) setActivePageId(page.id) }}
                  className="group flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors"
                  style={{
                    backgroundColor: activePageId === page.id ? '#EFEFED' : 'transparent',
                  }}
                  onMouseEnter={e => { if (activePageId !== page.id) (e.currentTarget as HTMLElement).style.backgroundColor = '#F5F5F4' }}
                  onMouseLeave={e => { if (activePageId !== page.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                >
                  <span className="mt-0.5 text-xs shrink-0" style={{ color: activePageId === page.id ? '#37352F' : 'rgba(55,53,47,0.4)' }}>
                    📄
                  </span>
                  <div className="flex-1 min-w-0">
                    {renamingPageId === page.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingPageId(null) }}
                        onClick={e => e.stopPropagation()}
                        className="w-full rounded px-1 py-0 text-xs focus:outline-none"
                        style={{ backgroundColor: '#FFFFFF', border: '1px solid #93C5FD', color: '#37352F' }}
                      />
                    ) : (
                      <div
                        className="truncate text-xs font-medium"
                        style={{ color: activePageId === page.id ? '#37352F' : 'rgba(55,53,47,0.7)' }}
                        onDoubleClick={e => {
                          e.stopPropagation()
                          setRenamingPageId(page.id)
                          setRenameValue(page.name)
                        }}
                        title="Double-click to rename"
                      >
                        {page.name}
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-xs" style={{ color: 'rgba(55,53,47,0.4)' }}>
                      {page.pdf_name
                        ? page.pdf_name.replace(/\.pdf$/i, '')
                        : <span className="italic">No PDF</span>
                      }
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); setRenamingPageId(page.id); setRenameValue(page.name) }}
                      className="rounded p-0.5 text-xs transition hover:bg-black/10"
                      style={{ color: 'rgba(55,53,47,0.5)' }}
                      title="Rename">
                      ✎
                    </button>
                    {pages.length > 1 && (
                      <button
                        onClick={e => { e.stopPropagation(); deletePage(page.id) }}
                        className="rounded p-0.5 text-xs transition hover:bg-red-100"
                        style={{ color: 'rgba(55,53,47,0.5)' }}
                        title="Delete page">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Sections index (only if active page has a PDF with an outline) */}
            {activePage?.sections && activePage.sections.length > 0 && (
              <div style={{ borderTop: '1px solid #EDEDED' }}>
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(55,53,47,0.4)', minWidth: 220 }}>
                  Sections
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 180, minWidth: 220 }}>
                  {activePage.sections.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => document.getElementById(`pdf-page-${s.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className="w-full text-left py-1.5 text-xs transition-colors hover:bg-[#EFEFED] truncate"
                      style={{
                        paddingLeft: `${(s.depth || 0) * 10 + 16}px`,
                        paddingRight: 12,
                        color: 'rgba(55,53,47,0.7)',
                        display: 'block',
                      }}
                      title={s.title}>
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes panel for active page */}
            {pageNotes.length > 0 && (
              <div style={{ borderTop: '1px solid #EDEDED' }}>
                <div className="flex items-center justify-between px-4 py-2" style={{ minWidth: 220 }}>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(55,53,47,0.4)' }}>
                    Notes ({pageNotes.length})
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={tidyNotes}
                      className="rounded px-1.5 py-0.5 text-xs transition hover:bg-[#EFEFED]"
                      style={{ color: 'rgba(55,53,47,0.5)' }}
                      title="Tidy notes into a grid">
                      ⊞
                    </button>
                    <button
                      onClick={toggleMinimiseAll}
                      className="rounded px-1.5 py-0.5 text-xs transition hover:bg-[#EFEFED]"
                      style={{ color: 'rgba(55,53,47,0.5)' }}
                      title={allMinimised ? 'Expand all' : 'Minimise all'}>
                      {allMinimised ? '▼' : '▲'}
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 200, minWidth: 220 }}>
                  {pageNotes.map(note => (
                    <button
                      key={note.id}
                      onClick={() => note.minimised ? restoreNote(note.id) : (() => { setActiveNote(note.id); document.getElementById(`note-${note.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })()}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[#EFEFED]"
                      style={{ color: note.minimised ? '#37352F' : 'rgba(55,53,47,0.6)' }}
                      title={note.minimised ? 'Click to restore' : 'Click to focus'}>
                      <span className="shrink-0 text-xs">{note.type === 'text' ? '📝' : '💬'}</span>
                      <span className="flex-1 truncate">{note.title || (note.type === 'text' ? 'Untitled note' : 'Note')}</span>
                      {note.minimised && (
                        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: '#EEF2FF', color: '#6366F1', fontSize: 9 }}>
                          min
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="p-2" style={{ borderTop: '1px solid #EDEDED' }}>
              <button
                onClick={addPage}
                className="w-full rounded px-3 py-2 text-xs transition text-left"
                style={{ color: 'rgba(55,53,47,0.6)', border: '1px dashed #DEDEDE', backgroundColor: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#EFEFED')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                + Add page
              </button>
            </div>
          </div>

          {/* ── Sidebar expand tab (only visible when collapsed) ── */}
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Show pages"
              className="absolute z-20 flex items-center justify-center transition-colors hover:bg-[#EFEFED]"
              style={{
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 20,
                height: 48,
                backgroundColor: '#FBFBFA',
                border: '1px solid #EDEDED',
                borderLeft: 'none',
                borderRadius: '0 6px 6px 0',
                color: 'rgba(55,53,47,0.5)',
                fontSize: 13,
              }}>
              ›
            </button>
          )}

          {/* ── Main canvas ── */}
          <div className="relative flex flex-1 overflow-hidden">
            <div
              ref={canvasRef}
              onDoubleClick={pdfUrl ? undefined : handleCanvasDoubleClick}
              onMouseUp={handleMouseUp}
              className="relative flex-1 overflow-hidden"
              style={{ userSelect: 'text', backgroundColor: '#FFFFFF' }}
            >
              {pdfUrl ? (
                <div className="absolute inset-0 overflow-auto flex flex-col items-center bg-gray-100 py-4 gap-2">
                  {pdfError ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                      <div className="text-sm" style={{ color: '#991B1B' }}>{pdfError}</div>
                      <button
                        onClick={() => {
                          setPdfError(null)
                          const updated = pages.map(p => p.id === activePageId ? { ...p, pdf_url: null, pdf_name: null } : p)
                          updatePages(updated)
                        }}
                        className="rounded px-3 py-1.5 text-xs"
                        style={{ border: '1px solid #EDEDED', color: '#37352F' }}>
                        Remove PDF
                      </button>
                    </div>
                  ) : (
                    <PDFViewer
                      pdfUrl={pdfUrl}
                      numPages={numPages}
                      pageWidth={pageWidth}
                      onLoadSuccess={(n) => { setNumPages(n); setPdfError(null) }}
                      onLoadError={(err) => setPdfError(`Failed to load PDF: ${err.message}`)}
                      onMouseUp={handleMouseUp}
                      onContextMenu={handleContextMenu}
                      onDoubleClick={(e, page) => {
                        if (!canvasRef.current || !activePageId) return
                        const rect = canvasRef.current.getBoundingClientRect()
                        const note = newNote(e.clientX - rect.left, e.clientY - rect.top, activePageId, selection || undefined, noteMode)
                        note.page_number = page
                        const updated = [...notes, note]
                        updateNotes(updated)
                        setActiveNote(note.id)
                        setSelection('')
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center">
                  <div className="mb-4 text-6xl">📄</div>
                  <div className="mb-2 text-lg font-medium" style={{ color: '#37352F' }}>No PDF loaded</div>
                  <div className="mb-6 text-sm" style={{ color: 'rgba(55,53,47,0.5)' }}>Upload lecture notes or study material for this page</div>
                  <button onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg px-5 py-2.5 text-sm font-medium transition"
                    style={{ backgroundColor: '#37352F', color: '#FFFFFF' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#2f2b26')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#37352F')}>
                    Upload PDF
                  </button>
                  <div className="mt-6 text-xs" style={{ color: 'rgba(55,53,47,0.4)' }}>Or double-click anywhere to add a note without a PDF</div>
                </div>
              )}

              {/* Notes overlay */}
              <div className="absolute inset-0 pointer-events-none">
                {activeNotes.map(note => (
                  <div key={note.id} id={`note-${note.id}`}
                    className="absolute select-none pointer-events-auto"
                    style={{ left: note.x, top: note.y, minWidth: 260, maxWidth: 460, zIndex: activeNote === note.id ? 100 : 10 }}
                    onClick={() => setActiveNote(note.id)}
                  >
                    {/* Note header */}
                    <div
                      onMouseDown={e => { if (editingTitleId !== note.id) startDrag(e, note.id) }}
                      className="flex cursor-grab items-center justify-between rounded-t-xl px-3 py-2 text-xs font-semibold active:cursor-grabbing"
                      style={{ backgroundColor: note.color, color: '#37352F', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
                    >
                      {/* Inline title editing */}
                      {editingTitleId === note.id ? (
                        <input
                          autoFocus
                          value={titleDraft}
                          onChange={e => setTitleDraft(e.target.value)}
                          onBlur={() => {
                            const updated = notes.map(n => n.id === note.id ? { ...n, title: titleDraft } : n)
                            updateNotes(updated)
                            setEditingTitleId(null)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const updated = notes.map(n => n.id === note.id ? { ...n, title: titleDraft } : n)
                              updateNotes(updated)
                              setEditingTitleId(null)
                            }
                            if (e.key === 'Escape') setEditingTitleId(null)
                          }}
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          className="flex-1 min-w-0 rounded px-1 py-0 text-xs focus:outline-none cursor-text"
                          style={{ backgroundColor: 'rgba(255,255,255,0.6)', border: '1px solid rgba(55,53,47,0.2)', color: '#37352F' }}
                        />
                      ) : (
                        <span
                          className="truncate flex-1 min-w-0 cursor-text"
                          style={{ color: note.title ? '#37352F' : 'rgba(55,53,47,0.4)' }}
                          onDoubleClick={e => {
                            e.stopPropagation()
                            setEditingTitleId(note.id)
                            setTitleDraft(note.title || '')
                          }}
                          title="Double-click to rename"
                        >
                          {note.title || (note.type === 'text' ? 'Untitled note' : 'Note')}
                        </span>
                      )}

                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        {note.parent_note_id && <span className="text-xs" style={{ color: 'rgba(55,53,47,0.5)' }}>⤷ fork</span>}
                        <button onClick={e => { e.stopPropagation(); toggleMinimise(note.id) }}
                          className="rounded p-0.5 transition hover:bg-black/10" style={{ color: 'rgba(55,53,47,0.6)' }}>
                          {note.minimised ? '▼' : '▲'}
                        </button>
                        {note.type !== 'text' && (
                          <button onClick={e => { e.stopPropagation(); forkNote(note.id) }}
                            className="rounded p-0.5 transition hover:bg-black/10" style={{ color: 'rgba(55,53,47,0.6)' }} title="Fork into new thread">
                            ⑂
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); deleteNote(note.id) }}
                          className="rounded p-0.5 transition hover:bg-black/10" style={{ color: 'rgba(55,53,47,0.6)' }}>
                          ✕
                        </button>
                      </div>
                    </div>

                    {!note.minimised && (
                      note.type === 'text' ? (
                        /* ── Text note body ── */
                        <div className="rounded-b-xl border border-t-0"
                          style={{ backgroundColor: '#FFFFFF', borderColor: '#EDEDED', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
                          <textarea
                            value={note.content || ''}
                            onChange={e => {
                              const updated = notes.map(n => n.id === note.id ? { ...n, content: e.target.value } : n)
                              updateNotes(updated)
                            }}
                            placeholder="Start writing…"
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                            className="w-full resize-none rounded-b-xl px-3 py-2.5 text-xs focus:outline-none"
                            rows={6}
                            style={{ backgroundColor: 'transparent', color: '#37352F', lineHeight: 1.6 }}
                          />
                        </div>
                      ) : (
                        /* ── AI chat note body ── */
                        <div className="rounded-b-xl border border-t-0"
                          style={{ backgroundColor: note.color + 'dd', borderColor: note.color, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>

                          {note.highlight_text && (
                            <div className="mx-3 mt-2 rounded px-2 py-1.5 text-xs italic"
                              style={{ borderLeft: '2px solid rgba(55,53,47,0.2)', backgroundColor: 'rgba(255,255,255,0.4)', color: 'rgba(55,53,47,0.7)' }}>
                              "{note.highlight_text.slice(0, 120)}{note.highlight_text.length > 120 ? '…' : ''}"
                            </div>
                          )}

                          <div className="max-h-60 overflow-y-auto p-3 space-y-2">
                            {note.messages.length === 0 && (
                              <div className="text-xs italic text-center py-2" style={{ color: 'rgba(55,53,47,0.5)' }}>
                                Ask Claude anything about this{note.highlight_text ? ' excerpt' : ' topic'}…
                              </div>
                            )}
                            {note.messages.map((m, i) => (
                              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className="max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
                                  style={m.role === 'user'
                                    ? { backgroundColor: '#37352F', color: '#FFFFFF' }
                                    : { backgroundColor: 'rgba(255,255,255,0.8)', color: '#37352F', border: '1px solid rgba(55,53,47,0.1)' }}>
                                  {m.role === 'assistant' ? renderMarkdown(m.content) : m.content}
                                </div>
                              </div>
                            ))}
                            {loadingChat[note.id] && (
                              <div className="flex justify-start">
                                <div className="rounded-lg px-3 py-2 text-xs animate-pulse"
                                  style={{ backgroundColor: 'rgba(255,255,255,0.8)', color: 'rgba(55,53,47,0.5)', border: '1px solid rgba(55,53,47,0.1)' }}>
                                  Thinking…
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex gap-1.5 p-2" style={{ borderTop: '1px solid rgba(55,53,47,0.1)' }}>
                            <input
                              type="text"
                              value={chatInput[note.id] || ''}
                              onChange={e => setChatInput(prev => ({ ...prev, [note.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(note.id) } }}
                              placeholder="Ask Claude…"
                              className="flex-1 rounded px-2.5 py-1.5 text-xs focus:outline-none"
                              style={{ backgroundColor: 'rgba(255,255,255,0.7)', border: '1px solid rgba(55,53,47,0.15)', color: '#37352F' }}
                              onClick={e => e.stopPropagation()}
                            />
                            <button onClick={e => { e.stopPropagation(); sendChat(note.id) }}
                              disabled={!chatInput[note.id]?.trim() || loadingChat[note.id]}
                              className="rounded px-2.5 py-1.5 text-xs transition disabled:opacity-40"
                              style={{ backgroundColor: '#37352F', color: '#FFFFFF' }}>
                              →
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ))}

                {pdfUrl && (
                  <button
                    onClick={() => {
                      if (!activePageId) return
                      const note = newNote(40, 40, activePageId, undefined, noteMode)
                      const updated = [...notes, note]
                      updateNotes(updated)
                      setActiveNote(note.id)
                    }}
                    className="pointer-events-auto absolute bottom-4 right-4 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:opacity-90"
                    style={{ backgroundColor: '#37352F' }}>
                    + Add note
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div className="fixed z-50 rounded-lg shadow-xl py-1 min-w-44"
            style={{ left: contextMenu.x, top: contextMenu.y, backgroundColor: '#FFFFFF', border: '1px solid #EDEDED' }}>
            <div className="px-3 py-1.5 text-xs" style={{ color: 'rgba(55,53,47,0.5)', borderBottom: '1px solid #EDEDED' }}>
              "{contextMenu.text.slice(0, 40)}{contextMenu.text.length > 40 ? '…' : ''}"
            </div>
            <button onClick={createNoteFromContext}
              className="w-full px-3 py-2 text-left text-sm transition hover:bg-[#EFEFED]"
              style={{ color: '#37352F' }}>
              💬 Annotate with Claude
            </button>
          </div>
        </>
      )}
    </div>
  )
}

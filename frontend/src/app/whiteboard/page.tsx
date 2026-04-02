'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

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
}

type Course = { id: string; name: string; color: string }

const NOTE_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FDE68A', '#F5D0FE', '#FECACA']

function newNote(x: number, y: number, highlight?: string): StickyNote {
  return {
    id: crypto.randomUUID(),
    x, y,
    width: 300,
    highlight_text: highlight || null,
    page_number: null,
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    title: highlight ? `"${highlight.slice(0, 40)}${highlight.length > 40 ? '…' : ''}"` : 'Note',
    messages: [],
    parent_note_id: null,
  }
}

export default function WhiteboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const courseIdParam = searchParams.get('course')

  const [userId, setUserId] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourse, setSelectedCourse] = useState<string | null>(courseIdParam)
  const [notes, setNotes] = useState<StickyNote[]>([])
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfName, setPdfName] = useState<string | null>(null)
  const [activeNote, setActiveNote] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState<{ [noteId: string]: string }>({})
  const [loadingChat, setLoadingChat] = useState<{ [noteId: string]: boolean }>({})
  const [dragging, setDragging] = useState<{ noteId: string; offsetX: number; offsetY: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [selection, setSelection] = useState<string>('')
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const loadWhiteboard = async (uid: string, courseId: string) => {
    const wb = await api.getWhiteboard(courseId, uid).catch(() => null)
    if (wb) {
      setNotes(wb.sticky_notes || [])
      setPdfUrl(wb.pdf_url || null)
      setPdfName(wb.pdf_name || null)
    }
  }

  const switchCourse = async (courseId: string) => {
    setSelectedCourse(courseId)
    if (userId) loadWhiteboard(userId, courseId)
  }

  // ── Auto-save ─────────────────────────────────────────────
  const scheduleSave = useCallback((updatedNotes: StickyNote[]) => {
    if (!userId || !selectedCourse) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await api.saveWhiteboard({ course_id: selectedCourse, user_id: userId, sticky_notes: updatedNotes, pdf_name: pdfName, pdf_url: pdfUrl })
      } finally { setSaving(false) }
    }, 1500)
  }, [userId, selectedCourse, pdfName, pdfUrl])

  const updateNotes = (updated: StickyNote[]) => {
    setNotes(updated)
    scheduleSave(updated)
  }

  // ── PDF upload ────────────────────────────────────────────
  const uploadPdf = async (file: File) => {
    if (!userId || !selectedCourse) return
    const path = `${userId}/${selectedCourse}/${file.name}`
    const { error } = await supabase.storage.from('whiteboards').upload(path, file, { upsert: true })
    if (error) { alert('Upload failed: ' + error.message); return }
    const { data } = supabase.storage.from('whiteboards').getPublicUrl(path)
    setPdfUrl(data.publicUrl)
    setPdfName(file.name)
    scheduleSave(notes)
  }

  // ── Canvas interaction ────────────────────────────────────
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedCourse) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const note = newNote(e.clientX - rect.left, e.clientY - rect.top, selection || undefined)
    const updated = [...notes, note]
    updateNotes(updated)
    setActiveNote(note.id)
    setSelection('')
  }

  // Track text selection on the PDF area
  const handleMouseUp = () => {
    const sel = window.getSelection()?.toString().trim()
    if (sel) setSelection(sel)
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
      if (dragging) {
        setDragging(null)
        scheduleSave(notes)
      }
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

    // Optimistically add user message
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

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-5 py-3">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-200 text-sm">← Dashboard</Link>
          <span className="text-sm font-semibold text-gray-100">Whiteboard</span>
          {saving && <span className="text-xs text-gray-500 animate-pulse">Saving…</span>}
        </div>

        <div className="flex items-center gap-2">
          {/* Course selector */}
          {courses.map(c => (
            <button key={c.id} onClick={() => switchCourse(c.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${selectedCourse === c.id ? 'text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              style={selectedCourse === c.id ? { backgroundColor: c.color, color: '#1f2937' } : {}}>
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {selectedCourse && (
            <>
              <button onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600">
                Upload PDF
              </button>
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                onChange={e => e.target.files?.[0] && uploadPdf(e.target.files[0])} />
            </>
          )}
          {selection && (
            <div className="flex items-center gap-2 rounded-lg bg-yellow-900/50 border border-yellow-700 px-3 py-1.5 text-xs text-yellow-300">
              <span>"{selection.slice(0, 30)}{selection.length > 30 ? '…' : ''}" selected</span>
              <span className="text-yellow-500">— double-click canvas to annotate</span>
            </div>
          )}
          <div className="text-xs text-gray-500">Double-click canvas to add note</div>
        </div>
      </div>

      {/* Canvas */}
      {!selectedCourse ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="mb-3 text-4xl">🎨</div>
            <div className="text-sm">Select a module above to open its whiteboard</div>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {/* PDF viewer area */}
          <div
            ref={canvasRef}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseUp={handleMouseUp}
            className="relative flex-1 overflow-auto"
            style={{ userSelect: 'text' }}
          >
            {pdfUrl ? (
              <iframe src={pdfUrl} className="h-full w-full border-0" title={pdfName || 'PDF'} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-gray-600">
                <div className="mb-4 text-6xl">📄</div>
                <div className="mb-2 text-lg font-medium text-gray-500">No PDF loaded</div>
                <div className="mb-6 text-sm text-gray-600">Upload your lecture notes or study material</div>
                <button onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                  Upload PDF
                </button>
                <div className="mt-6 text-xs text-gray-600">Or double-click anywhere to add a note without a PDF</div>
              </div>
            )}

            {/* Sticky notes layer */}
            {notes.map(note => (
              <div key={note.id}
                className="absolute select-none"
                style={{ left: note.x, top: note.y, width: note.width, zIndex: activeNote === note.id ? 100 : 10 }}
                onClick={() => setActiveNote(note.id)}
              >
                {/* Note header — drag handle */}
                <div
                  onMouseDown={e => startDrag(e, note.id)}
                  className="flex cursor-grab items-center justify-between rounded-t-xl px-3 py-2 text-xs font-semibold text-gray-800 shadow-lg active:cursor-grabbing"
                  style={{ backgroundColor: note.color }}
                >
                  <span className="truncate max-w-45">{note.title}</span>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    {note.parent_note_id && <span className="text-gray-500 text-xs">⤷ fork</span>}
                    <button onClick={e => { e.stopPropagation(); toggleMinimise(note.id) }}
                      className="rounded p-0.5 hover:bg-black/10 text-gray-600">
                      {note.minimised ? '▼' : '▲'}
                    </button>
                    <button onClick={e => { e.stopPropagation(); forkNote(note.id) }}
                      className="rounded p-0.5 hover:bg-black/10 text-gray-600" title="Fork into new thread">
                      ⑂
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteNote(note.id) }}
                      className="rounded p-0.5 hover:bg-black/10 text-gray-600">
                      ✕
                    </button>
                  </div>
                </div>

                {!note.minimised && (
                  <div className="rounded-b-xl border border-t-0 shadow-xl"
                    style={{ backgroundColor: note.color + 'ee', borderColor: note.color }}>

                    {/* Highlighted text context */}
                    {note.highlight_text && (
                      <div className="mx-3 mt-2 rounded border-l-2 border-gray-600/30 bg-black/5 px-2 py-1.5 text-xs italic text-gray-600">
                        "{note.highlight_text.slice(0, 120)}{note.highlight_text.length > 120 ? '…' : ''}"
                      </div>
                    )}

                    {/* Conversation */}
                    <div className="max-h-60 overflow-y-auto p-3 space-y-2">
                      {note.messages.length === 0 && (
                        <div className="text-xs text-gray-500 italic text-center py-2">
                          Ask Claude anything about this{note.highlight_text ? ' excerpt' : ' topic'}…
                        </div>
                      )}
                      {note.messages.map((m, i) => (
                        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${
                            m.role === 'user'
                              ? 'bg-gray-800/80 text-white'
                              : 'bg-white/70 text-gray-800 border border-black/5'
                          }`}>
                            {m.content}
                          </div>
                        </div>
                      ))}
                      {loadingChat[note.id] && (
                        <div className="flex justify-start">
                          <div className="rounded-lg bg-white/70 px-3 py-2 text-xs text-gray-500 border border-black/5">
                            <span className="animate-pulse">Thinking…</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Input */}
                    <div className="flex gap-1.5 border-t border-black/10 p-2">
                      <input
                        type="text"
                        value={chatInput[note.id] || ''}
                        onChange={e => setChatInput(prev => ({ ...prev, [note.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(note.id) } }}
                        placeholder="Ask Claude…"
                        className="flex-1 rounded-lg bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 border border-black/10 focus:outline-none focus:bg-white"
                        onClick={e => e.stopPropagation()}
                      />
                      <button onClick={e => { e.stopPropagation(); sendChat(note.id) }}
                        disabled={!chatInput[note.id]?.trim() || loadingChat[note.id]}
                        className="rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-white hover:bg-gray-700 disabled:opacity-40">
                        →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

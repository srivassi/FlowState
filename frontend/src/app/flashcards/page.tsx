'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const NOTION = {
  bg: '#FFFFFF',
  sidebar: '#FBFBFA',
  border: '#EDEDED',
  hover: '#EFEFED',
  text: '#37352F',
  muted: 'rgba(55,53,47,0.65)',
  btn: '#FFFFFF',
  btnBorder: '#D3D1CB',
}

type FlashcardSet = {
  id: string
  title: string
  course_id: string
  created_at: string
  last_studied: string | null
}

type Course = {
  id: string
  name: string
  color: string
}

function FlashcardsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const courseId = searchParams.get('course')

  const [userId, setUserId] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourse, setSelectedCourse] = useState<string>(courseId || '')
  const [sets, setSets] = useState<FlashcardSet[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSets, setLoadingSets] = useState(false)

  // Create set manually
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  // Generate from PDF
  const [showGenerate, setShowGenerate] = useState(false)
  const [genTitle, setGenTitle] = useState('')
  const [genFile, setGenFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const genAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      const coursesData = await api.getCourses(uid).catch(() => [])
      setCourses(coursesData)
      if (!selectedCourse && coursesData.length > 0) {
        setSelectedCourse(coursesData[0].id)
      }
      setLoading(false)
    })
  }, [router])

  useEffect(() => {
    if (!selectedCourse || !userId) return
    setLoadingSets(true)
    api.getFlashcardSets(selectedCourse, userId)
      .then(setSets)
      .catch(() => setSets([]))
      .finally(() => setLoadingSets(false))
  }, [selectedCourse, userId])

  const handleCreateSet = async () => {
    if (!newTitle.trim() || !userId || !selectedCourse) return
    setCreating(true)
    try {
      const set = await api.createFlashcardSet({ user_id: userId, course_id: selectedCourse, title: newTitle.trim() })
      setSets(prev => [set, ...prev])
      setNewTitle('')
      setShowCreate(false)
      router.push(`/flashcards/${set.id}`)
    } catch {
      // ignore
    } finally {
      setCreating(false)
    }
  }

  const handleGenerate = async () => {
    if (!genTitle.trim() || !genFile || !userId || !selectedCourse) return
    setGenerating(true)
    setGenError('')
    genAbortRef.current = new AbortController()
    try {
      const form = new FormData()
      form.append('file', genFile)
      form.append('user_id', userId)
      form.append('course_id', selectedCourse)
      form.append('title', genTitle.trim())
      const res = await fetch(`${API_URL}/flashcards/generate`, { method: 'POST', body: form, signal: genAbortRef.current.signal })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Generation failed')
      }
      const data = await res.json()
      setSets(prev => [data.set, ...prev])
      setGenTitle('')
      setGenFile(null)
      setShowGenerate(false)
      router.push(`/flashcards/${data.set.id}`)
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setGenError('')
        setGenerating(false)
        return
      }
      setGenError(e.message)
    } finally {
      setGenerating(false)
      genAbortRef.current = null
    }
  }

  const handleCancelGenerate = () => {
    genAbortRef.current?.abort()
    setGenerating(false)
    setGenError('')
  }

  const handleDeleteSet = async (setId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this flashcard set?')) return
    await api.deleteFlashcardSet(setId).catch(() => {})
    setSets(prev => prev.filter(s => s.id !== setId))
  }

  const currentCourse = courses.find(c => c.id === selectedCourse)

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: NOTION.bg }}>
        <div className="text-sm" style={{ color: NOTION.muted }}>Loading…</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", backgroundColor: NOTION.bg }}>

      {/* Sidebar */}
      <div className="flex w-56 shrink-0 flex-col overflow-y-auto border-r" style={{ backgroundColor: NOTION.sidebar, borderColor: NOTION.border }}>
        <div className="p-3">
          <Link href="/dashboard"
            className="mb-4 flex items-center gap-2 rounded px-2 py-2 text-sm font-semibold transition-colors hover:bg-[#EFEFED]"
            style={{ color: NOTION.text }}>
            ← Dashboard
          </Link>

          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>Modules</div>
          <div className="space-y-0.5">
            {courses.map(c => (
              <div key={c.id}
                onClick={() => setSelectedCourse(c.id)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors"
                style={{ backgroundColor: selectedCourse === c.id ? NOTION.hover : 'transparent', color: NOTION.text }}
                onMouseEnter={e => { if (selectedCourse !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = NOTION.hover }}
                onMouseLeave={e => { if (selectedCourse !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="truncate">{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-10">

          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: NOTION.text }}>Flashcards</h1>
              {currentCourse && (
                <div className="mt-1 flex items-center gap-2 text-sm" style={{ color: NOTION.muted }}>
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: currentCourse.color }} />
                  {currentCourse.name}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowGenerate(true); setShowCreate(false) }}
                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ border: `1px solid ${NOTION.btnBorder}`, backgroundColor: NOTION.btn, color: NOTION.text }}>
                ✨ Generate from PDF
              </button>
              <button
                onClick={() => { setShowCreate(true); setShowGenerate(false) }}
                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors"
                style={{ border: `1px solid ${NOTION.btnBorder}`, backgroundColor: NOTION.btn, color: NOTION.text }}>
                + New set
              </button>
            </div>
          </div>

          {/* Generate from PDF panel */}
          {showGenerate && (
            <div className="mb-6 rounded-lg border p-4" style={{ borderColor: NOTION.border, backgroundColor: NOTION.sidebar }}>
              <div className="mb-3 text-sm font-semibold" style={{ color: NOTION.text }}>Generate flashcards from PDF</div>
              <input
                type="text"
                placeholder="Set title (e.g. Week 3 — Databases)"
                value={genTitle}
                onChange={e => setGenTitle(e.target.value)}
                className="mb-3 w-full rounded border px-3 py-2 text-sm outline-none"
                style={{ borderColor: NOTION.border, color: NOTION.text }}
              />
              <div
                className="mb-3 flex cursor-pointer items-center justify-center rounded border-2 border-dashed px-4 py-6 text-sm transition-colors"
                style={{ borderColor: genFile ? '#22c55e' : NOTION.border, color: genFile ? '#16a34a' : NOTION.muted }}
                onClick={() => fileRef.current?.click()}>
                {genFile ? `📄 ${genFile.name}` : 'Click to upload PDF'}
                <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => setGenFile(e.target.files?.[0] || null)} />
              </div>
              {genError && <div className="mb-3 text-sm text-red-500">{genError}</div>}
              <div className="flex gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={!genTitle.trim() || !genFile || generating}
                  className="rounded px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#37352F' }}>
                  {generating ? 'Generating…' : 'Generate'}
                </button>
                {generating ? (
                  <button onClick={handleCancelGenerate} className="rounded px-3 py-1.5 text-sm text-red-500 hover:text-red-700">
                    ✕ Stop
                  </button>
                ) : (
                  <button onClick={() => setShowGenerate(false)} className="rounded px-3 py-1.5 text-sm" style={{ color: NOTION.muted }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Create set panel */}
          {showCreate && (
            <div className="mb-6 rounded-lg border p-4" style={{ borderColor: NOTION.border, backgroundColor: NOTION.sidebar }}>
              <div className="mb-3 text-sm font-semibold" style={{ color: NOTION.text }}>New flashcard set</div>
              <input
                type="text"
                placeholder="Set title"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateSet()}
                className="mb-3 w-full rounded border px-3 py-2 text-sm outline-none"
                style={{ borderColor: NOTION.border, color: NOTION.text }}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateSet}
                  disabled={!newTitle.trim() || creating}
                  className="rounded px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#37352F' }}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button onClick={() => setShowCreate(false)} className="rounded px-3 py-1.5 text-sm" style={{ color: NOTION.muted }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Sets list */}
          {loadingSets ? (
            <div className="text-sm" style={{ color: NOTION.muted }}>Loading sets…</div>
          ) : sets.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center" style={{ borderColor: NOTION.border }}>
              <div className="mb-2 text-3xl">🃏</div>
              <div className="text-sm font-medium" style={{ color: NOTION.text }}>No flashcard sets yet</div>
              <div className="mt-1 text-sm" style={{ color: NOTION.muted }}>
                Generate from a PDF or create one manually.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sets.map(set => (
                <div key={set.id}
                  onClick={() => router.push(`/flashcards/${set.id}`)}
                  className="group flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:bg-[#FAFAF9]"
                  style={{ borderColor: NOTION.border }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: NOTION.text }}>{set.title}</div>
                    <div className="mt-0.5 text-xs" style={{ color: NOTION.muted }}>
                      {set.last_studied
                        ? `Last studied ${new Date(set.last_studied).toLocaleDateString()}`
                        : `Created ${new Date(set.created_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); router.push(`/flashcards/${set.id}/jeopardy`) }}
                      className="hidden rounded px-2 py-1 text-xs transition-colors group-hover:block"
                      style={{ border: `1px solid ${NOTION.btnBorder}`, color: NOTION.text, backgroundColor: NOTION.btn }}>
                      🏆 Jeopardy
                    </button>
                    <button
                      onClick={e => handleDeleteSet(set.id, e)}
                      className="hidden rounded p-1 text-xs text-red-400 transition-colors group-hover:block hover:text-red-600">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function FlashcardsPage() {
  return (
    <Suspense>
      <FlashcardsInner />
    </Suspense>
  )
}

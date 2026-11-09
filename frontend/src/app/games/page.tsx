'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

const NOTION = {
  bg: '#FFFFFF', sidebar: '#FBFBFA', border: '#EDEDED',
  hover: '#EFEFED', text: '#37352F', muted: 'rgba(55,53,47,0.5)',
}

type Course = { id: string; name: string; color: string }
type FlashcardSet = { id: string; title: string; course_id: string }
type GauntletRoom = {
  id: string; pdf_url: string; pdf_name: string; last_played_at: string | null
  session_count: number; best_stars: number | null; best_max_stars: number | null
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return 'Never played'
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

const GAMES = [
  {
    id: 'gauntlet',
    icon: '🔥',
    title: 'Goblet of Fire',
    tagline: 'Master any PDF through Socratic Q&A',
    desc: 'Claude reads your lecture PDF, breaks it into topics, then teaches you through a back-and-forth discussion. Earn stars per topic and get a mastery report at the end.',
    color: '#6366F1',
    badge: 'New',
    needsPdf: true,
  },
  {
    id: 'jeopardy',
    icon: '🏆',
    title: 'Jeopardy',
    tagline: 'Race through flashcards game-show style',
    desc: 'Pick a flashcard set and compete against the clock in a classic Jeopardy board. Great for last-minute revision.',
    color: '#F59E0B',
    badge: null,
    needsPdf: false,
  },
]

export default function GamesPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [sets, setSets] = useState<FlashcardSet[]>([])
  const [loadingSets, setLoadingSets] = useState(false)

  // Gauntlet picker state
  const [showGauntletPicker, setShowGauntletPicker] = useState(false)
  const [gauntletCourse, setGauntletCourse] = useState<string>('')
  const [rooms, setRooms] = useState<GauntletRoom[]>([])
  const [whiteboards, setWhiteboards] = useState<any[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [loadingWb, setLoadingWb] = useState(false)
  const [showNewPdf, setShowNewPdf] = useState(false)

  // Jeopardy picker state
  const [showJeopardyPicker, setShowJeopardyPicker] = useState(false)
  const [jeopardyCourse, setJeopardyCourse] = useState<string>('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: any) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      const c = await api.getCourses(uid).catch(() => [])
      setCourses(c)
    })
  }, [router])

  // Load flashcard sets when jeopardy course selected
  useEffect(() => {
    if (!jeopardyCourse || !userId) return
    setLoadingSets(true)
    api.getFlashcardSets(jeopardyCourse, userId)
      .then(s => setSets(s))
      .catch(() => setSets([]))
      .finally(() => setLoadingSets(false))
  }, [jeopardyCourse, userId])

  // Load rooms + whiteboards when gauntlet course selected
  useEffect(() => {
    if (!gauntletCourse || !userId) return
    setLoadingRooms(true)
    setLoadingWb(true)
    setRooms([])
    setWhiteboards([])
    setShowNewPdf(false)
    Promise.all([
      api.gauntletGetRooms(userId, gauntletCourse).catch(() => []),
      api.getWhiteboard(gauntletCourse, userId).catch(() => ({})),
    ]).then(([roomList, wb]) => {
      setRooms(roomList)
      const pages = wb.pages || (wb.pdf_url ? [{ id: 'default', name: wb.pdf_name || 'PDF', pdf_url: wb.pdf_url, pdf_name: wb.pdf_name }] : [])
      setWhiteboards(pages)
    }).finally(() => { setLoadingRooms(false); setLoadingWb(false) })
  }, [gauntletCourse, userId])

  const launchGauntlet = async (pdfUrl: string, pdfName: string, existingRoomId?: string) => {
    let roomId = existingRoomId
    if (!roomId) {
      const room = await api.gauntletUpsertRoom({ user_id: userId, course_id: gauntletCourse, pdf_url: pdfUrl, pdf_name: pdfName })
      roomId = room.id
    }
    sessionStorage.setItem('gauntletPdf', JSON.stringify({ pdfUrl, pdfName, courseId: gauntletCourse, userId, roomId }))
    router.push('/games/gauntlet')
  }

  const launchJeopardy = (setId: string) => {
    router.push(`/flashcards/${setId}/jeopardy`)
  }

  return (
    <div className="min-h-screen" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", backgroundColor: NOTION.sidebar, color: NOTION.text }}>

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-4 px-6 py-3" style={{ borderBottom: `1px solid ${NOTION.border}`, backgroundColor: NOTION.sidebar }}>
        <Link href="/dashboard" className="text-sm transition-colors" style={{ color: NOTION.muted }}
          onMouseEnter={e => (e.currentTarget.style.color = NOTION.text)}
          onMouseLeave={e => (e.currentTarget.style.color = NOTION.muted)}>
          ← Dashboard
        </Link>
        <span className="text-sm font-semibold">🎮 Games</span>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="mb-8 text-sm" style={{ color: NOTION.muted }}>
          Study games that actually work. Pick a game, choose your material, and get to it.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          {GAMES.map(game => (
            <div key={game.id} className="relative flex flex-col rounded-xl border bg-white p-6"
              style={{ borderColor: NOTION.border }}>
              {game.badge && (
                <span className="absolute right-4 top-4 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: game.color }}>
                  {game.badge}
                </span>
              )}
              <div className="mb-3 text-3xl">{game.icon}</div>
              <div className="mb-1 text-base font-semibold" style={{ color: NOTION.text }}>{game.title}</div>
              <div className="mb-2 text-xs font-medium" style={{ color: game.color }}>{game.tagline}</div>
              <p className="mb-5 flex-1 text-sm leading-relaxed" style={{ color: NOTION.muted }}>{game.desc}</p>
              <button
                onClick={() => {
                  if (game.id === 'gauntlet') { setShowGauntletPicker(true); setShowJeopardyPicker(false) }
                  else { setShowJeopardyPicker(true); setShowGauntletPicker(false) }
                }}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: game.color }}>
                Play →
              </button>
            </div>
          ))}
        </div>

        {/* ── Gauntlet picker ── */}
        {showGauntletPicker && (
          <div className="mt-8 rounded-xl border bg-white p-6" style={{ borderColor: NOTION.border }}>
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">🔥 Goblet of Fire</span>
              <button onClick={() => { setShowGauntletPicker(false); setGauntletCourse(''); setRooms([]); setShowNewPdf(false) }}
                className="text-sm" style={{ color: NOTION.muted }}>✕</button>
            </div>

            <label className="mb-1 block text-xs font-medium" style={{ color: NOTION.muted }}>Module</label>
            <select value={gauntletCourse} onChange={e => { setGauntletCourse(e.target.value); setRooms([]); setShowNewPdf(false) }}
              className="mb-5 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: NOTION.border }}>
              <option value="">Select a module…</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {gauntletCourse && (loadingRooms ? (
              <p className="text-sm" style={{ color: NOTION.muted }}>Loading…</p>
            ) : (
              <>
                {/* Existing rooms */}
                {rooms.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {rooms.map(room => (
                      <div key={room.id} className="flex items-center gap-3 rounded-xl border px-4 py-3"
                        style={{ borderColor: NOTION.border }}>
                        <span className="text-lg">📄</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-medium" style={{ color: NOTION.text }}>{room.pdf_name || 'PDF'}</div>
                          <div className="text-xs mt-0.5" style={{ color: NOTION.muted }}>
                            {room.session_count} {room.session_count === 1 ? 'session' : 'sessions'}
                            {room.best_stars != null && ` · Best: ${room.best_stars}/${room.best_max_stars} ⭐`}
                            {' · '}{timeAgo(room.last_played_at)}
                          </div>
                        </div>
                        <button onClick={() => launchGauntlet(room.pdf_url, room.pdf_name || 'PDF', room.id)}
                          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                          style={{ backgroundColor: '#6366F1' }}>
                          Play →
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* New PDF section */}
                {whiteboards.filter(p => p.pdf_url && !rooms.find(r => r.pdf_url === p.pdf_url)).length > 0 && (
                  <>
                    <button onClick={() => setShowNewPdf(v => !v)}
                      className="mb-3 text-xs font-medium transition hover:opacity-70"
                      style={{ color: '#6366F1' }}>
                      {showNewPdf ? '▾' : '▸'} {rooms.length > 0 ? 'Start a new room' : 'Choose a PDF'}
                    </button>
                    {showNewPdf && (
                      <div className="space-y-2">
                        {whiteboards.filter(p => p.pdf_url && !rooms.find(r => r.pdf_url === p.pdf_url)).map((p: any) => (
                          <button key={p.id} onClick={() => launchGauntlet(p.pdf_url, p.pdf_name || p.name)}
                            className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition hover:bg-[#F7F7F5]"
                            style={{ borderColor: NOTION.border }}>
                            <span>📄</span>
                            <span className="flex-1 truncate font-medium">{p.pdf_name || p.name}</span>
                            <span className="text-xs" style={{ color: '#6366F1' }}>Start →</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {rooms.length === 0 && !loadingWb && whiteboards.filter(p => p.pdf_url).length === 0 && (
                  <p className="text-sm" style={{ color: NOTION.muted }}>
                    No PDFs uploaded for this module yet. Upload one from the{' '}
                    <Link href="/whiteboard" className="underline">Whiteboard</Link>.
                  </p>
                )}
              </>
            ))}
          </div>
        )}

        {/* ── Jeopardy picker ── */}
        {showJeopardyPicker && (
          <div className="mt-8 rounded-xl border bg-white p-6" style={{ borderColor: NOTION.border }}>
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">🏆 Choose a flashcard set for Jeopardy</span>
              <button onClick={() => { setShowJeopardyPicker(false); setJeopardyCourse(''); setSets([]) }}
                className="text-sm" style={{ color: NOTION.muted }}>✕</button>
            </div>
            <label className="mb-1 block text-xs font-medium" style={{ color: NOTION.muted }}>Module</label>
            <select value={jeopardyCourse} onChange={e => { setJeopardyCourse(e.target.value); setSets([]) }}
              className="mb-4 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: NOTION.border }}>
              <option value="">Select a module…</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {jeopardyCourse && (
              loadingSets ? (
                <p className="text-sm" style={{ color: NOTION.muted }}>Loading sets…</p>
              ) : sets.length === 0 ? (
                <p className="text-sm" style={{ color: NOTION.muted }}>
                  No flashcard sets for this module yet.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="mb-1 block text-xs font-medium" style={{ color: NOTION.muted }}>Set</label>
                  {sets.map(s => (
                    <button key={s.id} onClick={() => launchJeopardy(s.id)}
                      className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition hover:bg-[#F7F7F5]"
                      style={{ borderColor: NOTION.border }}>
                      <span>🃏</span>
                      <span className="flex-1 truncate font-medium">{s.title}</span>
                      <span className="text-xs" style={{ color: '#F59E0B' }}>Play →</span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}

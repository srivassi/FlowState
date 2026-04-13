'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '../../lib/api'

// ─── Playlists ────────────────────────────────────────────────
const DEFAULT_PLAYLISTS = [
  { id: 'none',   label: 'No music',        icon: '🔇', url: null },
  { id: 'lofi',   label: 'Lo-fi beats',     icon: '🎵', url: 'https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1&controls=0&loop=1&playlist=jfKfPfyJRdk' },
  { id: 'rain',   label: 'Rain & thunder',  icon: '🌧️', url: 'https://www.youtube.com/embed/mPZkdNFkNps?autoplay=1&controls=0&loop=1&playlist=mPZkdNFkNps' },
  { id: 'jazz',   label: 'Jazz coffee',     icon: '☕', url: 'https://www.youtube.com/embed/VMAPTo7RVCo?autoplay=1&controls=0&loop=1&playlist=VMAPTo7RVCo' },
  { id: 'nature', label: 'Forest sounds',   icon: '🌿', url: 'https://www.youtube.com/embed/xNN7iTA57jM?autoplay=1&controls=0&loop=1&playlist=xNN7iTA57jM' },
  { id: 'space',  label: 'Space ambience',  icon: '🚀', url: 'https://www.youtube.com/embed/ZB4bKBKQ2Yg?autoplay=1&controls=0&loop=1&playlist=ZB4bKBKQ2Yg' },
  { id: 'sitar',  label: 'Indian Classical', icon: '🪕', url: null },  // user sets URL via input
]

function ytEmbedUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    let id = ''
    if (u.hostname.includes('youtu.be')) {
      id = u.pathname.slice(1)
    } else {
      id = u.searchParams.get('v') || ''
    }
    if (!id) return null
    return `https://www.youtube.com/embed/${id}?autoplay=1&controls=0&loop=1&playlist=${id}`
  } catch {
    return null
  }
}

// ─── Scenes ───────────────────────────────────────────────────
const SCENES = [
  { id: 'coffee',    label: 'Coffee',     icon: '☕' },
  { id: 'plant',     label: 'Plant',      icon: '🌱' },
  { id: 'butterfly', label: 'Butterfly',  icon: '🦋' },
  { id: 'flight',    label: 'Flight',     icon: '✈️' },
  { id: 'candle',    label: 'Candle',     icon: '🕯️' },
]

// ─── Motivational messages ────────────────────────────────────
const MESSAGES = [
  "Every minute you focus now is a minute you don't have to stress later.",
  "The person who is studying right now will thank you.",
  "Discomfort is where growth lives. Stay with it.",
  "One pomodoro at a time. That's all.",
  "You don't have to feel motivated — you just have to start.",
  "Deep work is a superpower. You're building it right now.",
  "The exam is coming. Future you is counting on present you.",
  "Eliminate the noise. Just you and the material.",
  "Consistency beats intensity every time.",
  "You've done hard things before. This is just another one.",
  "Small progress is still progress.",
  "The only way out is through.",
  "Stay curious. The concepts are interesting if you let them be.",
  "Close the tabs. Open the book. Begin.",
  "This session matters. Make it count.",
]

// ─── Scene components ─────────────────────────────────────────

function CoffeeScene({ progress }: { progress: number }) {
  return (
    <div className="relative flex items-end justify-center" style={{ height: 220 }}>
      {/* Cup */}
      <div className="relative" style={{ width: 90, height: 80 }}>
        <div style={{
          width: 90, height: 80, borderRadius: '0 0 20px 20px',
          background: 'linear-gradient(180deg,#6b3f1f 0%,#3d1f0a 100%)',
          position: 'absolute', bottom: 0,
        }} />
        {/* Liquid fill based on progress */}
        <div style={{
          position: 'absolute', bottom: 4, left: 6, right: 6,
          height: `${30 + progress * 0.4}%`,
          borderRadius: '0 0 14px 14px',
          background: 'linear-gradient(180deg,#c97b3b 0%,#7a3f10 100%)',
          transition: 'height 2s ease',
        }} />
        {/* Handle */}
        <div style={{
          position: 'absolute', right: -18, top: 15,
          width: 18, height: 35,
          border: '5px solid #6b3f1f',
          borderLeft: 'none',
          borderRadius: '0 12px 12px 0',
        }} />
        {/* Saucer */}
        <div style={{
          position: 'absolute', bottom: -8, left: -10, right: -10,
          height: 10, borderRadius: 10,
          background: '#6b3f1f',
        }} />
      </div>
      {/* Steam wisps */}
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute',
          bottom: 88,
          left: `calc(50% + ${(i - 1) * 18}px)`,
          width: 3,
          height: 28,
          borderRadius: 4,
          background: 'rgba(255,255,255,0.35)',
          animation: `steam${i} 2.4s ease-in-out infinite`,
          animationDelay: `${i * 0.5}s`,
        }} />
      ))}
      <style>{`
        @keyframes steam0 { 0%,100%{transform:translateY(0) scaleX(1);opacity:.35} 50%{transform:translateY(-18px) scaleX(1.6);opacity:0} }
        @keyframes steam1 { 0%,100%{transform:translateY(0) scaleX(1);opacity:.3} 50%{transform:translateY(-22px) scaleX(1.4);opacity:0} }
        @keyframes steam2 { 0%,100%{transform:translateY(0) scaleX(1);opacity:.35} 50%{transform:translateY(-16px) scaleX(1.8);opacity:0} }
      `}</style>
    </div>
  )
}

function PlantScene({ progress }: { progress: number }) {
  const h = 20 + progress * 1.6
  const leaves = progress > 30
  const flower = progress > 75
  return (
    <div className="flex items-end justify-center" style={{ height: 220, position: 'relative' }}>
      {/* Pot */}
      <div style={{
        width: 70, height: 50, borderRadius: '4px 4px 14px 14px',
        background: 'linear-gradient(180deg,#c1440e 0%,#8b3009 100%)',
        position: 'absolute', bottom: 0,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      }}>
        <div style={{ width: 80, height: 12, borderRadius: 4, background: '#a33a0a', marginTop: -6 }} />
      </div>
      {/* Stem */}
      <div style={{
        position: 'absolute', bottom: 44,
        width: 6, borderRadius: 3,
        height: h,
        background: 'linear-gradient(180deg,#4caf50,#2e7d32)',
        transition: 'height 1.5s ease',
      }} />
      {/* Leaves */}
      {leaves && (
        <>
          <div style={{
            position: 'absolute', bottom: 44 + h * 0.4,
            left: `calc(50% - 2px)`,
            width: Math.min(40, progress * 0.5), height: 14,
            borderRadius: '50%', background: '#4caf50',
            transformOrigin: 'left center',
            transform: 'rotate(-30deg)',
            transition: 'width 1.5s ease',
          }} />
          <div style={{
            position: 'absolute', bottom: 44 + h * 0.6,
            right: `calc(50% - 2px)`,
            width: Math.min(34, progress * 0.4), height: 12,
            borderRadius: '50%', background: '#66bb6a',
            transformOrigin: 'right center',
            transform: 'rotate(30deg)',
            transition: 'width 1.5s ease',
          }} />
        </>
      )}
      {/* Flower */}
      {flower && (
        <div style={{
          position: 'absolute', bottom: 44 + h,
          fontSize: 28,
          animation: 'bloomIn 1s ease forwards',
        }}>🌸</div>
      )}
      <style>{`@keyframes bloomIn { from{opacity:0;transform:scale(0)} to{opacity:1;transform:scale(1)} }`}</style>
    </div>
  )
}

function ButterflyScene({ progress }: { progress: number }) {
  const phase = progress < 33 ? 'egg' : progress < 66 ? 'cocoon' : 'butterfly'
  return (
    <div className="flex flex-col items-center justify-end" style={{ height: 220, gap: 8 }}>
      <div style={{ fontSize: 20, opacity: 0.5, color: 'rgba(255,255,255,0.6)' }}>
        {phase === 'egg' && 'forming…'}
        {phase === 'cocoon' && 'transforming…'}
        {phase === 'butterfly' && 'emerged ✨'}
      </div>
      <div style={{
        fontSize: phase === 'butterfly' ? 80 : 60,
        transition: 'font-size 1.5s ease',
        animation: phase === 'butterfly' ? 'flutter 1.8s ease-in-out infinite' : phase === 'cocoon' ? 'pulse 2s ease-in-out infinite' : 'none',
        filter: phase === 'cocoon' ? 'brightness(0.6)' : 'none',
      }}>
        {phase === 'egg' ? '🥚' : phase === 'cocoon' ? '🫘' : '🦋'}
      </div>
      <div style={{ width: 200, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, borderRadius: 3, background: 'rgba(255,255,255,0.6)', transition: 'width 1s ease' }} />
      </div>
      <style>{`
        @keyframes flutter { 0%,100%{transform:translateY(0) rotate(-3deg)} 50%{transform:translateY(-12px) rotate(3deg)} }
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
      `}</style>
    </div>
  )
}

function FlightScene({ progress }: { progress: number }) {
  const x = (progress / 100) * 70  // plane moves across
  return (
    <div style={{ position: 'relative', height: 220, overflow: 'hidden' }}>
      {/* Sky gradient */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, rgba(10,20,60,0.${Math.floor(30 + progress * 0.5)}) 0%, rgba(255,150,50,0.15) 100%)`,
        borderRadius: 16,
      }} />
      {/* Stars fading in */}
      {progress > 50 && [0,1,2,3,4,5,6,7].map(i => (
        <div key={i} style={{
          position: 'absolute',
          top: `${8 + (i * 13) % 40}%`,
          left: `${5 + (i * 17) % 85}%`,
          width: 2, height: 2, borderRadius: '50%',
          background: 'white', opacity: (progress - 50) / 100,
        }} />
      ))}
      {/* Cloud */}
      <div style={{
        position: 'absolute', top: '35%',
        left: `${20 - progress * 0.15}%`,
        fontSize: 32, opacity: 0.3,
        transition: 'left 3s linear',
      }}>☁️</div>
      <div style={{
        position: 'absolute', top: '55%',
        left: `${60 - progress * 0.12}%`,
        fontSize: 22, opacity: 0.2,
        transition: 'left 3s linear',
      }}>☁️</div>
      {/* Plane */}
      <div style={{
        position: 'absolute',
        top: `${30 - Math.sin(progress / 15) * 8}%`,
        left: `${x}%`,
        fontSize: 36,
        transition: 'left 2s ease-out, top 1s ease-in-out',
        transform: 'scaleX(-1)',
      }}>✈️</div>
      {/* Route line */}
      <div style={{
        position: 'absolute',
        top: '43%', left: '5%',
        width: `${x}%`, height: 1,
        borderTop: '1px dashed rgba(255,255,255,0.3)',
        transition: 'width 2s ease-out',
      }} />
      {/* Progress label */}
      <div style={{
        position: 'absolute', bottom: 12, right: 16,
        fontSize: 11, color: 'rgba(255,255,255,0.5)',
      }}>
        {Math.round(progress)}% of journey
      </div>
    </div>
  )
}

function CandleScene({ progress }: { progress: number }) {
  const flameH = 28 + Math.sin(Date.now() / 300) * 4
  return (
    <div className="flex items-end justify-center" style={{ height: 220, position: 'relative' }}>
      {/* Glow */}
      <div style={{
        position: 'absolute', bottom: 80,
        width: 100, height: 100,
        borderRadius: '50%',
        background: `radial-gradient(circle, rgba(255,200,50,${0.08 + progress * 0.001}) 0%, transparent 70%)`,
        animation: 'glowPulse 2s ease-in-out infinite',
      }} />
      {/* Candle body */}
      <div style={{
        width: 28,
        height: 70 + (1 - progress / 100) * 50,  // burns down
        borderRadius: '3px 3px 0 0',
        background: 'linear-gradient(90deg,#f5f0e8,#ede8de,#f5f0e8)',
        position: 'absolute', bottom: 0,
        transition: 'height 10s linear',
      }} />
      {/* Wick */}
      <div style={{
        position: 'absolute',
        bottom: 72 + (1 - progress / 100) * 50,
        width: 3, height: 8,
        background: '#333', borderRadius: 2,
        transition: 'bottom 10s linear',
      }} />
      {/* Flame */}
      <div style={{
        position: 'absolute',
        bottom: 80 + (1 - progress / 100) * 50,
        fontSize: 28,
        animation: 'flicker 0.8s ease-in-out infinite alternate',
        transition: 'bottom 10s linear',
      }}>🔥</div>
      <style>{`
        @keyframes flicker { from{transform:scaleX(1) rotate(-2deg)} to{transform:scaleX(0.85) rotate(2deg)} }
        @keyframes glowPulse { 0%,100%{opacity:0.8} 50%{opacity:1.2} }
      `}</style>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

function FocusInner() {
  const router = useRouter()
  const params = useSearchParams()

  const taskTitle = params.get('title') || 'Focus session'
  const taskId = params.get('taskId')
  const sessionId = params.get('sessionId')
  const userId = params.get('userId')
  const totalSeconds = parseInt(params.get('duration') || '25') * 60

  const [timeLeft, setTimeLeft] = useState(totalSeconds)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [notes, setNotes] = useState('')
  const [playlist, setPlaylist] = useState('lofi')
  const [scene, setScene] = useState('coffee')
  const [msgIdx, setMsgIdx] = useState(0)
  const [msgVisible, setMsgVisible] = useState(true)
  const [showControls, setShowControls] = useState(true)
  // custom playlists: id → url string (raw YouTube link)
  const [customUrls, setCustomUrls] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('focusCustomUrls') || '{}') } catch { return {} }
  })
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')

  const PLAYLISTS = DEFAULT_PLAYLISTS.map(p =>
    customUrls[p.id] ? { ...p, url: ytEmbedUrl(customUrls[p.id]) ?? p.url } : p
  )

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const controlsRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const progress = Math.round(((totalSeconds - timeLeft) / totalSeconds) * 100)
  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  // Timer
  useEffect(() => {
    if (running && !done) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!)
            setRunning(false)
            setDone(true)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [running, done])

  // Rotate motivational messages every 8s with fade
  useEffect(() => {
    msgRef.current = setInterval(() => {
      setMsgVisible(false)
      setTimeout(() => {
        setMsgIdx(i => (i + 1) % MESSAGES.length)
        setMsgVisible(true)
      }, 600)
    }, 8000)
    return () => { if (msgRef.current) clearInterval(msgRef.current) }
  }, [])

  // Auto-hide controls after 4s of no movement
  useEffect(() => {
    const reset = () => {
      setShowControls(true)
      if (controlsRef.current) clearTimeout(controlsRef.current)
      if (running) {
        controlsRef.current = setTimeout(() => setShowControls(false), 4000)
      }
    }
    window.addEventListener('mousemove', reset)
    window.addEventListener('touchstart', reset)
    return () => { window.removeEventListener('mousemove', reset); window.removeEventListener('touchstart', reset) }
  }, [running])

  const saveCustomUrl = (id: string) => {
    const next = { ...customUrls, [id]: urlDraft }
    setCustomUrls(next)
    localStorage.setItem('focusCustomUrls', JSON.stringify(next))
    setShowUrlInput(false)
    setUrlDraft('')
  }

  const handleComplete = async () => {
    if (sessionId) {
      await api.completePomodoro(sessionId, notes || undefined).catch(() => {})
    }
    router.push('/dashboard')
  }

  const selectedPlaylist = PLAYLISTS.find(p => p.id === playlist)!

  // Scene renderer
  const renderScene = () => {
    switch (scene) {
      case 'coffee':    return <CoffeeScene progress={progress} />
      case 'plant':     return <PlantScene progress={progress} />
      case 'butterfly': return <ButterflyScene progress={progress} />
      case 'flight':    return <FlightScene progress={progress} />
      case 'candle':    return <CandleScene progress={progress} />
      default:          return <CoffeeScene progress={progress} />
    }
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden select-none"
      style={{ background: 'linear-gradient(135deg,#0f0f1a 0%,#1a1025 50%,#0a1520 100%)', fontFamily: "Inter, sans-serif" }}>

      {/* YouTube audio (hidden) */}
      {selectedPlaylist.url && (
        <iframe
          src={`${selectedPlaylist.url}&mute=0`}
          allow="autoplay"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          title="ambient audio"
        />
      )}

      {/* Subtle noise texture overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'0.035\'/%3E%3C/svg%3E")',
      }} />

      {/* ── Done screen ── */}
      {done && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center" style={{ background: 'rgba(10,10,26,0.95)' }}>
          <div className="mb-4 text-7xl" style={{ animation: 'bloomIn 0.6s ease' }}>🎉</div>
          <div className="mb-2 text-3xl font-bold text-white">Session complete!</div>
          <div className="mb-8 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {Math.round(totalSeconds / 60)} minutes of deep work done.
          </div>
          <textarea
            placeholder="Any notes? What did you cover?"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="mb-6 w-80 resize-none rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <button
            onClick={handleComplete}
            className="rounded-xl px-8 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            Save & return to dashboard →
          </button>
          <style>{`@keyframes bloomIn{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
        </div>
      )}

      {/* ── Top bar (task name + back) ── */}
      <div className="flex items-center justify-between px-6 py-4"
        style={{ opacity: showControls ? 1 : 0, transition: 'opacity 0.5s ease' }}>
        <button onClick={() => router.push('/dashboard')}
          className="text-sm transition hover:opacity-80"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          ← Back
        </button>
        <div className="truncate max-w-xs text-sm font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {taskTitle}
        </div>
        <div style={{ width: 48 }} />
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">

        {/* Timer ring */}
        <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
          <svg width="200" height="200" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
            <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
            <circle cx="100" cy="100" r="88" fill="none"
              stroke="url(#timerGrad)" strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 88}`}
              strokeDashoffset={`${2 * Math.PI * 88 * (timeLeft / totalSeconds)}`}
              style={{ transition: 'stroke-dashoffset 1s linear' }} />
            <defs>
              <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
          <div className="text-center">
            <div className="text-5xl font-bold tabular-nums text-white">
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </div>
            <div className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {progress}% complete
            </div>
          </div>
        </div>

        {/* Play / pause */}
        <button
          onClick={() => setRunning(r => !r)}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white text-2xl transition hover:scale-105 active:scale-95"
          style={{ background: running ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: '1px solid rgba(255,255,255,0.15)' }}>
          {running ? '⏸' : '▶'}
        </button>

        {/* Motivational message */}
        <div className="max-w-sm text-center text-sm leading-relaxed"
          style={{
            color: 'rgba(255,255,255,0.5)',
            minHeight: 40,
            opacity: msgVisible ? 1 : 0,
            transition: 'opacity 0.6s ease',
            fontStyle: 'italic',
            letterSpacing: '0.01em',
          }}>
          "{MESSAGES[msgIdx]}"
        </div>

        {/* Ambient scene */}
        <div className="w-full max-w-xs">
          {renderScene()}
        </div>

      </div>

      {/* ── Bottom controls ── */}
      <div className="px-6 py-5"
        style={{ opacity: showControls ? 1 : 0, transition: 'opacity 0.5s ease' }}>

        {/* Scene picker */}
        <div className="mb-4 flex justify-center gap-2">
          {SCENES.map(s => (
            <button key={s.id} onClick={() => setScene(s.id)}
              title={s.label}
              className="flex h-9 w-9 items-center justify-center rounded-full text-base transition"
              style={{
                background: scene === s.id ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)',
                border: scene === s.id ? '1px solid rgba(99,102,241,0.8)' : '1px solid rgba(255,255,255,0.1)',
              }}>
              {s.icon}
            </button>
          ))}
        </div>

        {/* Music picker */}
        <div className="flex justify-center gap-2 flex-wrap">
          {PLAYLISTS.map(p => (
            <div key={p.id} className="flex items-center">
              <button onClick={() => {
                setPlaylist(p.id)
                setShowUrlInput(false)
              }}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition"
                style={{
                  background: playlist === p.id ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)',
                  border: playlist === p.id ? '1px solid rgba(99,102,241,0.7)' : '1px solid rgba(255,255,255,0.1)',
                  color: playlist === p.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)',
                  borderRadius: p.id !== 'none' ? '9999px 0 0 9999px' : '9999px',
                  borderRight: p.id !== 'none' ? 'none' : undefined,
                }}>
                <span>{p.icon}</span>
                <span>{p.label}</span>
              </button>
              {p.id !== 'none' && (
                <button
                  onClick={() => {
                    setPlaylist(p.id)
                    setUrlDraft(customUrls[p.id] || '')
                    setShowUrlInput(true)
                  }}
                  title="Set custom YouTube URL"
                  className="flex items-center justify-center h-full px-1.5 py-1.5 text-xs transition hover:opacity-80"
                  style={{
                    background: playlist === p.id ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)',
                    border: playlist === p.id ? '1px solid rgba(99,102,241,0.7)' : '1px solid rgba(255,255,255,0.1)',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '0 9999px 9999px 0',
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: 10,
                  }}>
                  ✏️
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Custom URL input — shown when selected playlist has no built-in URL or user clicks ✏️ */}
        {showUrlInput && (
          <div className="mt-3 flex items-center gap-2 justify-center">
            <input
              autoFocus
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              placeholder="Paste YouTube URL…"
              className="rounded-lg px-3 py-1.5 text-xs text-white outline-none w-64"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)' }}
              onKeyDown={e => { if (e.key === 'Enter') saveCustomUrl(playlist) }}
            />
            <button
              onClick={() => saveCustomUrl(playlist)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-80"
              style={{ background: 'rgba(99,102,241,0.5)', border: '1px solid rgba(99,102,241,0.6)' }}>
              Set
            </button>
            <button
              onClick={() => setShowUrlInput(false)}
              className="text-xs transition hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.3)' }}>✕</button>
          </div>
        )}
      </div>

    </div>
  )
}

export default function FocusPage() {
  return (
    <Suspense>
      <FocusInner />
    </Suspense>
  )
}

'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

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

type Task = {
  id: string
  title: string
  status: 'todo' | 'in_progress' | 'done'
  estimated_minutes: number
  priority: string
  task_type: string
  scheduled_date: string
  courses?: { name: string; color: string }
}

type Course = {
  id: string
  name: string
  color: string
  exam_date?: string
}

type Stats = {
  tasks_completed: number
  total_focus_minutes: number
  streak_days: number
  weekly_pomodoros: { date: string; count: number }[]
}

const COVER_IMAGES = [
  'https://plus.unsplash.com/premium_photo-1661962542692-4fe7a4ad6b54?w=1200&h=280&fit=crop',
  'https://plus.unsplash.com/premium_photo-1697729844084-c03db2377161?w=1200&h=280&fit=crop',
  'https://plus.unsplash.com/premium_photo-1661963691068-e8fffe491afa?w=1200&h=280&fit=crop',
  'https://images.unsplash.com/photo-1595433306946-233f47e4af3a?w=1200&h=280&fit=crop',
  'https://plus.unsplash.com/premium_photo-1697730373510-51b7fcf2ff52?w=1200&h=280&fit=crop',
  'https://images.unsplash.com/photo-1601821139990-9fc929db79ce?w=1200&h=280&fit=crop',
]

function NotionBtn({ onClick, children, className = '' }: { onClick?: () => void; children: React.ReactNode; className?: string }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      className={`px-3 py-1.5 text-sm font-medium transition-colors ${className}`}
      style={{ border: `1px solid ${NOTION.btnBorder}`, borderRadius: 4, backgroundColor: hov ? NOTION.hover : NOTION.btn, color: NOTION.text }}>
      {children}
    </button>
  )
}

export default function Dashboard() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string>('')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [showRescheduleModal, setShowRescheduleModal] = useState(false)
  const [rescheduleFeedback, setRescheduleFeedback] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState('')
  const [rescheduleSuccess, setRescheduleSuccess] = useState(false)
  const [rescheduleInterleave, setRescheduleInterleave] = useState(true)
  const [rescheduleSessionsOverride, setRescheduleSessionsOverride] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewSummary, setPreviewSummary] = useState('')
  const [previewDirectives, setPreviewDirectives] = useState<any>(null)
  const [showEOD, setShowEOD] = useState(false)
  const [eodChecked, setEodChecked] = useState<Set<string>>(new Set())
  const [eodNotes, setEodNotes] = useState('')
  const [eodSubmitting, setEodSubmitting] = useState(false)
  const [courses, setCourses] = useState<Course[]>([])
  const [todayTasks, setTodayTasks] = useState<Task[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null)
  const [courseTasks, setCourseTasks] = useState<Task[]>([])
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionNotes, setSessionNotes] = useState('')
  const [view, setView] = useState<'today' | 'board'>('today')
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      const name = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || ''
      setUserName(name)
      const [plan, statsData, coursesData, profileData] = await Promise.all([
        api.getTodayPlan(uid).catch(() => ({ tasks: [] })),
        api.getStats(uid).catch(() => null),
        api.getCourses(uid).catch(() => []),
        api.getProfile(uid).catch(() => null),
      ])
      setTodayTasks(plan.tasks || [])
      setStats(statsData)
      setCourses(coursesData)
      setProfile(profileData)
      setLoading(false)
    })
  }, [router])

  // Timer
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { clearInterval(timerRef.current!); setIsRunning(false); handlePomodoroComplete(); return 0 }
          return prev - 1
        })
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [isRunning])

  const startTimer = async (task: Task) => {
    if (!userId) return
    try {
      const session = await api.startPomodoro({ task_id: task.id, user_id: userId, duration_minutes: task.estimated_minutes })
      router.push(`/focus?title=${encodeURIComponent(task.title)}&taskId=${task.id}&sessionId=${session.id}&userId=${userId}&duration=${task.estimated_minutes}`)
    } catch (e) { console.error(e) }
  }

  const handlePomodoroComplete = async () => {
    if (!activeSessionId || !userId) return
    try {
      await api.completePomodoro(activeSessionId, sessionNotes || undefined)
      setTodayTasks(prev => prev.map(t => t.id === activeTask?.id ? { ...t, status: 'done' } : t))
      setCourseTasks(prev => prev.map(t => t.id === activeTask?.id ? { ...t, status: 'done' } : t))
      setActiveTask(null); setActiveSessionId(null); setSessionNotes('')
      const s = await api.getStats(userId); setStats(s)
    } catch (e) { console.error(e) }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/signin')
  }

  const handleSaveName = async () => {
    if (!nameInput.trim()) return
    await supabase.auth.updateUser({ data: { full_name: nameInput.trim() } })
    setUserName(nameInput.trim())
    setEditingName(false)
  }

  const loadCourse = async (course: Course) => {
    setSelectedCourse(course)
    setView('today')
    const tasks = await api.getTasks(course.id).catch(() => [])
    setCourseTasks(tasks)
  }

  const moveTask = async (task: Task, status: Task['status']) => {
    await api.updateTaskStatus(task.id, status)
    setCourseTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t))
  }

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const totalSecs = (activeTask?.estimated_minutes || 25) * 60
  const progress = ((totalSecs - timeLeft) / totalSecs) * 100

  const coverIdx = selectedCourse ? (courses.indexOf(selectedCourse) % COVER_IMAGES.length) : 0
  const coverUrl = COVER_IMAGES[coverIdx]

  const todoTasks     = courseTasks.filter(t => t.status === 'todo')
  const inProgTasks   = courseTasks.filter(t => t.status === 'in_progress')
  const doneTasks     = courseTasks.filter(t => t.status === 'done')

  if (loading) return (
    <div className="flex h-screen items-center justify-center" style={{ backgroundColor: NOTION.bg }}>
      <div style={{ color: NOTION.muted, fontFamily: 'Inter, sans-serif' }}>Loading...</div>
    </div>
  )

  return (
    <div className="flex h-screen" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* ── Sidebar ── */}
      <div className="flex w-60 shrink-0 flex-col overflow-y-auto" style={{ backgroundColor: NOTION.sidebar, borderRight: `1px solid ${NOTION.border}` }}>
        <div className="p-3">
          {/* Logo */}
          <div className="mb-4 flex cursor-pointer items-center gap-2 rounded px-2 py-2 transition-colors hover:bg-[#EFEFED]"
            onClick={() => setSelectedCourse(null)}>
            <span className="text-xl">🎓</span>
            <span className="text-sm font-semibold" style={{ color: NOTION.text }}>{userName ? `${userName}'s Planner` : 'Study Planner'}</span>
          </div>

          {/* Nav */}
          <div className="mb-2 space-y-0.5">
            {[
              { href: '/dashboard',   label: 'Dashboard',  icon: '🏠' },
              { href: '/calendar',    label: 'Calendar',   icon: '📅' },
              { href: '/flashcards',  label: 'Flashcards', icon: '🃏' },
              { href: '/whiteboard',  label: 'Whiteboard', icon: '🎨' },
              { href: '/settings',    label: 'Settings',   icon: '⚙️' },
            ].map(item => (
              <Link key={item.href} href={item.href}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-[#EFEFED]"
                style={{ color: NOTION.text }}>
                <span>{item.icon}</span>{item.label}
              </Link>
            ))}
          </div>

          <div className="mb-2 mt-4 px-2 text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>Modules</div>

          {/* Courses */}
          <div className="space-y-0.5">
            {courses.map(c => (
              <div key={c.id} onClick={() => loadCourse(c)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors"
                style={{ backgroundColor: selectedCourse?.id === c.id ? NOTION.hover : 'transparent', color: NOTION.text }}
                onMouseEnter={e => { if (selectedCourse?.id !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = NOTION.hover }}
                onMouseLeave={e => { if (selectedCourse?.id !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="truncate">{c.name}</span>
              </div>
            ))}
            <Link href="/modules/new"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-[#EFEFED]"
              style={{ color: NOTION.muted }}>
              <span>+</span> Add module
            </Link>
          </div>

          {/* Pomodoro */}
          <div className="mt-6 p-3" style={{ border: `1px solid ${NOTION.border}`, borderRadius: 4, backgroundColor: '#FFFFFF' }}>
            <div className="mb-2 text-xs font-semibold" style={{ color: NOTION.muted }}>FOCUS SESSION</div>
            {activeTask && <div className="mb-1 truncate text-xs font-medium" style={{ color: NOTION.text }}>{activeTask.title}</div>}
            <div className="mb-2 text-center text-xl font-semibold tabular-nums" style={{ color: NOTION.text }}>
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </div>
            {/* Progress bar */}
            <div className="mb-3 h-1 overflow-hidden rounded-full" style={{ backgroundColor: NOTION.hover }}>
              <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${progress}%`, backgroundColor: NOTION.text }} />
            </div>
            {activeTask ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <NotionBtn onClick={() => setIsRunning(!isRunning)} className="flex-1">{isRunning ? 'Pause' : 'Resume'}</NotionBtn>
                  <NotionBtn onClick={handlePomodoroComplete}>Done ✓</NotionBtn>
                </div>
                <textarea placeholder="Quick note…" value={sessionNotes} onChange={e => setSessionNotes(e.target.value)} rows={2}
                  className="w-full resize-none rounded px-2 py-1.5 text-xs text-gray-900 placeholder-gray-400"
                  style={{ border: `1px solid ${NOTION.border}`, backgroundColor: NOTION.bg }} />
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <NotionBtn onClick={() => setIsRunning(!isRunning)} className="flex-1">{isRunning ? 'Pause' : 'Start'}</NotionBtn>
                  <NotionBtn onClick={() => { setTimeLeft(25 * 60); setIsRunning(false) }}>↺</NotionBtn>
                </div>
                <div className="mt-2 text-center text-xs" style={{ color: NOTION.muted }}>Pick a task to link</div>
              </>
            )}
          </div>
        </div>

        {/* Profile + sign out */}
        <div className="mt-auto border-t p-3" style={{ borderColor: NOTION.border }}>
          {editingName ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
                className="flex-1 rounded border px-2 py-1 text-xs text-gray-900 bg-white"
                style={{ borderColor: NOTION.border }}
                placeholder="Your name"
              />
              <button onClick={handleSaveName} className="text-xs px-2 py-1 rounded" style={{ backgroundColor: NOTION.hover, color: NOTION.text }}>Save</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setNameInput(userName); setEditingName(true) }}
                className="flex items-center gap-2 text-xs rounded px-2 py-1 hover:bg-[#EFEFED] transition-colors"
                style={{ color: NOTION.text }}
                title="Edit name"
              >
                <span className="text-base">👤</span>
                <span className="truncate max-w-25">{userName || 'Set your name'}</span>
              </button>
              <button
                onClick={handleSignOut}
                className="text-xs rounded px-2 py-1 hover:bg-[#EFEFED] transition-colors"
                style={{ color: NOTION.muted }}
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: NOTION.bg }}>

        {/* Cover + title */}
        <div className="relative h-52">
          <img src={selectedCourse ? coverUrl : COVER_IMAGES[1]} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-end px-16 py-6"
            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' }}>
            <div>
              <h1 className="text-4xl font-bold text-white leading-tight">
                {selectedCourse ? selectedCourse.name : `${getGreeting()}${userName ? ', ' + userName : ''}`}
              </h1>
              {!selectedCourse && stats && (
                <div className="mt-1 text-sm text-white/75">🔥 {stats.streak_days} day streak</div>
              )}
              {selectedCourse?.exam_date && (
                <div className="mt-1 text-sm text-white/75">
                  Exam {new Date(selectedCourse.exam_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-16 py-8">

          {/* ── Overview ── */}
          {!selectedCourse && (
            <>
              {/* Stats */}
              {stats && (
                <div className="mb-8 grid grid-cols-4 gap-4">
                  {[
                    { icon: '🎯', value: stats.tasks_completed, label: 'Tasks done' },
                    { icon: '⏱️', value: `${Math.round(stats.total_focus_minutes / 60)}h`, label: 'Focus time' },
                    { icon: '🔥', value: stats.streak_days, label: 'Day streak' },
                    { icon: '🍅', value: stats.weekly_pomodoros.reduce((s, d) => s + d.count, 0), label: 'Pomodoros this week' },
                  ].map((s, i) => (
                    <div key={i} className="p-4" style={{ border: `1px solid ${NOTION.border}`, borderRadius: 4 }}>
                      <div className="mb-1 text-2xl">{s.icon}</div>
                      <div className="text-xl font-semibold" style={{ color: NOTION.text }}>{s.value}</div>
                      <div className="text-xs" style={{ color: NOTION.muted }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Weekly chart */}
              {stats?.weekly_pomodoros && (
                <div className="mb-8 p-6" style={{ border: `1px solid ${NOTION.border}`, borderRadius: 4 }}>
                  <h2 className="mb-4 text-2xl font-semibold" style={{ color: NOTION.text }}>Weekly Pomodoros</h2>
                  <div className="flex items-end gap-3" style={{ height: 100 }}>
                    {stats.weekly_pomodoros.map((d, i) => {
                      const max = Math.max(...stats.weekly_pomodoros.map(x => x.count), 1)
                      const h = Math.max(4, (d.count / max) * 90)
                      const isToday = d.date === (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}` })()
                      return (
                        <div key={i} className="flex flex-1 flex-col items-center gap-1">
                          {d.count > 0 && <div className="text-xs" style={{ color: NOTION.muted }}>{d.count}</div>}
                          <div className="w-full rounded-sm transition-all"
                            style={{ height: h, backgroundColor: isToday ? NOTION.text : '#D3D1CB', borderRadius: 2 }} />
                          <div className="text-xs" style={{ color: NOTION.muted }}>
                            {new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Today's tasks */}
              <div className="p-6" style={{ border: `1px solid ${NOTION.border}`, borderRadius: 4 }}>
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-semibold" style={{ color: NOTION.text }}>Today</h2>
                    {rescheduleSuccess && (
                      <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
                        ✓ Schedule updated
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEodChecked(new Set(todayTasks.filter(t => t.status === 'done').map(t => t.id))); setShowEOD(true) }}
                      className="rounded px-2.5 py-1 text-xs font-medium transition hover:bg-[#EFEFED]"
                      style={{ border: `1px solid ${NOTION.border}`, color: NOTION.text }}>
                      📋 End of day
                    </button>
                    <button onClick={() => setShowRescheduleModal(true)}
                      className="rounded px-2.5 py-1 text-xs font-medium transition hover:bg-[#EFEFED]"
                      style={{ border: `1px solid ${NOTION.border}`, color: NOTION.text }}>
                      ↺ Regenerate
                    </button>
                    <Link href="/calendar" className="text-sm" style={{ color: NOTION.muted }}>Full calendar →</Link>
                  </div>
                </div>
                {todayTasks.length === 0 ? (
                  <div className="py-8 text-center text-sm" style={{ color: NOTION.muted }}>
                    No tasks scheduled today.{' '}
                    <Link href="/modules/new" style={{ color: NOTION.text }}>Add a module →</Link>
                  </div>
                ) : (() => {
                  // Group tasks into study blocks based on session_duration_minutes from profile
                  const blockMinutes = profile?.session_duration_minutes || (profile?.daily_study_hours ? Math.round((profile.daily_study_hours * 60) / (profile?.sessions_per_day || 3)) : 180)
                  const blocks: Task[][] = []
                  let current: Task[] = []
                  let elapsed = 0
                  for (const task of todayTasks) {
                    if (elapsed > 0 && elapsed + task.estimated_minutes > blockMinutes) {
                      blocks.push(current)
                      current = []
                      elapsed = 0
                    }
                    current.push(task)
                    elapsed += task.estimated_minutes
                  }
                  if (current.length) blocks.push(current)

                  return (
                    <div className="space-y-6">
                      {blocks.map((block, bi) => {
                        const blockMins = block.reduce((s, t) => s + t.estimated_minutes, 0)
                        const allDone = block.every(t => t.status === 'done')
                        return (
                          <div key={bi}>
                            {/* Block header */}
                            <div className="mb-2 flex items-center gap-3">
                              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>
                                Study Block {bi + 1}
                              </span>
                              <span className="text-xs" style={{ color: NOTION.muted }}>
                                {Math.floor(blockMins / 60) > 0 ? `${Math.floor(blockMins / 60)}h ` : ''}{blockMins % 60 > 0 ? `${blockMins % 60}m` : ''}
                              </span>
                              {allDone && <span className="text-xs rounded px-1.5 py-0.5" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>Complete ✓</span>}
                            </div>
                            {/* Tasks in block */}
                            <div className="rounded" style={{ border: `1px solid ${NOTION.border}`, overflow: 'hidden' }}>
                              {block.map((task, ti) => (
                                <div key={task.id}
                                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#FAFAF9]"
                                  style={{ borderTop: ti > 0 ? `1px solid ${NOTION.border}` : 'none' }}>
                                  <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.courses?.color || '#D3D1CB' }} />
                                  <div className="flex-1 min-w-0">
                                    <div className={`text-sm ${task.status === 'done' ? 'line-through' : ''}`}
                                      style={{ color: task.status === 'done' ? NOTION.muted : NOTION.text }}>
                                      {task.title}
                                    </div>
                                    <div className="text-xs mt-0.5" style={{ color: NOTION.muted }}>
                                      {task.courses?.name} · {task.estimated_minutes}m
                                    </div>
                                  </div>
                                  {task.status === 'done' ? (
                                    <span className="text-xs rounded px-2 py-0.5" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>✓</span>
                                  ) : task.status === 'in_progress' && activeTask?.id === task.id ? (
                                    <span className="text-xs animate-pulse font-medium" style={{ color: task.courses?.color || NOTION.text }}>● In focus</span>
                                  ) : (
                                    <NotionBtn onClick={() => startTimer(task)}>Start ▶</NotionBtn>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            </>
          )}

          {/* ── Module view ── */}
          {selectedCourse && (
            <>
              {/* View toggle */}
              <div className="mb-6 flex gap-2">
                <NotionBtn onClick={() => setView('today')}
                  className={view === 'today' ? 'bg-[#EFEFED]!' : ''}>
                  📋 Tasks
                </NotionBtn>
                <NotionBtn onClick={() => setView('board')}
                  className={view === 'board' ? 'bg-[#EFEFED]!' : ''}>
                  🗂 Board
                </NotionBtn>
                <Link href={`/whiteboard?course=${selectedCourse.id}`}>
                  <NotionBtn>🎨 Whiteboard</NotionBtn>
                </Link>
              </div>

              {/* Tasks list */}
              {view === 'today' && (
                <div className="p-6" style={{ border: `1px solid ${NOTION.border}`, borderRadius: 4 }}>
                  <h2 className="mb-4 text-2xl font-semibold" style={{ color: NOTION.text }}>All tasks</h2>
                  {courseTasks.length === 0 ? (
                    <div className="py-8 text-center text-sm" style={{ color: NOTION.muted }}>No tasks yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {courseTasks.map(task => (
                        <div key={task.id} className="flex items-center gap-3 rounded px-3 py-2 transition-colors hover:bg-[#EFEFED]">
                          <input type="checkbox" checked={task.status === 'done'}
                            onChange={() => moveTask(task, task.status === 'done' ? 'todo' : 'done')}
                            className="cursor-pointer" />
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm ${task.status === 'done' ? 'line-through' : ''}`}
                              style={{ color: task.status === 'done' ? NOTION.muted : NOTION.text }}>
                              {task.title}
                            </div>
                            <div className="text-xs" style={{ color: NOTION.muted }}>
                              {task.estimated_minutes}m · {task.priority}
                              {task.scheduled_date && ` · ${new Date(task.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                            </div>
                          </div>
                          {task.status !== 'done' && (
                            <NotionBtn onClick={() => startTimer(task)}>▶</NotionBtn>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Kanban */}
              {view === 'board' && (
                <div className="grid grid-cols-3 gap-4">
                  {([
                    { col: 'todo' as const,        label: 'To Do',       tasks: todoTasks },
                    { col: 'in_progress' as const,  label: 'In Progress', tasks: inProgTasks },
                    { col: 'done' as const,          label: 'Done',        tasks: doneTasks },
                  ]).map(({ col, label, tasks }) => (
                    <div key={col} className="rounded p-4" style={{ border: `1px solid ${NOTION.border}`, backgroundColor: NOTION.sidebar }}>
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>
                        {label} <span className="ml-1">{tasks.length}</span>
                      </div>
                      <div className="space-y-2">
                        {tasks.map(task => (
                          <div key={task.id} className="rounded p-3" style={{ backgroundColor: NOTION.bg, border: `1px solid ${NOTION.border}` }}>
                            <div className="mb-1 text-sm" style={{ color: NOTION.text }}>{task.title}</div>
                            <div className="mb-2 text-xs" style={{ color: NOTION.muted }}>{task.estimated_minutes}m · {task.priority}</div>
                            <div className="flex gap-1">
                              {col !== 'todo' && (
                                <button onClick={() => moveTask(task, 'todo')} className="rounded px-2 py-0.5 text-xs hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>← To Do</button>
                              )}
                              {col !== 'in_progress' && (
                                <button onClick={() => moveTask(task, 'in_progress')} className="rounded px-2 py-0.5 text-xs hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>
                                  {col === 'todo' ? 'Start →' : '← WIP'}
                                </button>
                              )}
                              {col !== 'done' && (
                                <button onClick={() => moveTask(task, 'done')} className="rounded px-2 py-0.5 text-xs hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>Done ✓</button>
                              )}
                            </div>
                          </div>
                        ))}
                        {tasks.length === 0 && <div className="py-4 text-center text-xs" style={{ color: NOTION.muted }}>Empty</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── End of day modal ── */}
      {showEOD && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl p-6 shadow-xl" style={{ backgroundColor: NOTION.bg, border: `1px solid ${NOTION.border}` }}>
            <h2 className="mb-1 text-lg font-semibold" style={{ color: NOTION.text }}>End of day check-in</h2>
            <p className="mb-4 text-sm" style={{ color: NOTION.muted }}>
              Tick what you actually completed. Anything unticked gets rescheduled from tomorrow.
            </p>

            <div className="mb-4 max-h-64 overflow-y-auto space-y-1">
              {todayTasks.map(task => (
                <label key={task.id} className="flex cursor-pointer items-start gap-3 rounded px-3 py-2 transition hover:bg-[#EFEFED]">
                  <input type="checkbox"
                    checked={eodChecked.has(task.id)}
                    onChange={e => setEodChecked(prev => {
                      const next = new Set(prev)
                      e.target.checked ? next.add(task.id) : next.delete(task.id)
                      return next
                    })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-gray-800"
                  />
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: NOTION.text }}>{task.title}</div>
                    <div className="text-xs" style={{ color: task.courses?.color }}>{task.courses?.name} · {task.estimated_minutes}m</div>
                  </div>
                </label>
              ))}
            </div>

            <textarea rows={2} value={eodNotes} onChange={e => setEodNotes(e.target.value)}
              placeholder="Anything to note? (optional) e.g. ran out of time, topic was harder than expected…"
              className="mb-4 w-full resize-none rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
              style={{ border: `1px solid ${NOTION.border}`, backgroundColor: '#FAFAF9' }} />

            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: NOTION.muted }}>
                {eodChecked.size} / {todayTasks.length} completed
              </span>
              <div className="flex gap-2">
                <button onClick={() => setShowEOD(false)}
                  className="rounded px-4 py-2 text-sm transition hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>
                  Cancel
                </button>
                <button
                  disabled={eodSubmitting}
                  onClick={async () => {
                    if (!userId) return
                    setEodSubmitting(true)
                    try {
                      // Mark completed tasks as done
                      const toMark = todayTasks.filter(t => eodChecked.has(t.id) && t.status !== 'done')
                      await Promise.all(toMark.map(t => api.updateTaskStatus(t.id, 'done')))
                      // Build feedback string
                      const completed = todayTasks.filter(t => eodChecked.has(t.id)).map(t => t.title)
                      const missed = todayTasks.filter(t => !eodChecked.has(t.id)).map(t => t.title)
                      const feedback = [
                        completed.length ? `Completed today: ${completed.join(', ')}.` : 'Did not complete any tasks today.',
                        missed.length ? `Did not finish: ${missed.join(', ')}.` : '',
                        eodNotes ? `User notes: ${eodNotes}` : '',
                      ].filter(Boolean).join(' ')
                      await api.fullReschedule(userId, feedback)
                      const plan = await api.getTodayPlan(userId).catch(() => ({ tasks: [] }))
                      setTodayTasks(plan.tasks || [])
                      setShowEOD(false)
                      setEodNotes('')
                    } catch (e) { console.error(e) }
                    finally { setEodSubmitting(false) }
                  }}
                  className="rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                  style={{ backgroundColor: NOTION.text }}>
                  {eodSubmitting ? 'Rescheduling…' : 'Submit & reschedule →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reschedule modal ── */}
      {showRescheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl p-6 shadow-xl" style={{ backgroundColor: NOTION.bg, border: `1px solid ${NOTION.border}` }}>
            <h2 className="mb-1 text-lg font-semibold" style={{ color: NOTION.text }}>
              {previewSummary ? 'Confirm reschedule' : 'Reschedule'}
            </h2>

            {!previewSummary ? (
              /* ── Step 1: input ── */
              <>
                <p className="mb-4 text-sm" style={{ color: NOTION.muted }}>
                  Claude will analyse your deadlines and replan intelligently. Optionally tell it what to change.
                </p>
                <textarea
                  rows={3}
                  value={rescheduleFeedback}
                  onChange={e => setRescheduleFeedback(e.target.value)}
                  placeholder="e.g. I only have 2 weeks left, focus on AI first, spread databases more evenly…"
                  className="w-full resize-none rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                  style={{ border: `1px solid ${NOTION.border}`, backgroundColor: '#FAFAF9' }}
                />
                <div className="mt-3 space-y-2">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input type="checkbox" checked={rescheduleInterleave} onChange={e => setRescheduleInterleave(e.target.checked)}
                      className="h-4 w-4 rounded" />
                    <span className="text-sm" style={{ color: NOTION.text }}>Cover all modules each day</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: NOTION.muted }}>Override sessions/day</span>
                    <input type="number" min={1} max={8} value={rescheduleSessionsOverride}
                      onChange={e => setRescheduleSessionsOverride(e.target.value)}
                      placeholder="—"
                      className="w-16 rounded px-2 py-1 text-center text-sm text-gray-900 focus:outline-none"
                      style={{ border: `1px solid ${NOTION.border}`, backgroundColor: '#FAFAF9' }} />
                    <span className="text-xs" style={{ color: NOTION.muted }}>leave blank to use profile setting</span>
                  </div>
                </div>
                {rescheduleError && (
                  <div className="mt-3 rounded px-3 py-2 text-xs" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                    {rescheduleError}
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => { setShowRescheduleModal(false); setRescheduleFeedback(''); setRescheduleError(''); setRescheduleSessionsOverride(''); setPreviewSummary(''); setPreviewDirectives(null) }}
                    className="rounded px-4 py-2 text-sm transition hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>
                    Cancel
                  </button>
                  <button
                    disabled={previewLoading}
                    onClick={async () => {
                      if (!userId) return
                      setPreviewLoading(true)
                      setRescheduleError('')
                      try {
                        const result = await api.reschedulePreview(userId, rescheduleFeedback || undefined, {
                          interleave_courses: rescheduleInterleave,
                          sessions_per_day_override: rescheduleSessionsOverride ? parseInt(rescheduleSessionsOverride) : undefined,
                        })
                        setPreviewSummary(result.summary)
                        setPreviewDirectives(result.directives)
                      } catch (e: any) {
                        setRescheduleError(e?.message || 'Could not generate preview')
                      } finally { setPreviewLoading(false) }
                    }}
                    className="rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                    style={{ backgroundColor: NOTION.text }}>
                    {previewLoading ? 'Analysing…' : 'Preview →'}
                  </button>
                </div>
              </>
            ) : (
              /* ── Step 2: confirm ── */
              <>
                <div className="mb-5 mt-2 rounded-lg p-4 text-sm leading-relaxed" style={{ backgroundColor: '#FAFAF9', border: `1px solid ${NOTION.border}`, color: NOTION.text }}>
                  {previewSummary}
                </div>
                <p className="mb-4 text-xs" style={{ color: NOTION.muted }}>
                  Apply this plan? You can go back to adjust your feedback.
                </p>
                {rescheduleError && (
                  <div className="mb-3 rounded px-3 py-2 text-xs" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                    {rescheduleError}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setPreviewSummary(''); setPreviewDirectives(null); setRescheduleError('') }}
                    className="rounded px-4 py-2 text-sm transition hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>
                    ← Back
                  </button>
                  <button
                    disabled={rescheduling}
                    onClick={async () => {
                      if (!userId) return
                      setRescheduling(true)
                      setRescheduleError('')
                      try {
                        await api.fullReschedule(userId, rescheduleFeedback || undefined, {
                          interleave_courses: rescheduleInterleave,
                          sessions_per_day_override: rescheduleSessionsOverride ? parseInt(rescheduleSessionsOverride) : undefined,
                          directives: previewDirectives,
                        })
                        const plan = await api.getTodayPlan(userId).catch(() => ({ tasks: [] }))
                        setTodayTasks(plan.tasks || [])
                        setShowRescheduleModal(false)
                        setRescheduleFeedback('')
                        setRescheduleSessionsOverride('')
                        setPreviewSummary('')
                        setPreviewDirectives(null)
                        setRescheduleSuccess(true)
                        setTimeout(() => setRescheduleSuccess(false), 3000)
                      } catch (e: any) {
                        setRescheduleError(e?.message || 'Something went wrong')
                      } finally { setRescheduling(false) }
                    }}
                    className="rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
                    style={{ backgroundColor: NOTION.text }}>
                    {rescheduling ? 'Applying…' : 'Confirm & apply →'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

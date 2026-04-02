'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

type Task = {
  id: string
  title: string
  status: string
  estimated_minutes: number
  priority: string
  scheduled_date: string
  course_id: string
  courses?: { name: string; color: string; exam_date?: string }
}

type Course = { id: string; name: string; color: string; exam_date?: string }

const NOTION = {
  bg: '#FFFFFF',
  sidebar: '#FBFBFA',
  border: '#EDEDED',
  hover: '#EFEFED',
  text: '#37352F',
  muted: 'rgba(55,53,47,0.5)',
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }

export default function CalendarPage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [view, setView] = useState<'month' | 'week'>('month')
  const [cursor, setCursor] = useState<Date>(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [selectedDate, setSelectedDate] = useState<string | null>(() => toISO(new Date()))
  const [loading, setLoading] = useState(true)

  const today = new Date(); today.setHours(0,0,0,0)

  useEffect(() => {
    let uid: string | null = null

    const loadData = async () => {
      if (!uid) {
        const { data: { session } } = await supabase.auth.getSession() as any
        if (!session) { router.push('/auth/signin'); return }
        uid = session.user.id
      }
      const [coursesData, profileData] = await Promise.all([
        api.getCourses(uid).catch(() => []),
        api.getProfile(uid).catch(() => null),
      ])
      setProfile(profileData)
      const seen = new Set()
      const unique: Course[] = coursesData.filter((c: Course) => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
      setCourses(unique)
      const allTasks: Task[] = []
      for (const c of unique) {
        const ct = await api.getTasks(c.id).catch(() => [])
        allTasks.push(...ct.map((t: Task) => ({ ...t, courses: { name: c.name, color: c.color, exam_date: c.exam_date } })))
      }
      setTasks(allTasks)
      setLoading(false)
    }

    loadData()

    const onVisible = () => { if (document.visibilityState === 'visible') loadData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [router])

  const tasksFor = (iso: string) => tasks.filter(t => t.scheduled_date === iso)
  const examOn   = (iso: string) => courses.find(c => c.exam_date === iso)

  const blockMinutes = profile?.session_duration_minutes
    || (profile?.daily_study_hours ? Math.round((profile.daily_study_hours * 60) / (profile?.sessions_per_day || 3)) : 180)

  const groupIntoBlocks = (dayTasks: Task[]): Task[][] => {
    const blocks: Task[][] = []
    let current: Task[] = []
    let elapsed = 0
    for (const task of dayTasks) {
      if (elapsed > 0 && elapsed + task.estimated_minutes > blockMinutes) {
        blocks.push(current); current = []; elapsed = 0
      }
      current.push(task); elapsed += task.estimated_minutes
    }
    if (current.length) blocks.push(current)
    return blocks
  }

  // ── Month helpers ──────────────────────────────────────────
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const monthEnd   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
  const gridStart  = addDays(monthStart, -(monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1))
  const totalCells = Math.ceil((monthEnd.getDate() + (monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1)) / 7) * 7
  const monthCells = Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i))

  // ── Week helpers ──────────────────────────────────────────
  const weekStart = addDays(cursor, -(cursor.getDay() === 0 ? 6 : cursor.getDay() - 1))
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const prevPeriod = () => {
    if (view === 'month') setCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    else setCursor(d => addDays(d, -7))
  }
  const nextPeriod = () => {
    if (view === 'month') setCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    else setCursor(d => addDays(d, 7))
  }
  const goToday = () => { const d = new Date(); d.setHours(0,0,0,0); setCursor(d); setSelectedDate(toISO(d)) }

  const selectedTasks = selectedDate ? tasksFor(selectedDate) : []
  const selectedExam  = selectedDate ? examOn(selectedDate) : null

  const periodLabel = view === 'month'
    ? cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`

  if (loading) return (
    <div className="flex h-screen items-center justify-center" style={{ backgroundColor: NOTION.bg }}>
      <span className="text-sm" style={{ color: NOTION.muted }}>Loading…</span>
    </div>
  )

  return (
    <div className="flex h-screen flex-col" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", backgroundColor: NOTION.bg, color: NOTION.text }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0" style={{ borderBottom: `1px solid ${NOTION.border}`, backgroundColor: NOTION.sidebar }}>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm transition-colors" style={{ color: NOTION.muted }}
            onMouseEnter={e => (e.currentTarget.style.color = NOTION.text)}
            onMouseLeave={e => (e.currentTarget.style.color = NOTION.muted)}>
            ← Dashboard
          </Link>
          <span className="text-sm font-semibold" style={{ color: NOTION.text }}>Calendar</span>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${NOTION.border}` }}>
            {(['month', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className="px-3 py-1.5 text-xs font-medium transition capitalize"
                style={{ backgroundColor: view === v ? NOTION.hover : NOTION.bg, color: view === v ? NOTION.text : NOTION.muted }}>
                {v}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <button onClick={prevPeriod} className="rounded px-2.5 py-1.5 text-sm transition hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>‹</button>
          <span className="min-w-44 text-center text-sm font-medium" style={{ color: NOTION.text }}>{periodLabel}</span>
          <button onClick={nextPeriod} className="rounded px-2.5 py-1.5 text-sm transition hover:bg-[#EFEFED]" style={{ color: NOTION.muted }}>›</button>
          <button onClick={goToday} className="rounded px-3 py-1.5 text-xs transition" style={{ border: `1px solid ${NOTION.border}`, color: NOTION.text }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = NOTION.hover)}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
            Today
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Calendar area ── */}
        <div className="flex-1 overflow-auto">
          {view === 'month' ? (
            <div className="p-6">
              {/* Day-of-week headers */}
              <div className="mb-1 grid grid-cols-7 gap-px">
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                  <div key={d} className="pb-2 text-center text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>{d}</div>
                ))}
              </div>

              {/* Grid */}
              <div className="grid grid-cols-7 gap-px" style={{ backgroundColor: NOTION.border }}>
                {monthCells.map((date, i) => {
                  const iso = toISO(date)
                  const dayTasks = tasksFor(iso)
                  const exam = examOn(iso)
                  const isThisMonth = date.getMonth() === cursor.getMonth()
                  const isToday = iso === toISO(today)
                  const isSelected = selectedDate === iso
                  const doneTasks = dayTasks.filter(t => t.status === 'done').length

                  return (
                    <div key={i}
                      onClick={() => setSelectedDate(isSelected ? null : iso)}
                      className="cursor-pointer p-2 transition-colors"
                      style={{
                        backgroundColor: isSelected ? '#F0F0EF' : NOTION.bg,
                        minHeight: 90,
                        opacity: isThisMonth ? 1 : 0.35,
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = NOTION.hover }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = isSelected ? '#F0F0EF' : NOTION.bg }}>

                      {/* Date number */}
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold`}
                          style={{ backgroundColor: isToday ? NOTION.text : 'transparent', color: isToday ? '#FFFFFF' : NOTION.text }}>
                          {date.getDate()}
                        </span>
                        {doneTasks > 0 && dayTasks.length > 0 && (
                          <span className="text-xs" style={{ color: NOTION.muted }}>{doneTasks}/{dayTasks.length}</span>
                        )}
                      </div>

                      {/* Exam badge */}
                      {exam && (
                        <div className="mb-1 truncate rounded px-1.5 py-0.5 text-xs font-semibold text-white"
                          style={{ backgroundColor: exam.color }}>
                          🎓 {exam.name}
                        </div>
                      )}

                      {/* Task dots / pills */}
                      {dayTasks.length > 0 && (
                        <div className="space-y-0.5">
                          {dayTasks.slice(0, 3).map(t => (
                            <div key={t.id}
                              className="flex items-center gap-1 rounded px-1 py-0.5 text-xs truncate"
                              style={{ backgroundColor: (t.courses?.color || '#888') + '18', color: t.courses?.color || '#888', opacity: t.status === 'done' ? 0.45 : 1 }}>
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.courses?.color || '#888' }} />
                              <span className="truncate">{t.title}</span>
                            </div>
                          ))}
                          {dayTasks.length > 3 && (
                            <div className="pl-1 text-xs" style={{ color: NOTION.muted }}>+{dayTasks.length - 3} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              {courses.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-4">
                  {courses.map(c => (
                    <div key={c.id} className="flex items-center gap-1.5 text-xs" style={{ color: NOTION.muted }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name}
                      {c.exam_date && <span>· exam {new Date(c.exam_date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Week view ── */
            <div className="flex h-full flex-col">
              {/* Day headers */}
              <div className="grid shrink-0 grid-cols-7" style={{ borderBottom: `1px solid ${NOTION.border}` }}>
                {weekDays.map((date, i) => {
                  const iso = toISO(date)
                  const isToday = iso === toISO(today)
                  const isSelected = selectedDate === iso
                  return (
                    <div key={i}
                      onClick={() => setSelectedDate(isSelected ? null : iso)}
                      className="cursor-pointer py-3 text-center transition-colors"
                      style={{ backgroundColor: isSelected ? NOTION.hover : 'transparent', borderRight: i < 6 ? `1px solid ${NOTION.border}` : 'none' }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = NOTION.hover }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = isSelected ? NOTION.hover : 'transparent' }}>
                      <div className="text-xs uppercase tracking-wider" style={{ color: NOTION.muted }}>
                        {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                      </div>
                      <div className="mt-0.5 flex items-center justify-center">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold`}
                          style={{ backgroundColor: isToday ? NOTION.text : 'transparent', color: isToday ? '#FFFFFF' : NOTION.text }}>
                          {date.getDate()}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Day columns */}
              <div className="grid flex-1 grid-cols-7 overflow-auto" style={{ backgroundColor: NOTION.border, gap: 1 }}>
                {weekDays.map((date, i) => {
                  const iso = toISO(date)
                  const dayTasks = tasksFor(iso)
                  const exam = examOn(iso)
                  const isSelected = selectedDate === iso

                  return (
                    <div key={i}
                      className="p-3 cursor-pointer transition-colors"
                      style={{ backgroundColor: isSelected ? '#F5F5F4' : NOTION.bg }}
                      onClick={() => setSelectedDate(selectedDate === iso ? null : iso)}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#FAFAF9' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = isSelected ? '#F5F5F4' : NOTION.bg }}>

                      {exam && (
                        <div className="mb-2 rounded px-2 py-1 text-xs font-semibold text-white"
                          style={{ backgroundColor: exam.color }}>
                          🎓 Exam
                        </div>
                      )}

                      <div className="space-y-2">
                        {dayTasks.length === 0 ? (
                          <div className="py-4 text-center text-xs" style={{ color: NOTION.muted }}>—</div>
                        ) : groupIntoBlocks(dayTasks).map((block, bi) => (
                          <div key={bi}>
                            <div className="mb-0.5 text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>Block {bi + 1}</div>
                            <div className="space-y-0.5">
                              {block.map(task => (
                                <div key={task.id}
                                  className="rounded px-2 py-1.5 text-xs leading-snug"
                                  style={{
                                    backgroundColor: (task.courses?.color || '#888') + '20',
                                    borderLeft: `2px solid ${task.courses?.color || '#888'}`,
                                    color: NOTION.text,
                                    opacity: task.status === 'done' ? 0.45 : 1,
                                  }}>
                                  <div className="font-medium truncate" style={{ textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
                                    {task.title}
                                  </div>
                                  <div className="mt-0.5" style={{ color: NOTION.muted }}>{task.estimated_minutes}m</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Side panel ── */}
        <div className="w-72 shrink-0 overflow-auto" style={{ borderLeft: `1px solid ${NOTION.border}`, backgroundColor: NOTION.sidebar }}>
          {selectedDate ? (
            <div className="p-5">
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                {selectedExam && (
                  <div className="mt-2 flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: selectedExam.color }}>
                    🎓 Exam — {selectedExam.name}
                  </div>
                )}
                <div className="mt-2 text-sm font-medium" style={{ color: NOTION.text }}>
                  {selectedTasks.length === 0 ? 'Nothing scheduled' : `${selectedTasks.length} task${selectedTasks.length !== 1 ? 's' : ''}`}
                </div>
              </div>

              {selectedTasks.length > 0 && (
                <div className="space-y-4">
                  {groupIntoBlocks(selectedTasks).map((block, bi) => {
                    const blockMins = block.reduce((s, t) => s + t.estimated_minutes, 0)
                    return (
                      <div key={bi}>
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>Study Block {bi + 1}</span>
                          <span className="text-xs" style={{ color: NOTION.muted }}>
                            {Math.floor(blockMins / 60) > 0 ? `${Math.floor(blockMins / 60)}h ` : ''}{blockMins % 60 > 0 ? `${blockMins % 60}m` : ''}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {block.map(task => (
                            <div key={task.id} className="rounded p-2.5" style={{ border: `1px solid ${NOTION.border}`, backgroundColor: NOTION.bg }}>
                              <div className="flex items-start gap-2">
                                <div className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: task.courses?.color || '#888' }} />
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm leading-snug ${task.status === 'done' ? 'line-through' : ''}`}
                                    style={{ color: task.status === 'done' ? NOTION.muted : NOTION.text }}>
                                    {task.title}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: NOTION.muted }}>
                                    <span>{task.estimated_minutes}m</span>
                                    <span style={{ color: task.courses?.color }}>· {task.courses?.name}</span>
                                    <span className="ml-auto rounded px-1.5 py-0.5"
                                      style={{
                                        backgroundColor: task.status === 'done' ? '#D1FAE5' : task.status === 'in_progress' ? '#DBEAFE' : NOTION.hover,
                                        color: task.status === 'done' ? '#065F46' : task.status === 'in_progress' ? '#1E40AF' : NOTION.muted,
                                      }}>
                                      {task.status === 'done' ? '✓ done' : task.status === 'in_progress' ? '● active' : 'todo'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mb-2 text-2xl">📅</div>
                <div className="text-xs" style={{ color: NOTION.muted }}>Click a day to see tasks</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

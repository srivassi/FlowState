'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

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

type Stats = {
  tasks_completed: number
  total_focus_minutes: number
  streak_days: number
  weekly_pomodoros: { date: string; count: number }[]
}

const POMODORO_MINUTES = 25

export default function Dashboard() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [courses, setCourses] = useState<any[]>([])
  const [todayTasks, setTodayTasks] = useState<Task[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(POMODORO_MINUTES * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionNotes, setSessionNotes] = useState('')
  const [view, setView] = useState<'today' | 'board'>('today')
  const [allCourseTasks, setAllCourseTasks] = useState<Task[]>([])
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Auth + load ───────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      await loadAll(uid)
      setLoading(false)
    })
  }, [router])

  const loadAll = useCallback(async (uid: string) => {
    const [plan, statsData, coursesData] = await Promise.all([
      api.getTodayPlan(uid).catch(() => ({ tasks: [] })),
      api.getStats(uid).catch(() => null),
      api.getCourses(uid).catch(() => []),
    ])
    setTodayTasks(plan.tasks || [])
    setStats(statsData)
    setCourses(coursesData)
  }, [])

  // ── Timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!)
            setIsRunning(false)
            handlePomodoroComplete()
            return 0
          }
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
    setActiveTask(task)
    setTimeLeft(task.estimated_minutes * 60)
    setIsRunning(false)
    try {
      const session = await api.startPomodoro({ task_id: task.id, user_id: userId, duration_minutes: task.estimated_minutes })
      setActiveSessionId(session.id)
      // Update local state
      setTodayTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t))
      setIsRunning(true)
    } catch (e) { console.error(e) }
  }

  const handlePomodoroComplete = async () => {
    if (!activeSessionId || !userId) return
    try {
      await api.completePomodoro(activeSessionId, sessionNotes || undefined)
      setTodayTasks(prev => prev.map(t => t.id === activeTask?.id ? { ...t, status: 'done' } : t))
      setActiveTask(null)
      setActiveSessionId(null)
      setSessionNotes('')
      const statsData = await api.getStats(userId)
      setStats(statsData)
    } catch (e) { console.error(e) }
  }

  const skipTask = async (task: Task) => {
    if (!userId) return
    try {
      await api.updateTaskStatus(task.id, 'todo')
      // Reschedule remaining from tomorrow
      const course = courses.find(c => c.id === task.courses?.name)
      if (course?.exam_date) {
        const profile = await api.getProfile(userId).catch(() => null)
        await api.reschedule({
          course_id: task.courses ? task.id : task.id,
          user_id: userId,
          completed_task_ids: todayTasks.filter(t => t.status === 'done').map(t => t.id),
          exam_date: course.exam_date,
          daily_study_hours: profile?.daily_study_hours || 4,
          pomodoro_minutes: profile?.pomodoro_work_minutes || 25,
        })
      }
    } catch (e) { console.error(e) }
  }

  const loadCourseTasks = async (courseId: string) => {
    setSelectedCourse(courseId)
    const tasks = await api.getTasks(courseId).catch(() => [])
    setAllCourseTasks(tasks)
  }

  const moveTask = async (task: Task, newStatus: Task['status']) => {
    await api.updateTaskStatus(task.id, newStatus)
    setAllCourseTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
  }

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mb-3 text-4xl">📚</div>
        <div className="text-gray-500">Loading your plan...</div>
      </div>
    </div>
  )

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const totalSecs = (activeTask?.estimated_minutes || POMODORO_MINUTES) * 60
  const progress = ((totalSecs - timeLeft) / totalSecs) * 100

  const todoTasks = allCourseTasks.filter(t => t.status === 'todo')
  const inProgressTasks = allCourseTasks.filter(t => t.status === 'in_progress')
  const doneTasks = allCourseTasks.filter(t => t.status === 'done')

  return (
    <div className="flex h-screen bg-gray-50">

      {/* ── Sidebar ─────────────────────────────────────── */}
      <div className="flex w-64 flex-col border-r border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <div className="text-lg font-bold text-gray-800">Study Planner</div>
          <div className="text-xs text-gray-500">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          <button onClick={() => setView('today')}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${view === 'today' ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            <span>📅</span> Today
          </button>
          <button onClick={() => setView('board')}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${view === 'board' ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            <span>📋</span> Task Board
          </button>
          <Link href="/calendar"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50">
            <span>🗓️</span> Calendar
          </Link>
          <Link href="/whiteboard"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50">
            <span>🎨</span> Whiteboard
          </Link>
          <Link href="/modules/new"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50">
            <span>➕</span> Add Module
          </Link>
        </nav>

        {/* Pomodoro timer */}
        <div className="m-3 rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-red-50 p-4">
          <div className="mb-1 text-center text-xs font-semibold text-orange-600">FOCUS SESSION</div>
          {activeTask && (
            <div className="mb-2 truncate text-center text-xs text-orange-700 font-medium">{activeTask.title}</div>
          )}
          <div className="mb-3 text-center text-3xl font-bold text-gray-800 tabular-nums">
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-orange-100">
            <div className="h-full bg-gradient-to-r from-red-500 to-orange-400 transition-all duration-1000"
              style={{ width: `${progress}%` }} />
          </div>
          {activeTask ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button onClick={() => setIsRunning(!isRunning)}
                  className="flex-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 py-1.5 text-xs font-semibold text-white shadow transition hover:from-red-600 hover:to-orange-600">
                  {isRunning ? 'Pause' : 'Resume'}
                </button>
                <button onClick={handlePomodoroComplete}
                  className="rounded-lg border border-green-300 bg-white px-2 py-1.5 text-xs text-green-700 transition hover:bg-green-50">
                  Done ✓
                </button>
              </div>
              <textarea
                placeholder="Quick note (optional)"
                value={sessionNotes}
                onChange={e => setSessionNotes(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-orange-200 bg-white px-2 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:border-orange-400 focus:outline-none"
              />
            </div>
          ) : (
            <div className="text-center text-xs text-orange-500">Pick a task to start</div>
          )}
        </div>
      </div>

      {/* ── Main content ────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl p-8">

          {/* Stats row */}
          {stats && (
            <div className="mb-8 grid grid-cols-4 gap-4">
              <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-1 text-2xl">🎯</div>
                <div className="text-2xl font-bold text-gray-800">{stats.tasks_completed}</div>
                <div className="text-xs text-gray-500">Tasks done</div>
              </div>
              <div className="rounded-xl border border-purple-100 bg-white p-5 shadow-sm">
                <div className="mb-1 text-2xl">⏱️</div>
                <div className="text-2xl font-bold text-gray-800">{Math.round(stats.total_focus_minutes / 60)}h</div>
                <div className="text-xs text-gray-500">Focus time</div>
              </div>
              <div className="rounded-xl border border-orange-100 bg-white p-5 shadow-sm">
                <div className="mb-1 text-2xl">🔥</div>
                <div className="text-2xl font-bold text-gray-800">{stats.streak_days}</div>
                <div className="text-xs text-gray-500">Day streak</div>
              </div>
              <div className="rounded-xl border border-green-100 bg-white p-5 shadow-sm">
                <div className="mb-1 text-2xl">🍅</div>
                <div className="text-2xl font-bold text-gray-800">
                  {stats.weekly_pomodoros.reduce((s, d) => s + d.count, 0)}
                </div>
                <div className="text-xs text-gray-500">Pomodoros this week</div>
              </div>
            </div>
          )}

          {/* Weekly chart */}
          {stats?.weekly_pomodoros && (
            <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-gray-600 uppercase tracking-wide">Weekly Pomodoros</h2>
              <div className="flex items-end gap-3">
                {stats.weekly_pomodoros.map((d, i) => {
                  const max = Math.max(...stats.weekly_pomodoros.map(x => x.count), 1)
                  const height = Math.max(8, (d.count / max) * 80)
                  const isToday = d.date === new Date().toISOString().slice(0, 10)
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div className="text-xs text-gray-500">{d.count || ''}</div>
                      <div className={`w-full rounded-t-md transition-all ${isToday ? 'bg-blue-500' : 'bg-blue-200'}`}
                        style={{ height: `${height}px` }} />
                      <div className="text-xs text-gray-400">
                        {new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Today view ─────────────────────────────── */}
          {view === 'today' && (
            <div>
              <h2 className="mb-4 text-lg font-bold text-gray-800">
                Today's tasks
                <span className="ml-2 text-sm font-normal text-gray-400">
                  {todayTasks.filter(t => t.status === 'done').length}/{todayTasks.length} done
                </span>
              </h2>
              {todayTasks.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
                  <div className="mb-2 text-4xl">✨</div>
                  <div>No tasks scheduled today.</div>
                  <Link href="/onboarding" className="mt-2 block text-sm text-blue-500 hover:underline">Add a module to get started →</Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {todayTasks.map(task => (
                    <div key={task.id}
                      className={`flex items-center gap-4 rounded-xl border bg-white px-5 py-4 shadow-sm transition ${task.status === 'done' ? 'opacity-50' : ''}`}>
                      {task.courses && (
                        <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: task.courses.color }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium text-gray-800 ${task.status === 'done' ? 'line-through' : ''}`}>{task.title}</div>
                        <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                          <span>{task.estimated_minutes} min</span>
                          <span className={`rounded px-1.5 py-0.5 font-medium ${
                            task.priority === 'high' ? 'bg-red-50 text-red-600' :
                            task.priority === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                            'bg-green-50 text-green-600'}`}>{task.priority}</span>
                          {task.courses && <span className="text-gray-400">{task.courses.name}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        {task.status === 'done' ? (
                          <span className="text-green-500 text-sm">✓ Done</span>
                        ) : task.status === 'in_progress' && activeTask?.id === task.id ? (
                          <span className="text-orange-500 text-sm animate-pulse">● In progress</span>
                        ) : (
                          <>
                            <button onClick={() => startTimer(task)}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-blue-700">
                              Start ▶
                            </button>
                            <button onClick={() => skipTask(task)}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:bg-gray-50">
                              Skip
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Board view ─────────────────────────────── */}
          {view === 'board' && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-bold text-gray-800">Task Board</h2>
                <div className="flex gap-2">
                  {courses.map(c => (
                    <button key={c.id} onClick={() => loadCourseTasks(c.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${selectedCourse === c.id ? 'text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
                      style={selectedCourse === c.id ? { backgroundColor: c.color } : {}}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {!selectedCourse ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
                  Select a module above to see its tasks
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {(['todo','in_progress','done'] as const).map(col => {
                    const colTasks = col === 'todo' ? todoTasks : col === 'in_progress' ? inProgressTasks : doneTasks
                    const labels = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
                    const colours = { todo: 'text-gray-600', in_progress: 'text-orange-600', done: 'text-green-600' }
                    return (
                      <div key={col} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className={`mb-3 text-sm font-semibold ${colours[col]}`}>
                          {labels[col]} <span className="ml-1 text-xs font-normal text-gray-400">{colTasks.length}</span>
                        </div>
                        <div className="space-y-2">
                          {colTasks.map(task => (
                            <div key={task.id}
                              className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:shadow-md">
                              <div className="mb-2 text-sm font-medium text-gray-800">{task.title}</div>
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <span>{task.estimated_minutes}m</span>
                                <span className={`rounded px-1.5 py-0.5 font-medium ${
                                  task.priority === 'high' ? 'bg-red-50 text-red-500' :
                                  task.priority === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                                  'bg-green-50 text-green-500'}`}>{task.priority}</span>
                              </div>
                              <div className="mt-2 flex gap-1">
                                {col !== 'todo' && (
                                  <button onClick={() => moveTask(task, 'todo')}
                                    className="flex-1 rounded bg-gray-100 py-1 text-xs text-gray-500 hover:bg-gray-200">← To Do</button>
                                )}
                                {col !== 'in_progress' && (
                                  <button onClick={() => moveTask(task, 'in_progress')}
                                    className="flex-1 rounded bg-orange-50 py-1 text-xs text-orange-600 hover:bg-orange-100">
                                    {col === 'todo' ? 'Start →' : '← WIP'}</button>
                                )}
                                {col !== 'done' && (
                                  <button onClick={() => moveTask(task, 'done')}
                                    className="flex-1 rounded bg-green-50 py-1 text-xs text-green-600 hover:bg-green-100">Done ✓</button>
                                )}
                              </div>
                            </div>
                          ))}
                          {colTasks.length === 0 && (
                            <div className="py-8 text-center text-xs text-gray-300">Empty</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

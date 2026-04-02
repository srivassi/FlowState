'use client'

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

type Course = {
  id: string
  name: string
  color: string
  exam_date?: string
}

function addDays(date: Date, n: number) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d
}
function toISO(d: Date) { return d.toISOString().slice(0, 10) }
function isSameDay(a: Date, b: Date) { return toISO(a) === toISO(b) }

export default function CalendarPage() {
  const router = useRouter()
  const [, setUserId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const today = new Date()
    const day = today.getDay()
    const mon = new Date(today)
    mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
    mon.setHours(0, 0, 0, 0)
    return mon
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)

      const [coursesData] = await Promise.all([
        api.getCourses(uid).catch(() => []),
      ])
      // Dedupe by id in case of duplicate rows from failed onboarding attempts
      const seen = new Set()
      const uniqueCourses = coursesData.filter((c: Course) => {
        if (seen.has(c.id)) return false
        seen.add(c.id); return true
      })
      setCourses(uniqueCourses)

      // Fetch all tasks for all courses
      const allTasks: Task[] = []
      for (const c of coursesData) {
        const ct = await api.getTasks(c.id).catch(() => [])
        allTasks.push(...ct.map((t: Task) => ({ ...t, courses: { name: c.name, color: c.color, exam_date: c.exam_date } })))
      }
      setTasks(allTasks)
      setLoading(false)
    })
  }, [router])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const tasksForDay = (date: Date) =>
    tasks.filter(t => t.scheduled_date === toISO(date))

  const examDates = courses
    .filter(c => c.exam_date)
    .map(c => ({ date: c.exam_date!, name: c.name, color: c.color }))

  const isExamDay = (date: Date) => examDates.find(e => e.date === toISO(date))

  const prevWeek = () => setWeekStart(d => addDays(d, -7))
  const nextWeek = () => setWeekStart(d => addDays(d, 7))
  const goToday = () => {
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const day = now.getDay()
    const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    setWeekStart(mon)
  }

  const selectedTasks = selectedDate ? tasks.filter(t => t.scheduled_date === selectedDate) : []

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="text-gray-500">Loading calendar...</div>
    </div>
  )

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-600">← Dashboard</Link>
          <h1 className="text-lg font-bold text-gray-800">Study Calendar</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">← Prev</button>
          <button onClick={goToday} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Today</button>
          <button onClick={nextWeek} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Next →</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Calendar grid */}
        <div className="flex-1 overflow-auto p-6">
          {/* Month label */}
          <div className="mb-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            {weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </div>

          {/* Day columns */}
          <div className="grid grid-cols-7 gap-3">
            {days.map((date, i) => {
              const dayTasks = tasksForDay(date)
              const exam = isExamDay(date)
              const isToday = isSameDay(date, today)
              const isPast = date < today
              const isSelected = selectedDate === toISO(date)

              return (
                <div key={i}
                  onClick={() => setSelectedDate(isSelected ? null : toISO(date))}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    isSelected ? 'border-blue-400 ring-2 ring-blue-200' :
                    isToday ? 'border-blue-300 bg-blue-50' :
                    isPast ? 'border-gray-100 bg-gray-50 opacity-70' :
                    'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  }`}
                  style={{ minHeight: '140px' }}
                >
                  <div className={`mb-2 text-xs font-semibold ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>
                    {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                  </div>
                  <div className={`mb-3 text-lg font-bold leading-none ${isToday ? 'text-blue-700' : 'text-gray-800'}`}>
                    {date.getDate()}
                  </div>

                  {/* Exam marker */}
                  {exam && (
                    <div className="mb-2 rounded px-1.5 py-0.5 text-xs font-bold text-white shadow-sm"
                      style={{ backgroundColor: exam.color }}>
                      EXAM: {exam.name}
                    </div>
                  )}

                  {/* Task pills */}
                  <div className="space-y-1">
                    {dayTasks.slice(0, 4).map(task => (
                      <div key={task.id}
                        className={`truncate rounded px-1.5 py-0.5 text-xs font-medium ${task.status === 'done' ? 'opacity-40 line-through' : ''}`}
                        style={{
                          backgroundColor: (task.courses?.color || '#3B82F6') + '20',
                          color: task.courses?.color || '#3B82F6',
                        }}>
                        {task.title}
                      </div>
                    ))}
                    {dayTasks.length > 4 && (
                      <div className="text-xs text-gray-400">+{dayTasks.length - 4} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            {courses.map(c => (
              <div key={c.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
                {c.exam_date && <span className="text-gray-400">— exam {new Date(c.exam_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Side panel — selected day detail */}
        {selectedDate && (
          <div className="w-72 overflow-auto border-l border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <div className="text-sm font-medium text-gray-700 mt-1">
                {selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''} scheduled
              </div>
            </div>

            {selectedTasks.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">Nothing scheduled</div>
            ) : (
              <div className="space-y-2">
                {selectedTasks.map(task => (
                  <div key={task.id}
                    className={`rounded-lg border p-3 ${task.status === 'done' ? 'border-green-100 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
                    <div className={`text-sm font-medium text-gray-800 ${task.status === 'done' ? 'line-through opacity-60' : ''}`}>
                      {task.title}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                      <span>{task.estimated_minutes}m</span>
                      <span className={`rounded px-1 ${
                        task.priority === 'high' ? 'bg-red-50 text-red-500' :
                        task.priority === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                        'bg-green-50 text-green-500'}`}>{task.priority}</span>
                      {task.courses && (
                        <span className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: task.courses.color }} />
                          {task.courses.name}
                        </span>
                      )}
                    </div>
                    {task.status === 'done' && <div className="mt-1 text-xs text-green-500">✓ Completed</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

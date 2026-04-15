'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

const PALETTE = [
  { color: '#3B82F6', label: 'Blue'    },
  { color: '#8B5CF6', label: 'Purple'  },
  { color: '#EC4899', label: 'Pink'    },
  { color: '#10B981', label: 'Green'   },
  { color: '#F59E0B', label: 'Amber'   },
  { color: '#EF4444', label: 'Red'     },
  { color: '#06B6D4', label: 'Cyan'    },
  { color: '#F97316', label: 'Orange'  },
  { color: '#84CC16', label: 'Lime'    },
  { color: '#14B8A6', label: 'Teal'    },
  { color: '#A855F7', label: 'Violet'  },
  { color: '#E879F9', label: 'Fuchsia' },
]

const EMOJIS = ['📚','🧠','💡','🔬','📐','💻','⚗️','📊','🗺️','🎯','✍️','🧮','📝','🏛️','🌍','⚖️','🎨','🎵']

type Disruption = { label: string; start_date: string; end_date: string }
type Course     = { name: string; exam_date: string; color: string; emoji: string; syllabus: string }

const INPUT = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [userId, setUserId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // ── Step 1: Schedule preferences ──────────────────────────
  const [sessionsPerDay, setSessionsPerDay] = useState(2)
  const [sessionDuration, setSessionDuration] = useState(2)   // hours per session
  const [preferredTimes, setPreferredTimes] = useState<string[]>(['morning'])
  const [pomodoroPreset, setPomodoroPreset] = useState('classic')
  const [customWork, setCustomWork] = useState(25)
  const [customBreak, setCustomBreak] = useState(5)

  // ── Step 2: Courses ───────────────────────────────────────
  const [courses, setCourses] = useState<Course[]>([
    { name: '', exam_date: '', color: PALETTE[0].color, emoji: EMOJIS[0], syllabus: '' }
  ])

  // ── Step 3: Disruptions ───────────────────────────────────
  const [disruptions, setDisruptions] = useState<Disruption[]>([])
  const [newDisruption, setNewDisruption] = useState<Disruption>({ label: '', start_date: '', end_date: '' })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      setUserId(session.user.id)
    })
  }, [router])

  // ── Helpers ───────────────────────────────────────────────
  const dailyHours = sessionsPerDay * sessionDuration

  const toggleTime = (t: string) =>
    setPreferredTimes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])

  const addCourse    = () => setCourses([...courses, { name: '', exam_date: '', color: PALETTE[courses.length % PALETTE.length].color, emoji: EMOJIS[courses.length % EMOJIS.length], syllabus: '' }])
  const removeCourse = (i: number) => setCourses(courses.filter((_, idx) => idx !== i))
  const updateCourse = (i: number, field: keyof Course, val: string) => {
    const updated = [...courses]; updated[i] = { ...updated[i], [field]: val }; setCourses(updated)
  }

  const addDisruption = () => {
    if (!newDisruption.label || !newDisruption.start_date || !newDisruption.end_date) return
    setDisruptions([...disruptions, newDisruption])
    setNewDisruption({ label: '', start_date: '', end_date: '' })
  }

  const pomodoroMinutes = pomodoroPreset === 'custom' ? customWork
    : ({ classic: 25, power: 50, sprint: 15 } as Record<string,number>)[pomodoroPreset]
  const pomodoroBreak   = pomodoroPreset === 'custom' ? customBreak
    : ({ classic: 5,  power: 10, sprint: 3  } as Record<string,number>)[pomodoroPreset]

  // ── Submit ────────────────────────────────────────────────
  const handleFinish = async () => {
    if (!userId) return
    setSaving(true)
    try {
      await api.completeOnboarding({
        user_id: userId,
        daily_study_hours: dailyHours,
        sessions_per_day: sessionsPerDay,
        session_duration_minutes: sessionDuration * 60,
        pomodoro_preset: pomodoroPreset,
        custom_work_minutes: customWork,
        custom_break_minutes: customBreak,
      })

      for (const d of disruptions) {
        await api.createDisruption({ ...d, user_id: userId })
      }

      for (const course of courses) {
        if (!course.name || !course.exam_date) continue

        const created = await api.createCourse({
          user_id: userId,
          name: `${course.emoji} ${course.name}`,
          exam_date: course.exam_date,
          color: course.color,
        })

        if (course.syllabus.trim()) {
          await api.generatePlan({
            syllabus: course.syllabus,
            course_id: created.id,
            user_id: userId,
            preferences: {
              learning_style: 'reading',
              daily_study_hours: dailyHours,
              preferred_session_length: pomodoroMinutes,
              difficulty_preference: 'gradual',
              break_frequency: pomodoroBreak,
              pomodoro_work_minutes: pomodoroMinutes,
              pomodoro_break_minutes: pomodoroBreak,
              long_break_minutes: 15,
              long_break_interval: 4,
            },
            assessment_info: {
              exam_date: new Date(course.exam_date).toISOString(),
              assessment_breakdown: { final: 100 },
              past_papers_available: false,
              past_papers_urls: [],
            },
          })
        }
      }

      router.push('/dashboard')
    } catch (e) {
      console.error(e)
      alert('Something went wrong — check the console.')
    } finally {
      setSaving(false)
    }
  }

  const presets = [
    { id: 'classic', label: 'Classic', desc: '25 min / 5 min break' },
    { id: 'power',   label: 'Power',   desc: '50 min / 10 min break' },
    { id: 'sprint',  label: 'Sprint',  desc: '15 min / 3 min break' },
    { id: 'custom',  label: 'Custom',  desc: 'Set your own' },
  ]

  const timeSlots = [
    { id: 'early',     label: 'Early morning', sub: '6–9 am'  },
    { id: 'morning',   label: 'Morning',        sub: '9–12 pm' },
    { id: 'afternoon', label: 'Afternoon',      sub: '12–5 pm' },
    { id: 'evening',   label: 'Evening',        sub: '5–9 pm'  },
    { id: 'night',     label: 'Night owl',      sub: '9 pm+'   },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="text-lg font-bold text-gray-800">Flowstate Setup</h1>
          <div className="flex gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className={`h-2 w-8 rounded-full transition-colors ${step >= s ? 'bg-blue-500' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-10">

        {/* ── Step 1: Schedule & Pomodoro ── */}
        {step === 1 && (
          <div className="space-y-8">
            <div>
              <h2 className="mb-1 text-2xl font-bold text-gray-800">How do you study?</h2>
              <p className="text-gray-500">This shapes your daily schedule and Pomodoro sessions.</p>
            </div>

            {/* Sessions per day */}
            <div>
              <label className="mb-3 block text-sm font-semibold text-gray-700">
                How many study sessions do you do per day?
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSessionsPerDay(n)}
                    className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition ${sessionsPerDay === n ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-400">e.g. morning + evening = 2</p>
            </div>

            {/* Session duration */}
            <div>
              <label className="mb-3 block text-sm font-semibold text-gray-700">
                How long is each session?
              </label>
              <div className="flex gap-2">
                {[1, 1.5, 2, 3, 4].map(h => (
                  <button key={h} onClick={() => setSessionDuration(h)}
                    className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition ${sessionDuration === h ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
                    {h}h
                  </button>
                ))}
              </div>
            </div>

            {/* Daily total summary */}
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              <span className="font-semibold">{sessionsPerDay} session{sessionsPerDay > 1 ? 's' : ''} × {sessionDuration}h = {dailyHours}h study per day</span>
              <span className="ml-2 text-blue-500">— used to build your schedule</span>
            </div>

            {/* Preferred times */}
            <div>
              <label className="mb-3 block text-sm font-semibold text-gray-700">
                When do you prefer to study? <span className="font-normal text-gray-400">(pick all that apply)</span>
              </label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {timeSlots.map(t => (
                  <button key={t.id} onClick={() => toggleTime(t.id)}
                    className={`rounded-xl border p-3 text-left transition ${preferredTimes.includes(t.id) ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    <div className={`text-xs font-semibold ${preferredTimes.includes(t.id) ? 'text-blue-700' : 'text-gray-700'}`}>{t.label}</div>
                    <div className="text-xs text-gray-400">{t.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Pomodoro style */}
            <div>
              <label className="mb-3 block text-sm font-semibold text-gray-700">Pomodoro style</label>
              <div className="grid grid-cols-2 gap-3">
                {presets.map(p => (
                  <button key={p.id} onClick={() => setPomodoroPreset(p.id)}
                    className={`rounded-xl border p-4 text-left transition ${pomodoroPreset === p.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    <div className={`font-semibold ${pomodoroPreset === p.id ? 'text-blue-700' : 'text-gray-800'}`}>{p.label}</div>
                    <div className="text-xs text-gray-500">{p.desc}</div>
                  </button>
                ))}
              </div>
              {pomodoroPreset === 'custom' && (
                <div className="mt-4 flex gap-4">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-gray-600">Work (min)</label>
                    <input type="number" min={5} max={120} value={customWork}
                      onChange={e => setCustomWork(Number(e.target.value))}
                      className={INPUT} />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-gray-600">Break (min)</label>
                    <input type="number" min={1} max={30} value={customBreak}
                      onChange={e => setCustomBreak(Number(e.target.value))}
                      className={INPUT} />
                  </div>
                </div>
              )}
            </div>

            <button onClick={() => setStep(2)}
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white shadow-lg transition hover:bg-blue-700">
              Next: Add your modules →
            </button>
          </div>
        )}

        {/* ── Step 2: Courses ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-1 text-2xl font-bold text-gray-800">Your modules</h2>
              <p className="text-gray-500">Add each exam module and paste your topic breakdown — the AI will turn it into a task schedule.</p>
            </div>

            {courses.map((course, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

                {/* Name row */}
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-2xl select-none">{course.emoji}</span>
                  <input
                    placeholder="Module name (e.g. Advanced Databases)"
                    value={course.name}
                    onChange={e => updateCourse(i, 'name', e.target.value)}
                    className={`flex-1 ${INPUT}`}
                  />
                  {courses.length > 1 && (
                    <button onClick={() => removeCourse(i)} className="shrink-0 text-gray-300 hover:text-red-400">✕</button>
                  )}
                </div>

                {/* Emoji picker */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">Emoji</label>
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => updateCourse(i, 'emoji', e)}
                        className={`rounded-lg px-2 py-1 text-lg transition ${course.emoji === e ? 'bg-blue-100 ring-1 ring-blue-400' : 'hover:bg-gray-100'}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Colour picker */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">Colour</label>
                  <div className="flex flex-wrap gap-2">
                    {PALETTE.map(({ color, label }) => (
                      <button key={color} onClick={() => updateCourse(i, 'color', color)}
                        title={label}
                        className={`h-7 w-7 rounded-full transition ${course.color === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Exam date */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">Exam date</label>
                  <input type="date" value={course.exam_date}
                    onChange={e => updateCourse(i, 'exam_date', e.target.value)}
                    className={INPUT} />
                </div>

                {/* Syllabus */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    Topic breakdown
                    <span className="ml-1 font-normal text-gray-400">— paste a structured list of topics, chapters, or learning objectives</span>
                  </label>
                  <textarea
                    rows={6}
                    placeholder={"e.g.\n• Week 1: Relational algebra, SQL fundamentals\n• Week 2: Normalisation (1NF–BCNF)\n• Week 3: Transactions & ACID properties\n..."}
                    value={course.syllabus}
                    onChange={e => updateCourse(i, 'syllabus', e.target.value)}
                    className={`${INPUT} resize-y`}
                  />
                </div>
              </div>
            ))}

            <button onClick={addCourse}
              className="w-full rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm text-gray-500 transition hover:border-blue-400 hover:text-blue-500">
              + Add another module
            </button>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                ← Back
              </button>
              <button onClick={() => setStep(3)} className="flex-1 rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700">
                Next: Busy periods →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Disruptions ── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-1 text-2xl font-bold text-gray-800">Busy periods</h2>
              <p className="text-gray-500">Deadlines, trips, tournaments, society events — anything that'll eat into study time. The scheduler skips these days automatically.</p>
            </div>

            {disruptions.length > 0 && (
              <div className="space-y-2">
                {disruptions.map((d, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{d.label}</div>
                      <div className="text-xs text-gray-400">{d.start_date} → {d.end_date}</div>
                    </div>
                    <button onClick={() => setDisruptions(disruptions.filter((_, idx) => idx !== i))}
                      className="text-gray-300 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-gray-700">Add a busy period</div>
              <input
                placeholder="e.g. Football tournament, Coursework deadline, Reading week"
                value={newDisruption.label}
                onChange={e => setNewDisruption({ ...newDisruption, label: e.target.value })}
                className={`mb-3 ${INPUT}`}
              />
              <div className="mb-3 flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">From</label>
                  <input type="date" value={newDisruption.start_date}
                    onChange={e => setNewDisruption({ ...newDisruption, start_date: e.target.value })}
                    className={INPUT} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">To</label>
                  <input type="date" value={newDisruption.end_date}
                    onChange={e => setNewDisruption({ ...newDisruption, end_date: e.target.value })}
                    className={INPUT} />
                </div>
              </div>
              <button onClick={addDisruption}
                className="w-full rounded-lg bg-gray-100 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200">
                + Add
              </button>
            </div>

            <p className="text-center text-xs text-gray-400">No disruptions? That's fine — skip straight through.</p>

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                ← Back
              </button>
              <button onClick={handleFinish} disabled={saving}
                className="flex-1 rounded-xl bg-blue-600 py-3 font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Generating your plan...' : 'Generate my plan →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

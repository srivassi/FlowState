'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { api } from '../../../lib/api'

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

const INPUT = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export default function NewModule() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [color, setColor] = useState(PALETTE[0].color)
  const [emoji, setEmoji] = useState(EMOJIS[0])
  const [syllabus, setSyllabus] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      const p = await api.getProfile(uid).catch(() => null)
      setProfile(p)
    })
  }, [router])

  const handleSave = async () => {
    if (!userId || !name || !examDate) return
    setSaving(true)
    try {
      const created = await api.createCourse({
        user_id: userId,
        name: `${emoji} ${name}`,
        exam_date: examDate,
        color,
      })

      if (syllabus.trim()) {
        const pomodoroMinutes = profile?.pomodoro_work_minutes || 25
        const pomodoroBreak   = profile?.pomodoro_break_minutes || 5
        const dailyHours      = profile?.daily_study_hours || 4

        await api.generatePlan({
          syllabus,
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
            long_break_minutes: profile?.long_break_minutes || 15,
            long_break_interval: profile?.long_break_interval || 4,
          },
          assessment_info: {
            exam_date: new Date(examDate).toISOString(),
            assessment_breakdown: { final: 100 },
            past_papers_available: false,
            past_papers_urls: [],
          },
        })
      }

      router.push('/dashboard')
    } catch (e) {
      console.error(e)
      alert('Something went wrong — check the console.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">← Dashboard</Link>
            <span className="text-gray-300">/</span>
            <h1 className="text-sm font-semibold text-gray-800">Add module</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-6 py-10">
        <div className="mb-8">
          {/* Live preview badge */}
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl shadow-sm"
              style={{ backgroundColor: color + '20', border: `2px solid ${color}40` }}>
              {emoji}
            </div>
            <div>
              <div className="font-semibold text-gray-800">{name || 'Module name'}</div>
              {examDate && (
                <div className="text-xs text-gray-400">
                  Exam {new Date(examDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Module name</label>
              <input
                placeholder="e.g. Advanced Databases"
                value={name}
                onChange={e => setName(e.target.value)}
                className={INPUT}
                autoFocus
              />
            </div>

            {/* Emoji */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Emoji</label>
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => setEmoji(e)}
                    className={`rounded-lg px-2 py-1 text-lg transition ${emoji === e ? 'bg-blue-100 ring-1 ring-blue-400' : 'hover:bg-gray-100'}`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Colour */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Colour</label>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map(({ color: c, label }) => (
                  <button key={c} onClick={() => setColor(c)} title={label}
                    className={`h-7 w-7 rounded-full transition ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Exam date */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Exam date</label>
              <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} className={INPUT} />
            </div>

            {/* Syllabus */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                Topic breakdown
                <span className="ml-1 font-normal text-gray-400">— paste a structured list of topics or learning objectives</span>
              </label>
              <textarea
                rows={8}
                placeholder={"e.g.\n• Week 1: Relational algebra, SQL fundamentals\n• Week 2: Normalisation (1NF–BCNF)\n• Week 3: Transactions & ACID\n..."}
                value={syllabus}
                onChange={e => setSyllabus(e.target.value)}
                className={`${INPUT} resize-y`}
              />
              <p className="mt-1 text-xs text-gray-400">
                Leave blank to add topics manually later. With a breakdown, Claude generates your full task schedule automatically.
              </p>
            </div>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving || !name || !examDate}
          className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Generating schedule...' : 'Add module →'}
        </button>
      </div>
    </div>
  )
}

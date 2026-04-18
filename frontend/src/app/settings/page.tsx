'use client'

export const dynamic = 'force-dynamic'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'

const NOTION = {
  bg: '#FFFFFF', sidebar: '#FBFBFA', border: '#EDEDED',
  hover: '#EFEFED', text: '#37352F', muted: 'rgba(55,53,47,0.5)',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider" style={{ color: NOTION.muted }}>{title}</h2>
      <div className="rounded-lg p-5" style={{ border: `1px solid ${NOTION.border}`, backgroundColor: NOTION.bg }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3" style={{ borderBottom: `1px solid ${NOTION.border}` }}>
      <span className="shrink-0 pt-1.5 text-sm font-medium" style={{ color: NOTION.text }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

const POMODORO_PRESETS = [
  { id: 'classic', label: 'Classic', work: 25, brk: 5, long: 15, desc: '25 / 5 / 15 min' },
  { id: 'power',   label: 'Power',   work: 50, brk: 10, long: 30, desc: '50 / 10 / 30 min' },
  { id: 'sprint',  label: 'Sprint',  work: 15, brk: 3,  long: 10, desc: '15 / 3 / 10 min' },
]

const INPUT = 'w-full rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none'

type Disruption = { id: string; start_date: string; end_date: string; reason?: string }

export default function SettingsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [scheduleStale, setScheduleStale] = useState(false)
  // snapshot of schedule-affecting fields at load time
  const scheduleSnapshot = React.useRef({ sessionsPerDay: 2, sessionDurationH: 2 })
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleFeedback, setRescheduleFeedback] = useState('')
  const [showReschedule, setShowReschedule] = useState(false)
  const [rescheduled, setRescheduled] = useState(false)

  // Profile fields
  const [displayName, setDisplayName] = useState('')
  const [sessionsPerDay, setSessionsPerDay] = useState(2)
  const [sessionDurationH, setSessionDurationH] = useState(2)
  const [pomodoroWork, setPomodoroWork] = useState('25')
  const [pomodoroBreak, setPomodoroBreak] = useState('5')
  const [longBreak, setLongBreak] = useState('15')
  const [activePreset, setActivePreset] = useState<string | null>('classic')

  // Disruptions
  const [disruptions, setDisruptions] = useState<Disruption[]>([])
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newReason, setNewReason] = useState('')
  const [addingDisruption, setAddingDisruption] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      const [profile, disrupts] = await Promise.all([
        api.getProfile(uid).catch(() => null),
        api.getDisruptions(uid).catch(() => []),
      ])
      if (profile) {
        setDisplayName(profile.display_name || '')
        const spd = profile.sessions_per_day || 2
        const sdh = profile.session_duration_minutes ? Math.round(profile.session_duration_minutes / 60) : 2
        setSessionsPerDay(spd)
        setSessionDurationH(sdh)
        scheduleSnapshot.current = { sessionsPerDay: spd, sessionDurationH: sdh }

        setPomodoroWork(String(profile.pomodoro_work_minutes || 25))
        setPomodoroBreak(String(profile.pomodoro_break_minutes || 5))
        setLongBreak(String(profile.long_break_minutes || 15))
        // Detect preset
        const preset = POMODORO_PRESETS.find(p => p.work === profile.pomodoro_work_minutes && p.brk === profile.pomodoro_break_minutes)
        setActivePreset(preset?.id || 'custom')
      }
      setDisruptions(disrupts)
    })
  }, [router])

  const applyPreset = (preset: typeof POMODORO_PRESETS[0]) => {
    setActivePreset(preset.id)
    setPomodoroWork(String(preset.work))
    setPomodoroBreak(String(preset.brk))
    setLongBreak(String(preset.long))
  }

  const saveProfile = async () => {
    if (!userId) return
    setSaving(true)
    try {
      await api.updateProfile(userId, {
        display_name: displayName || undefined,
        sessions_per_day: sessionsPerDay,
        session_duration_minutes: sessionDurationH * 60,
        daily_study_hours: sessionsPerDay * sessionDurationH,
        pomodoro_work_minutes: parseInt(pomodoroWork) || 25,
        pomodoro_break_minutes: parseInt(pomodoroBreak) || 5,
        long_break_minutes: parseInt(longBreak) || 15,
      })
      // Also update Supabase auth metadata for display name
      if (displayName) await supabase.auth.updateUser({ data: { full_name: displayName } })
      const snap = scheduleSnapshot.current
      if (sessionsPerDay !== snap.sessionsPerDay || sessionDurationH !== snap.sessionDurationH) {
        setScheduleStale(true)
        scheduleSnapshot.current = { sessionsPerDay, sessionDurationH }
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const addDisruption = async () => {
    if (!userId || !newStart || !newEnd) return
    const d = await api.createDisruption({ user_id: userId, start_date: newStart, end_date: newEnd, reason: newReason || undefined })
    setDisruptions(prev => [...prev, d])
    setNewStart(''); setNewEnd(''); setNewReason(''); setAddingDisruption(false)
  }

  const removeDisruption = async (id: string) => {
    await api.deleteDisruption(id)
    setDisruptions(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="min-h-screen" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", backgroundColor: NOTION.sidebar, color: NOTION.text }}>
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3" style={{ borderBottom: `1px solid ${NOTION.border}`, backgroundColor: NOTION.sidebar }}>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm transition-colors" style={{ color: NOTION.muted }}
            onMouseEnter={e => (e.currentTarget.style.color = NOTION.text)}
            onMouseLeave={e => (e.currentTarget.style.color = NOTION.muted)}>
            ← Dashboard
          </Link>
          <span className="text-sm font-semibold">Settings</span>
        </div>
        <button onClick={saveProfile} disabled={saving}
          className="rounded px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-50"
          style={{ backgroundColor: NOTION.text }}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
        </button>
      </div>

      {scheduleStale && (
        <div className="flex items-center justify-between gap-4 px-6 py-3 text-sm"
          style={{ backgroundColor: '#FFFBEB', borderBottom: '1px solid #FDE68A', color: '#92400E' }}>
          <span>⚠️ Your session settings changed — your task schedule may be out of date.</span>
          <div className="flex shrink-0 items-center gap-3">
            <button
              disabled={rescheduling}
              onClick={async () => {
                if (!userId) return
                setRescheduling(true)
                try {
                  await api.fullReschedule(userId, 'User updated session settings — please replan accordingly.')
                  setScheduleStale(false)
                  setRescheduled(true)
                  setTimeout(() => setRescheduled(false), 3000)
                } catch (e) { console.error(e) }
                finally { setRescheduling(false) }
              }}
              className="rounded px-3 py-1 text-xs font-semibold transition hover:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: '#F59E0B', color: '#fff' }}>
              {rescheduling ? 'Regenerating…' : rescheduled ? '✓ Done' : 'Regenerate now'}
            </button>
            <button onClick={() => setScheduleStale(false)} className="text-xs opacity-60 hover:opacity-100">Dismiss</button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-2xl px-6 py-10">

        {/* Profile */}
        <Section title="Profile">
          <Row label="Display name">
            <input value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              className={INPUT} style={{ border: `1px solid ${NOTION.border}` }} />
          </Row>
        </Section>

        {/* Study schedule */}
        <Section title="Study schedule">
          <Row label="Sessions per day">
            <div className="flex gap-2">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setSessionsPerDay(n)}
                  className="rounded px-3 py-1.5 text-sm font-medium transition"
                  style={{ backgroundColor: sessionsPerDay === n ? NOTION.text : NOTION.hover, color: sessionsPerDay === n ? '#FFF' : NOTION.text }}>
                  {n}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Session duration">
            <div className="flex gap-2">
              {[1,1.5,2,2.5,3,4].map(h => (
                <button key={h} onClick={() => setSessionDurationH(h)}
                  className="rounded px-3 py-1.5 text-sm font-medium transition"
                  style={{ backgroundColor: sessionDurationH === h ? NOTION.text : NOTION.hover, color: sessionDurationH === h ? '#FFF' : NOTION.text }}>
                  {h}h
                </button>
              ))}
            </div>
          </Row>
          <div className="pt-3 text-sm" style={{ color: NOTION.muted }}>
            Total: <strong style={{ color: NOTION.text }}>{sessionsPerDay} × {sessionDurationH}h = {sessionsPerDay * sessionDurationH}h/day</strong>
          </div>
        </Section>

        {/* Pomodoro */}
        <Section title="Pomodoro timer">
          <Row label="Preset">
            <div className="flex gap-2">
              {POMODORO_PRESETS.map(p => (
                <button key={p.id} onClick={() => applyPreset(p)}
                  className="rounded px-3 py-1.5 text-left transition"
                  style={{ backgroundColor: activePreset === p.id ? NOTION.text : NOTION.hover, color: activePreset === p.id ? '#FFF' : NOTION.text, border: '1px solid transparent' }}>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs opacity-70">{p.desc}</div>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Work / Break / Long break">
            <div className="flex items-center gap-2">
              <input type="number" value={pomodoroWork} onChange={e => { setPomodoroWork(e.target.value); setActivePreset('custom') }}
                className={INPUT + ' w-16 text-center'} style={{ border: `1px solid ${NOTION.border}` }} min={5} max={120} />
              <span style={{ color: NOTION.muted }}>min /</span>
              <input type="number" value={pomodoroBreak} onChange={e => { setPomodoroBreak(e.target.value); setActivePreset('custom') }}
                className={INPUT + ' w-16 text-center'} style={{ border: `1px solid ${NOTION.border}` }} min={1} max={30} />
              <span style={{ color: NOTION.muted }}>min /</span>
              <input type="number" value={longBreak} onChange={e => { setLongBreak(e.target.value); setActivePreset('custom') }}
                className={INPUT + ' w-16 text-center'} style={{ border: `1px solid ${NOTION.border}` }} min={5} max={60} />
              <span style={{ color: NOTION.muted }}>min</span>
            </div>
          </Row>
        </Section>

        {/* Disruptions */}
        <Section title="Busy periods & disruptions">
          {disruptions.length > 0 ? (
            <div className="mb-4 space-y-2">
              {disruptions.map(d => (
                <div key={d.id} className="flex items-center justify-between rounded px-3 py-2"
                  style={{ backgroundColor: NOTION.hover }}>
                  <div>
                    <span className="text-sm font-medium" style={{ color: NOTION.text }}>
                      {new Date(d.start_date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {' – '}
                      {new Date(d.end_date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {d.reason && <span className="ml-2 text-xs" style={{ color: NOTION.muted }}>{d.reason}</span>}
                  </div>
                  <button onClick={() => removeDisruption(d.id)} className="text-xs transition-colors hover:text-red-500" style={{ color: NOTION.muted }}>Remove</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mb-4 text-sm" style={{ color: NOTION.muted }}>No busy periods added yet.</p>
          )}

          {addingDisruption ? (
            <div className="space-y-3 rounded p-4" style={{ border: `1px solid ${NOTION.border}` }}>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium" style={{ color: NOTION.muted }}>From</label>
                  <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)}
                    className={INPUT} style={{ border: `1px solid ${NOTION.border}` }} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium" style={{ color: NOTION.muted }}>To</label>
                  <input type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)}
                    className={INPUT} style={{ border: `1px solid ${NOTION.border}` }} />
                </div>
              </div>
              <input placeholder="Reason (optional)" value={newReason} onChange={e => setNewReason(e.target.value)}
                className={INPUT} style={{ border: `1px solid ${NOTION.border}` }} />
              <div className="flex gap-2">
                <button onClick={addDisruption} disabled={!newStart || !newEnd}
                  className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                  style={{ backgroundColor: NOTION.text }}>
                  Add
                </button>
                <button onClick={() => setAddingDisruption(false)}
                  className="rounded px-3 py-1.5 text-sm transition hover:bg-[#EFEFED]"
                  style={{ color: NOTION.muted }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingDisruption(true)}
              className="rounded px-3 py-1.5 text-sm transition hover:bg-[#EFEFED]"
              style={{ color: NOTION.muted, border: `1px solid ${NOTION.border}` }}>
              + Add busy period
            </button>
          )}
        </Section>

        {/* Regenerate schedule */}
        <Section title="Schedule">
          <p className="mb-4 text-sm" style={{ color: NOTION.muted }}>
            Regenerate your full schedule using your current settings and busy periods. Optionally tell Claude what to change.
          </p>
          {showReschedule && (
            <textarea
              rows={3}
              value={rescheduleFeedback}
              onChange={e => setRescheduleFeedback(e.target.value)}
              placeholder="e.g. too many tasks on Fridays, spread databases topics more evenly, put harder topics earlier…"
              className="mb-3 w-full resize-none rounded px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
              style={{ border: `1px solid ${NOTION.border}`, backgroundColor: '#FAFAF9' }}
            />
          )}
          <div className="flex items-center gap-3">
            <button
              disabled={rescheduling}
              onClick={async () => {
                if (!userId) return
                if (!showReschedule) { setShowReschedule(true); return }
                setRescheduling(true)
                try {
                  await api.fullReschedule(userId, rescheduleFeedback || undefined)
                  setRescheduled(true)
                  setShowReschedule(false)
                  setRescheduleFeedback('')
                  setTimeout(() => setRescheduled(false), 3000)
                } catch (e) { console.error(e) }
                finally { setRescheduling(false) }
              }}
              className="rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
              style={{ backgroundColor: NOTION.text }}>
              {rescheduling ? 'Regenerating…' : rescheduled ? '✓ Done' : showReschedule ? 'Regenerate →' : '↺ Regenerate schedule'}
            </button>
            {showReschedule && (
              <button onClick={() => { setShowReschedule(false); setRescheduleFeedback('') }}
                className="rounded px-3 py-2 text-sm transition hover:bg-[#EFEFED]"
                style={{ color: NOTION.muted }}>
                Cancel
              </button>
            )}
          </div>
        </Section>

      </div>
    </div>
  )
}

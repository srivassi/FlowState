'use client'

import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export type ExamConfig = {
  question_types: string[]
  duration_minutes: number | null
  open_book: boolean | null
  guidance: string
}

const DEFAULT_CONFIG: ExamConfig = { question_types: [], duration_minutes: null, open_book: null, guidance: '' }
const QUESTION_TYPES = [
  ['multiple_choice', 'Multiple choice'],
  ['short_answer', 'Short answer'],
  ['essay', 'Essay'],
  ['problem_solving', 'Calculations / problem solving'],
  ['oral', 'Oral / viva'],
]

export default function GauntletExamSettings({ courseId, userId, initialConfig, onSaved, onPendingChange }: {
  courseId: string
  userId: string
  initialConfig?: ExamConfig | null
  onSaved: (config: ExamConfig) => void
  onPendingChange: (pending: boolean) => void
}) {
  const [saved, setSaved] = useState<ExamConfig>({ ...DEFAULT_CONFIG, ...initialConfig })
  const [draft, setDraft] = useState<ExamConfig>(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)

  useEffect(() => { onPendingChange(dirty || saving) }, [dirty, saving, onPendingChange])

  const update = (changes: Partial<ExamConfig>) => {
    setDraft(current => ({ ...current, ...changes }))
    setError('')
    setMessage('')
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const config = await api.gauntletSaveExamConfig(courseId, { user_id: userId, config: draft })
      setSaved(config)
      setDraft(config)
      onSaved(config)
      setMessage('Saved for this module. Gauntlet will use these settings for its questions and feedback.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save exam setup. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <details open className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <summary className="cursor-pointer text-sm font-semibold">How is this module examined?</summary>
      <p className="mt-2 text-xs text-gray-600">Optional. Saved across this module’s PDFs. Leave question types blank for the usual Socratic discussion.</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <fieldset disabled={saving}>
          <legend className="mb-2 text-xs font-medium">Question types — choose all that apply</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {QUESTION_TYPES.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.question_types.includes(value)}
                  onChange={event => update({ question_types: event.target.checked
                    ? [...draft.question_types, value]
                    : draft.question_types.filter(type => type !== value) })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <label className="text-xs font-medium">
            Exam duration (minutes)
            <input type="number" min={1} max={600} step={1} value={draft.duration_minutes ?? ''} disabled={saving}
              onChange={event => update({ duration_minutes: event.target.value ? Number(event.target.value) : null })}
              placeholder="Not specified" className="mt-1 block w-40 rounded border border-gray-200 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-medium">
            Reference materials
            <select value={draft.open_book === null ? '' : String(draft.open_book)} disabled={saving}
              onChange={event => update({ open_book: event.target.value === '' ? null : event.target.value === 'true' })}
              className="mt-1 block rounded border border-gray-200 bg-white px-3 py-2 text-sm">
              <option value="">Not specified</option>
              <option value="false">Closed book</option>
              <option value="true">Open book</option>
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium">
          Exam structure or marking guidance
          <textarea value={draft.guidance} maxLength={2000} rows={3} disabled={saving}
            onChange={event => update({ guidance: event.target.value })}
            placeholder="e.g. Two essays and one case study. Marks reward evidence, critical analysis and worked examples."
            className="mt-1 block w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm" />
        </label>
        <p className="text-xs text-gray-500">Duration guides pacing; it does not start a timer. Stars remain practice feedback, not official exam marks.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="text-sm text-green-800">{message}</p>}
        {dirty && <p className="text-xs text-gray-600">Save or discard your changes before starting a game.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={!dirty || saving}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save exam setup'}
          </button>
          {dirty && <button type="button" disabled={saving} onClick={() => { setDraft(saved); setError(''); setMessage('') }}
            className="px-3 py-2 text-sm">Discard changes</button>}
          <button type="button" disabled={saving} onClick={() => update(DEFAULT_CONFIG)}
            className="px-3 py-2 text-sm text-gray-600">Reset to Socratic defaults</button>
        </div>
      </form>
    </details>
  )
}

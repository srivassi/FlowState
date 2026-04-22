'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { api } from '../../lib/api'
import { renderNote } from '../../lib/noteRenderer'

const N = {
  bg: '#FFFFFF', sidebar: '#FBFBFA', border: '#EDEDED',
  hover: '#EFEFED', text: '#37352F', muted: 'rgba(55,53,47,0.5)',
  indigo: '#6366F1', indigoBg: '#EEF2FF',
  green: '#16A34A', greenBg: '#F0FDF4',
  amber: '#D97706', amberBg: '#FFFBEB',
  red: '#DC2626', redBg: '#FEF2F2',
}

type Course  = { id: string; name: string; color: string }
type Bank    = { id: string; title: string; source_type: string; source_label: string | null; created_at: string; question_count: number }
type Question = { id: string; bank_id: string; topic: string; question_text: string; model_answer: string; explanation: string; source_label: string | null }
type GradeResult = { grade: string; score: number; feedback: string; what_was_good: string; what_to_improve: string }

const GRADE_STYLE: Record<string, { color: string; bg: string }> = {
  Excellent:    { color: N.green,    bg: N.greenBg },
  Good:         { color: '#2563EB',  bg: '#EFF6FF'  },
  Developing:   { color: N.amber,    bg: N.amberBg  },
  Insufficient: { color: N.red,      bg: N.redBg    },
}

// ── MCQ helpers ──────────────────────────────────────────────
function parseMCQ(text: string) {
  const lines = text.split('\n')
  const optIdxs = lines.reduce((acc: number[], l, i) => /^\s*[A-D]\)/.test(l) ? [...acc, i] : acc, [])
  if (optIdxs.length < 2) return null
  const stem = lines.slice(0, optIdxs[0]).join('\n').trim()
  const options = optIdxs.map(i => {
    const t = lines[i].trim()
    return { letter: t[0], text: t.slice(2).trim() }
  })
  return { stem, options }
}

function mcqCorrectLetter(modelAnswer: string) {
  return modelAnswer.trim().match(/^([A-D])\)/)?.[1] ?? ''
}

function QuestionCard({ q }: { q: Question }) {
  const mcq          = parseMCQ(q.question_text)
  const correctLetter = mcq ? mcqCorrectLetter(q.model_answer) : ''

  const [mcqPick, setMcqPick]       = useState('')
  const [mcqAnswered, setMcqAnswered] = useState(false)
  const [attempt, setAttempt]   = useState('')
  const [revealed, setRevealed] = useState(false)
  const [grading, setGrading]   = useState(false)
  const [grade, setGrade]       = useState<GradeResult | null>(null)

  const handleGrade = async () => {
    if (!attempt.trim()) return
    setGrading(true)
    try {
      const result = await api.gradeAnswer({ question_text: q.question_text, user_answer: attempt, topic: q.topic })
      setGrade(result)
    } catch (e: any) {
      alert(e.message || 'Grading failed')
    } finally {
      setGrading(false)
    }
  }

  const sourceLabel = q.source_label ? (
    <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: N.indigoBg, color: N.indigo }}>{q.source_label}</span>
  ) : null

  // ── MCQ UI ──────────────────────────────────────────────────
  if (mcq) {
    const isRight = mcqPick === correctLetter
    return (
      <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: N.border, backgroundColor: N.bg }}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm leading-relaxed flex-1" style={{ color: N.text }}>{renderNote(mcq.stem)}</div>
          {sourceLabel}
        </div>

        <div className="space-y-1.5">
          {mcq.options.map(opt => {
            const isSel  = mcqPick === opt.letter
            const isCorr = opt.letter === correctLetter
            let st: React.CSSProperties = { borderColor: N.border, backgroundColor: N.bg, color: N.text }
            if (mcqAnswered) {
              if (isCorr)   st = { borderColor: '#16A34A', backgroundColor: '#F0FDF4', color: '#15803D' }
              else if (isSel) st = { borderColor: '#DC2626', backgroundColor: '#FEF2F2', color: '#B91C1C' }
              else          st = { borderColor: N.border, backgroundColor: N.sidebar, color: N.muted }
            } else if (isSel) {
              st = { borderColor: N.indigo, backgroundColor: N.indigoBg, color: N.indigo }
            }
            return (
              <button key={opt.letter}
                onClick={() => !mcqAnswered && setMcqPick(opt.letter)}
                disabled={mcqAnswered}
                className="w-full rounded-lg border px-4 py-2.5 text-left text-sm transition hover:bg-[#EFEFED] disabled:cursor-default"
                style={st}>
                <span className="font-semibold mr-2">{opt.letter})</span>{opt.text}
                {mcqAnswered && isCorr && <span className="float-right font-semibold">✓</span>}
                {mcqAnswered && isSel && !isCorr && <span className="float-right font-semibold">✗</span>}
              </button>
            )
          })}
        </div>

        {!mcqAnswered && (
          <button onClick={() => setMcqAnswered(true)} disabled={!mcqPick}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: N.indigo }}>
            Check
          </button>
        )}

        {mcqAnswered && (
          <div className="rounded-lg border p-3 space-y-1.5"
            style={{ borderColor: isRight ? '#16A34A44' : '#DC262644', backgroundColor: isRight ? '#F0FDF4' : '#FEF2F2' }}>
            <div className="text-sm font-semibold" style={{ color: isRight ? '#15803D' : '#B91C1C' }}>
              {isRight ? '✓ Correct!' : `✗ The correct answer is ${correctLetter}`}
            </div>
            <div className="text-sm leading-relaxed" style={{ color: N.text }}>{q.model_answer}</div>
            {q.explanation && <div className="text-xs" style={{ color: N.muted }}>{q.explanation}</div>}
          </div>
        )}

        {mcqAnswered && (
          <button onClick={() => { setMcqPick(''); setMcqAnswered(false) }}
            className="text-xs transition hover:opacity-70" style={{ color: N.muted }}>
            ↺ Try again
          </button>
        )}
      </div>
    )
  }

  // ── Written answer UI ───────────────────────────────────────
  const gs = grade ? (GRADE_STYLE[grade.grade] || GRADE_STYLE.Developing) : null
  return (
    <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: N.border, backgroundColor: N.bg }}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm leading-relaxed flex-1" style={{ color: N.text }}>{renderNote(q.question_text)}</div>
        {sourceLabel}
      </div>

      <textarea
        value={attempt}
        onChange={e => setAttempt(e.target.value)}
        placeholder="Write your answer…"
        rows={4}
        className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
        style={{ border: `1px solid ${N.border}`, backgroundColor: N.sidebar, color: N.text }}
      />

      <div className="flex gap-2 flex-wrap">
        <button onClick={handleGrade} disabled={grading || !attempt.trim()}
          className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          style={{ backgroundColor: N.indigo }}>
          {grading ? 'Grading…' : 'Grade'}
        </button>
        <button onClick={() => setRevealed(v => !v)}
          className="rounded-lg px-4 py-1.5 text-sm font-medium transition hover:bg-[#EFEFED]"
          style={{ border: `1px solid ${N.border}`, color: N.muted }}>
          {revealed ? 'Hide answer' : 'Reveal answer'}
        </button>
      </div>

      {grade && gs && (
        <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: gs.color + '44', backgroundColor: gs.bg }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: gs.color }}>{grade.grade}</span>
            <span className="text-xs" style={{ color: N.muted }}>{'★'.repeat(grade.score)}{'☆'.repeat(4 - grade.score)}</span>
          </div>
          <p className="text-sm" style={{ color: N.text }}>{grade.feedback}</p>
          {grade.what_was_good && <p className="text-xs" style={{ color: N.green }}>✓ {grade.what_was_good}</p>}
          {grade.what_to_improve && <p className="text-xs" style={{ color: N.amber }}>↑ {grade.what_to_improve}</p>}
        </div>
      )}

      {revealed && (
        <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: N.border, backgroundColor: N.sidebar }}>
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: N.muted }}>Model Answer</div>
          <div className="text-sm leading-relaxed" style={{ color: N.text }}>{renderNote(q.model_answer)}</div>
          {q.explanation && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide mt-2" style={{ color: N.muted }}>What this tests</div>
              <p className="text-xs" style={{ color: N.muted }}>{q.explanation}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function QuestionsPage() {
  const router = useRouter()
  const [userId, setUserId]         = useState<string | null>(null)
  const [courses, setCourses]       = useState<Course[]>([])
  const [selectedCourse, setSelectedCourse] = useState('')

  // Combined topic view
  const [topics, setTopics]         = useState<Record<string, Question[]>>({})
  const [activeTopic, setActiveTopic] = useState('')
  const [loadingTopics, setLoadingTopics] = useState(false)

  // Banks management panel
  const [showManage, setShowManage] = useState(false)
  const [banks, setBanks]           = useState<Bank[]>([])
  const [loadingBanks, setLoadingBanks] = useState(false)
  const [filterBank, setFilterBank] = useState<Bank | null>(null)

  // Upload form
  type PaperSlot = { id: string; file: File | null; title: string; year: string }
  const [showExtract, setShowExtract] = useState(false)
  const [papers, setPapers] = useState<PaperSlot[]>([{ id: crypto.randomUUID(), file: null, title: '', year: '' }])
  const [extracting, setExtracting]   = useState(false)
  const [extractProgress, setExtractProgress] = useState('')
  const [extractError, setExtractError] = useState('')

  // Generate form
  const [showGenerate, setShowGenerate]   = useState(false)
  const [genWhiteboards, setGenWhiteboards] = useState<any[]>([])
  const [genPdf, setGenPdf]               = useState('')
  const [genPdfName, setGenPdfName]       = useState('')
  const [genTitle, setGenTitle]           = useState('')
  const [genFormat, setGenFormat]             = useState('mixed')
  const [genCount, setGenCount]               = useState('')
  const [genInstructions, setGenInstructions] = useState('')
  const [generating, setGenerating]           = useState(false)
  const [genError, setGenError]               = useState('')
  const [genSuccess, setGenSuccess]           = useState<number | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: any) => {
      if (!session) { router.push('/auth/signin'); return }
      const uid = session.user.id
      setUserId(uid)
      const c = await api.getCourses(uid).catch(() => [])
      setCourses(c)
    })
  }, [router])

  const loadTopics = (courseId: string, uid: string) => {
    setLoadingTopics(true)
    setTopics({})
    setActiveTopic('')
    api.getQuestionTopics(uid, courseId)
      .then(data => {
        setTopics(data)
        const first = Object.keys(data)[0] || ''
        setActiveTopic(first)
      })
      .catch(() => setTopics({}))
      .finally(() => setLoadingTopics(false))
  }

  const loadBanks = (courseId: string, uid: string) => {
    setLoadingBanks(true)
    api.getQuestionBanks(uid, courseId)
      .then(setBanks).catch(() => setBanks([]))
      .finally(() => setLoadingBanks(false))
  }

  const openBank = async (bank: Bank) => {
    setFilterBank(bank)
    setShowManage(false)
    setLoadingTopics(true)
    setTopics({})
    setActiveTopic('')
    try {
      const data = await api.getQuestionBank(bank.id)
      const t = data.topics || {}
      setTopics(t)
      setActiveTopic(Object.keys(t)[0] || '')
    } catch {
      setTopics({})
    } finally {
      setLoadingTopics(false)
    }
  }

  const clearFilter = () => {
    setFilterBank(null)
    if (selectedCourse && userId) loadTopics(selectedCourse, userId)
  }

  const handleCourseChange = (courseId: string) => {
    setSelectedCourse(courseId)
    setShowManage(false)
    setShowExtract(false)
    setShowGenerate(false)
    setFilterBank(null)
    if (courseId && userId) {
      loadTopics(courseId, userId)
    }
  }

  const handleOpenManage = () => {
    setShowManage(true)
    setShowExtract(false)
    setShowGenerate(false)
    if (selectedCourse && userId) loadBanks(selectedCourse, userId)
  }

  const handleLoadWhiteboards = () => {
    if (!selectedCourse || !userId) return
    api.getWhiteboard(selectedCourse, userId).then(wb => {
      const pages = wb.pages || (wb.pdf_url ? [{ id: 'default', name: wb.pdf_name || 'PDF', pdf_url: wb.pdf_url, pdf_name: wb.pdf_name }] : [])
      setGenWhiteboards(pages.filter((p: any) => p.pdf_url))
    }).catch(() => setGenWhiteboards([]))
  }

  const updatePaper = (id: string, patch: Partial<PaperSlot>) =>
    setPapers(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
  const addPaper = () =>
    setPapers(ps => [...ps, { id: crypto.randomUUID(), file: null, title: '', year: '' }])
  const removePaper = (id: string) =>
    setPapers(ps => ps.filter(p => p.id !== id))

  const handleExtract = async () => {
    const ready = papers.filter(p => p.file && p.title.trim())
    if (!ready.length || !userId || !selectedCourse) return
    setExtracting(true); setExtractError(''); setExtractProgress('')
    const errors: string[] = []
    for (let i = 0; i < ready.length; i++) {
      const { file, title, year } = ready[i]
      setExtractProgress(`Processing ${i + 1}/${ready.length}: ${file!.name}`)
      const form = new FormData()
      form.append('file', file!)
      form.append('user_id', userId)
      form.append('course_id', selectedCourse)
      form.append('title', title.trim())
      form.append('source_label', year.trim())
      try {
        const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/questions/extract`
        const res = await fetch(url, { method: 'POST', body: form })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          errors.push(`${file!.name}: ${err.detail || 'Extraction failed'}`)
        }
      } catch (e: any) {
        errors.push(`${file!.name}: ${e.message}`)
      }
    }
    setExtracting(false); setExtractProgress('')
    if (errors.length) { setExtractError(errors.join(' | ')); return }
    setShowExtract(false)
    setPapers([{ id: crypto.randomUUID(), file: null, title: '', year: '' }])
    loadTopics(selectedCourse, userId)
    if (showManage) loadBanks(selectedCourse, userId)
  }

  const resetGenPanel = () => {
    setShowGenerate(false); setGenPdf(''); setGenTitle(''); setGenPdfName('')
    setGenFormat('mixed'); setGenCount(''); setGenInstructions(''); setGenSuccess(null); setGenError('')
  }

  const handleGenerate = async () => {
    if (!genPdf || !genTitle.trim() || !userId || !selectedCourse) return
    setGenerating(true); setGenError(''); setGenSuccess(null)
    try {
      const result = await api.generateQuestionBank({
        user_id: userId, course_id: selectedCourse, pdf_url: genPdf, pdf_name: genPdfName,
        title: genTitle.trim(), format: genFormat,
        num_questions: genCount ? parseInt(genCount) : undefined,
        instructions: genInstructions.trim() || undefined,
      })
      setGenSuccess(result.count)
      loadTopics(selectedCourse, userId)
      if (showManage) loadBanks(selectedCourse, userId)
    } catch (e: any) {
      setGenError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleDeleteBank = async (bankId: string) => {
    if (!confirm('Delete this bank and all its questions?')) return
    await api.deleteQuestionBank(bankId).catch(() => {})
    setBanks(prev => prev.filter(b => b.id !== bankId))
    if (selectedCourse && userId) loadTopics(selectedCourse, userId)
  }

  const topicList = Object.keys(topics).sort()
  const activeQs  = topics[activeTopic] || []
  const totalQs   = Object.values(topics).reduce((s, qs) => s + qs.length, 0)
  const hasTopics = topicList.length > 0

  return (
    <div className="flex h-screen flex-col" style={{ fontFamily: 'Inter, sans-serif', backgroundColor: N.sidebar, color: N.text }}>

      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-4 px-6 py-3"
        style={{ borderBottom: `1px solid ${N.border}`, backgroundColor: N.bg }}>
        <Link href="/dashboard" className="text-sm shrink-0" style={{ color: N.muted }}>← Dashboard</Link>
        <span className="text-sm font-semibold shrink-0">📝 Question Bank</span>

        <select value={selectedCourse} onChange={e => handleCourseChange(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
          style={{ borderColor: N.border, backgroundColor: N.sidebar, color: N.text }}>
          <option value="">Select module…</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {selectedCourse && (
          <div className="flex items-center gap-2 ml-auto">
            {hasTopics && !showManage && (
              <span className="text-xs" style={{ color: N.muted }}>{totalQs} questions · {topicList.length} topics</span>
            )}
            <button onClick={() => { setShowManage(false); setShowExtract(true); setShowGenerate(false) }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: N.indigo }}>
              + Past paper
            </button>
            <button onClick={() => { setShowManage(false); setShowExtract(false); setShowGenerate(true); handleLoadWhiteboards() }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition hover:bg-[#EFEFED]"
              style={{ border: `1px solid ${N.border}`, color: N.text, backgroundColor: N.bg }}>
              ✨ Generate
            </button>
            <button onClick={showManage ? () => setShowManage(false) : handleOpenManage}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition hover:bg-[#EFEFED]"
              style={{ border: `1px solid ${N.border}`, color: N.muted, backgroundColor: N.bg }}>
              {showManage ? 'Done' : 'Manage'}
            </button>
          </div>
        )}
      </div>

      {/* Upload / Generate panels */}
      {(showExtract || showGenerate) && (
        <div className="shrink-0 border-b px-6 py-4" style={{ borderColor: N.border, backgroundColor: N.bg }}>
          {showExtract && (
            <div className="max-w-2xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium" style={{ color: N.text }}>Past Papers</span>
                <button onClick={() => setShowExtract(false)} className="text-xs" style={{ color: N.muted }}>✕</button>
              </div>
              <div className="flex flex-col gap-2 mb-3">
                {papers.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg border px-3 py-2.5"
                    style={{ borderColor: N.border, backgroundColor: '#FAFAFA' }}>
                    <span className="text-xs shrink-0" style={{ color: N.muted }}>#{i + 1}</span>
                    <input type="file" accept=".pdf"
                      onChange={e => {
                        const f = e.target.files?.[0] || null
                        updatePaper(p.id, { file: f, title: p.title || (f ? f.name.replace(/\.pdf$/i, '') : '') })
                      }}
                      className="text-xs shrink-0" style={{ width: 180 }} />
                    <input value={p.title} onChange={e => updatePaper(p.id, { title: e.target.value })}
                      placeholder="Title"
                      className="flex-1 rounded border px-2 py-1 text-xs focus:outline-none"
                      style={{ borderColor: N.border }} />
                    <input value={p.year} onChange={e => updatePaper(p.id, { year: e.target.value })}
                      placeholder="Year"
                      className="w-16 rounded border px-2 py-1 text-xs focus:outline-none"
                      style={{ borderColor: N.border }} />
                    {papers.length > 1 && (
                      <button onClick={() => removePaper(p.id)} className="text-xs shrink-0 transition hover:text-red-500"
                        style={{ color: N.muted }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={addPaper}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium transition hover:bg-[#EFEFED]"
                  style={{ border: `1px solid ${N.border}`, color: N.muted }}>
                  + Add paper
                </button>
                <button onClick={handleExtract}
                  disabled={extracting || !papers.some(p => p.file && p.title.trim())}
                  className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: N.indigo }}>
                  {extracting
                    ? extractProgress
                    : `Generate Bank${papers.filter(p => p.file && p.title.trim()).length > 1 ? ` (${papers.filter(p => p.file && p.title.trim()).length} papers)` : ''}`}
                </button>
              </div>
              {extractError && <p className="mt-2 text-xs" style={{ color: N.red }}>{extractError}</p>}
            </div>
          )}

          {showGenerate && (
            <div className="max-w-3xl space-y-3">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-36">
                  <label className="block text-xs mb-1" style={{ color: N.muted }}>Title</label>
                  <input value={genTitle} onChange={e => { setGenTitle(e.target.value); setGenSuccess(null) }}
                    placeholder="e.g. Week 6 Notes Practice"
                    className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
                    style={{ borderColor: N.border }} />
                </div>
                <div className="flex-1 min-w-36">
                  <label className="block text-xs mb-1" style={{ color: N.muted }}>PDF (from Whiteboard)</label>
                  <select value={genPdf} onChange={e => {
                    const wb = genWhiteboards.find((p: any) => p.pdf_url === e.target.value)
                    setGenPdf(e.target.value); setGenPdfName(wb?.pdf_name || wb?.name || ''); setGenSuccess(null)
                  }}
                    className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
                    style={{ borderColor: N.border }}>
                    <option value="">Select PDF…</option>
                    {genWhiteboards.map((p: any) => <option key={p.id} value={p.pdf_url}>{p.pdf_name || p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: N.muted }}>Format</label>
                  <select value={genFormat} onChange={e => { setGenFormat(e.target.value); setGenSuccess(null) }}
                    className="rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
                    style={{ borderColor: N.border }}>
                    <option value="mixed">Mixed</option>
                    <option value="mcq">MCQ</option>
                    <option value="short_answer">Short answer</option>
                    <option value="essay">Essay</option>
                  </select>
                </div>
                <div style={{ width: 80 }}>
                  <label className="block text-xs mb-1" style={{ color: N.muted }}>Questions</label>
                  <input value={genCount} onChange={e => { setGenCount(e.target.value.replace(/\D/g, '')); setGenSuccess(null) }}
                    placeholder="Auto"
                    className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
                    style={{ borderColor: N.border }} />
                </div>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: N.muted }}>Additional instructions (optional)</label>
                <input value={genInstructions} onChange={e => { setGenInstructions(e.target.value); setGenSuccess(null) }}
                  placeholder="e.g. Focus on edge cases, include code examples, emphasise week 4 content…"
                  className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none"
                  style={{ borderColor: N.border }} />
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={handleGenerate} disabled={generating || !genPdf || !genTitle.trim()}
                  className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: N.indigo }}>
                  {generating ? 'Generating…' : genSuccess !== null ? '↺ Regenerate' : 'Generate'}
                </button>
                {genSuccess !== null && (
                  <span className="text-xs font-medium" style={{ color: N.green }}>
                    ✓ {genSuccess} questions generated
                  </span>
                )}
                <button onClick={resetGenPanel} className="text-sm ml-auto" style={{ color: N.muted }}>✕</button>
                {genError && <p className="w-full text-xs" style={{ color: N.red }}>{genError}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedCourse ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: N.muted }}>Select a module to get started.</p>
        </div>
      ) : loadingTopics ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-500" />
        </div>
      ) : showManage ? (
        /* ── Manage banks panel ── */
        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full">
          <h2 className="text-sm font-semibold mb-4" style={{ color: N.text }}>Question banks for this module</h2>
          {loadingBanks ? (
            <p className="text-sm" style={{ color: N.muted }}>Loading…</p>
          ) : banks.length === 0 ? (
            <p className="text-sm" style={{ color: N.muted }}>No banks yet.</p>
          ) : (
            <div className="space-y-2">
              {banks.map(bank => (
                <div key={bank.id}
                  onClick={() => openBank(bank)}
                  className="flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition hover:bg-[#FAFAFA]"
                  style={{ borderColor: N.border, backgroundColor: N.bg }}>
                  <span>{bank.source_type === 'past_paper' ? '📄' : '✨'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: N.text }}>{bank.title}</div>
                    <div className="text-xs" style={{ color: N.muted }}>
                      {bank.source_type === 'past_paper' ? 'Past paper' : 'Generated'}
                      {bank.source_label && ` · ${bank.source_label}`}
                      {' · '}{bank.question_count} questions
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleDeleteBank(bank.id) }}
                    className="text-xs transition hover:opacity-70 shrink-0" style={{ color: N.red }}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !hasTopics ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-2">
          <p className="text-sm" style={{ color: N.muted }}>No questions yet.</p>
          <p className="text-xs" style={{ color: N.muted }}>Upload a past paper or generate from your notes.</p>
        </div>
      ) : (
        /* ── Main topic view ── */
        <div className="flex flex-1 overflow-hidden">
          {/* Topic sidebar */}
          <div className="w-52 shrink-0 overflow-y-auto border-r p-3 space-y-0.5"
            style={{ borderColor: N.border, backgroundColor: N.bg }}>
            {topicList.map(t => (
              <button key={t} onClick={() => setActiveTopic(t)}
                className="w-full rounded-lg px-3 py-2 text-left transition"
                style={{
                  backgroundColor: activeTopic === t ? N.indigoBg : 'transparent',
                  color: activeTopic === t ? N.indigo : N.text,
                }}>
                <div className="text-xs font-medium truncate">{t}</div>
                <div className="text-xs mt-0.5" style={{ color: activeTopic === t ? N.indigo + 'aa' : N.muted }}>
                  {topics[t].length} question{topics[t].length !== 1 ? 's' : ''}
                </div>
              </button>
            ))}
          </div>

          {/* Questions */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {filterBank && (
              <div className="flex items-center gap-2 -mt-1 mb-1">
                <button onClick={clearFilter} className="text-xs transition hover:opacity-70" style={{ color: N.muted }}>
                  ← All questions
                </button>
                <span className="text-xs" style={{ color: N.muted }}>·</span>
                <span className="text-xs font-medium truncate" style={{ color: N.text }}>{filterBank.title}</span>
              </div>
            )}
            <h2 className="text-base font-semibold" style={{ color: N.text }}>{activeTopic}</h2>
            {activeQs.map(q => <QuestionCard key={q.id} q={q} />)}
          </div>
        </div>
      )}
    </div>
  )
}

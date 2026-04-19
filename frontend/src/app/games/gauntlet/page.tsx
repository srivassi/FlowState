'use client'

export const dynamic = 'force-dynamic'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '../../../lib/api'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const N = {
  bg: '#FFFFFF', sidebar: '#FBFBFA', border: '#EDEDED',
  hover: '#EFEFED', text: '#37352F', muted: 'rgba(55,53,47,0.5)',
  indigo: '#6366F1', indigoBg: '#EEF2FF',
}

type Topic = { id: string; title: string; summary: string; key_points?: string[] }
type Message = { role: 'user' | 'assistant'; content: string }
type TopicState = { topic: Topic; messages: Message[]; stars: number | null }
type Phase = 'loading' | 'active' | 'finished'

function renderKatex(latex: string, display: boolean): React.ReactNode {
  try {
    const html = katex.renderToString(latex, { displayMode: display, throwOnError: false })
    return <span dangerouslySetInnerHTML={{ __html: html }} style={display ? { display: 'block', overflowX: 'auto', margin: '6px 0' } : undefined} />
  } catch {
    return <span>{display ? `$$${latex}$$` : `$${latex}$`}</span>
  }
}

function inlineStyle(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(\$\$(.+?)\$\$|\$([^$\n]+?)\$|\*\*(.+?)\*\*|`(.+?)`)/g
  let last = 0; let key = 0; let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    if (m[2] !== undefined) parts.push(<span key={key++}>{renderKatex(m[2], true)}</span>)
    else if (m[3] !== undefined) parts.push(<span key={key++}>{renderKatex(m[3], false)}</span>)
    else if (m[4] !== undefined) parts.push(<strong key={key++}>{m[4]}</strong>)
    else parts.push(<code key={key++} style={{ background: 'rgba(55,53,47,0.08)', borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace', fontSize: '0.88em' }}>{m[5]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>)
  return <>{parts}</>
}

function renderMsg(text: string) {
  const nodes: React.ReactNode[] = []
  let listItems: string[] = []
  let key = 0

  const flushList = () => {
    if (!listItems.length) return
    nodes.push(
      <ul key={`list-${key++}`} style={{ paddingLeft: 16, margin: '4px 0', listStyle: 'none' }}>
        {listItems.map((li, i) => (
          <li key={i} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
            <span style={{ opacity: 0.5, flexShrink: 0 }}>•</span>
            <span>{inlineStyle(li)}</span>
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  // Split into segments: fenced code blocks vs normal lines
  const fenceRe = /^```(\w*)\n([\s\S]*?)```$/gm
  let cursor = 0
  let fm: RegExpExecArray | null

  const processLines = (chunk: string) => {
    chunk.split('\n').forEach((line) => {
      // Block math $$...$$ on its own line
      const blockMath = line.match(/^\s*\$\$(.+?)\$\$\s*$/)
      if (blockMath) {
        flushList()
        nodes.push(<div key={`bm-${key++}`}>{renderKatex(blockMath[1], true)}</div>)
        return
      }
      const isBullet = /^\s*[-•*]\s/.test(line)
      if (isBullet) { listItems.push(line.replace(/^\s*[-•*]\s/, '')); return }
      flushList()
      if (line.trim() === '') nodes.push(<div key={`br-${key++}`} style={{ height: 6 }} />)
      else nodes.push(<div key={`l-${key++}`}>{inlineStyle(line)}</div>)
    })
  }

  while ((fm = fenceRe.exec(text)) !== null) {
    if (fm.index > cursor) processLines(text.slice(cursor, fm.index))
    flushList()
    const lang = fm[1] || ''
    const code = fm[2]
    nodes.push(
      <pre key={`code-${key++}`} style={{
        background: 'rgba(55,53,47,0.06)', borderRadius: 6, padding: '10px 14px',
        fontFamily: 'monospace', fontSize: '0.85em', overflowX: 'auto',
        margin: '6px 0', whiteSpace: 'pre',
      }}>
        {lang && <div style={{ opacity: 0.4, fontSize: '0.8em', marginBottom: 4 }}>{lang}</div>}
        <code>{code}</code>
      </pre>
    )
    cursor = fm.index + fm[0].length
  }
  if (cursor < text.length) processLines(text.slice(cursor))
  flushList()
  return <>{nodes}</>
}

const STAR_META: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'Getting there',  color: '#DC2626', bg: '#FEF2F2' },
  2: { label: 'Good work',      color: '#D97706', bg: '#FFFBEB' },
  3: { label: 'Nailed it',      color: '#16A34A', bg: '#F0FDF4' },
}

function StarBadge({ stars }: { stars: number }) {
  const m = STAR_META[stars]
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ color: m.color, backgroundColor: m.bg, border: `1px solid ${m.color}33` }}>
      {'⭐'.repeat(stars)} {m.label}
    </span>
  )
}

function TopicRail({ topicStates, currentIdx }: { topicStates: TopicState[]; currentIdx: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {topicStates.map((ts, i) => {
        const active = i === currentIdx
        const done   = ts.stars !== null
        return (
          <div key={ts.topic.id}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium"
            style={{
              backgroundColor: active ? N.indigo : done ? '#F0FDF4' : N.hover,
              color: active ? '#fff' : done ? '#16A34A' : N.muted,
              border: `1px solid ${active ? N.indigo : done ? '#86EFAC' : N.border}`,
            }}>
            <span>{done ? '✓' : active ? '▶' : `${i + 1}`}</span>
            <span className="max-w-30 truncate">{ts.topic.title}</span>
            {done && ts.stars && <span>{'⭐'.repeat(ts.stars)}</span>}
          </div>
        )
      })}
    </div>
  )
}

export default function GauntletPage() {
  const router = useRouter()
  const [phase, setPhase]             = useState<Phase>('loading')
  const [loadingMsg, setLoadingMsg]   = useState('Reading your PDF…')
  const [pdfName, setPdfName]         = useState('')
  const [topicStates, setTopicStates] = useState<TopicState[]>([])
  const [currentIdx, setCurrentIdx]   = useState(0)
  const [pdfText, setPdfText]         = useState('')
  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const currentTS = topicStates[currentIdx]

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [topicStates, currentIdx])

  useEffect(() => {
    const raw = sessionStorage.getItem('gauntletPdf')
    if (!raw) { router.replace('/games'); return }
    const { pdfUrl, pdfName: name } = JSON.parse(raw)
    setPdfName(name || 'PDF')
    setTimeout(() => setLoadingMsg('Extracting topics with Claude…'), 1400)
    api.gauntletStart(pdfUrl)
      .then(({ topics, pdf_text }: { topics: Topic[]; pdf_text: string }) => {
        setPdfText(pdf_text)
        const states: TopicState[] = topics.map(t => ({ topic: t, messages: [], stars: null }))
        setTopicStates(states)
        return sendTurn('', states, 0, pdf_text, topics)
      })
      .catch((e: any) => {
        alert(e.message || 'Failed to start Gauntlet.')
        router.replace('/games')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendTurn = async (
    userMsg: string,
    states: TopicState[],
    idx: number,
    text: string,
    topics: Topic[],
  ) => {
    setSending(true)
    setPhase('active')
    const prior = states[idx].messages
    try {
      const res = await api.gauntletChat({
        pdf_text: text, topics, current_topic_index: idx,
        messages: prior, user_message: userMsg || '__start__',
      })
      const newMsgs: Message[] = userMsg
        ? [...prior, { role: 'user', content: userMsg }, { role: 'assistant', content: res.reply }]
        : [{ role: 'assistant', content: res.reply }]
      const updated = states.map((s, i) => i === idx ? { ...s, messages: newMsgs } : s)

      if (res.action === 'next_topic' || res.action === 'finish') {
        const withStars = updated.map((s, i) => i === idx ? { ...s, stars: res.stars } : s)
        setTopicStates(withStars)
        if (res.action === 'finish') {
          setPhase('finished')
        } else {
          const next = idx + 1
          setCurrentIdx(next)
          setTimeout(() => sendTurn('', withStars, next, text, topics), 500)
        }
      } else {
        setTopicStates(updated)
      }
    } catch (e: any) {
      alert(e.message || 'Something went wrong.')
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => {
    if (!input.trim() || sending || phase !== 'active') return
    const msg = input.trim(); setInput('')
    sendTurn(msg, topicStates, currentIdx, pdfText, topicStates.map(s => s.topic))
  }

  const totalStars = topicStates.reduce((s, ts) => s + (ts.stars || 0), 0)
  const maxStars   = topicStates.length * 3
  const pct        = maxStars > 0 ? Math.round((totalStars / maxStars) * 100) : 0

  // ── Loading ─────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4"
        style={{ fontFamily: "Inter, sans-serif", backgroundColor: N.sidebar }}>
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-500" />
        <p className="text-sm font-medium" style={{ color: N.text }}>{loadingMsg}</p>
        <p className="text-xs" style={{ color: N.muted }}>{pdfName}</p>
      </div>
    )
  }

  // ── Finished ────────────────────────────────────────────────
  if (phase === 'finished') {
    const grade = pct >= 80 ? '🏆 Master' : pct >= 60 ? '⭐ Proficient' : pct >= 40 ? '📚 Learning' : '🌱 Getting started'
    return (
      <div className="min-h-screen" style={{ fontFamily: 'Inter, sans-serif', backgroundColor: N.sidebar, color: N.text }}>
        <div className="sticky top-0 z-10 flex items-center gap-4 px-6 py-3" style={{ borderBottom: `1px solid ${N.border}`, backgroundColor: N.sidebar }}>
          <Link href="/games" className="text-sm" style={{ color: N.muted }}>← Games</Link>
          <span className="text-sm font-semibold">⚔️ Gauntlet — Results</span>
        </div>
        <div className="mx-auto max-w-lg px-6 py-12">
          <div className="mb-8 text-center">
            <div className="mb-2 text-5xl">🎉</div>
            <h1 className="mb-1 text-2xl font-bold" style={{ color: N.text }}>Gauntlet Complete!</h1>
            <p className="text-sm" style={{ color: N.muted }}>{pdfName}</p>
          </div>

          {/* Score card */}
          <div className="mb-6 rounded-xl border p-6 text-center" style={{ borderColor: N.border, backgroundColor: N.bg }}>
            <div className="mb-1 text-4xl font-bold" style={{ color: N.indigo }}>{totalStars} / {maxStars}</div>
            <div className="mb-4 text-sm" style={{ color: N.muted }}>stars earned</div>
            <div className="mb-4 h-2 rounded-full" style={{ backgroundColor: N.hover }}>
              <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: N.indigo }} />
            </div>
            <div className="text-base font-semibold" style={{ color: N.text }}>{grade}</div>
          </div>

          {/* Per-topic breakdown */}
          <div className="mb-6 space-y-2">
            {topicStates.map(ts => (
              <div key={ts.topic.id} className="flex items-center justify-between rounded-lg border px-4 py-3"
                style={{ borderColor: N.border, backgroundColor: N.bg }}>
                <span className="truncate text-sm font-medium mr-3" style={{ color: N.text }}>{ts.topic.title}</span>
                {ts.stars && <StarBadge stars={ts.stars} />}
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <Link href="/games"
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: N.indigo }}>
              ← Back to Games
            </Link>
            <button onClick={() => {
              setTopicStates(prev => prev.map(ts => ({ ...ts, messages: [], stars: null })))
              setCurrentIdx(0); setPhase('loading'); setLoadingMsg('Restarting…')
              const raw = sessionStorage.getItem('gauntletPdf')
              if (!raw) return
              const { pdfUrl } = JSON.parse(raw)
              api.gauntletStart(pdfUrl).then(({ topics, pdf_text }: any) => {
                setPdfText(pdf_text)
                const states = topics.map((t: Topic) => ({ topic: t, messages: [], stars: null }))
                setTopicStates(states); sendTurn('', states, 0, pdf_text, topics)
              })
            }}
              className="rounded-lg px-5 py-2.5 text-sm font-medium transition hover:bg-[#EFEFED]"
              style={{ border: `1px solid ${N.border}`, color: N.text, backgroundColor: N.bg }}>
              Play again ↺
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Active game ─────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col"
      style={{ fontFamily: 'Inter, sans-serif', backgroundColor: N.sidebar, color: N.text }}>

      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 md:px-6"
        style={{ borderBottom: `1px solid ${N.border}`, backgroundColor: N.bg }}>
        <Link href="/games" className="shrink-0 text-sm transition-colors" style={{ color: N.muted }}
          onMouseEnter={e => (e.currentTarget.style.color = N.text)}
          onMouseLeave={e => (e.currentTarget.style.color = N.muted)}>
          ← Games
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-sm font-semibold" style={{ color: N.text }}>⚔️ Gauntlet</div>
          <div className="truncate text-xs" style={{ color: N.muted }}>{pdfName}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold" style={{ color: N.indigo }}>{totalStars} ⭐</div>
          <div className="text-xs" style={{ color: N.muted }}>{pct}%</div>
        </div>
      </div>

      {/* Topic rail */}
      <div className="shrink-0 overflow-x-auto px-6 py-3"
        style={{ borderBottom: `1px solid ${N.border}`, backgroundColor: N.bg }}>
        <TopicRail topicStates={topicStates} currentIdx={currentIdx} />
      </div>

      {/* Current topic label */}
      {currentTS && (
        <div className="shrink-0 px-6 py-3" style={{ borderBottom: `1px solid ${N.border}`, backgroundColor: N.sidebar }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: N.indigo }}>
            Topic {currentIdx + 1} of {topicStates.length}
          </div>
          <div className="text-sm font-semibold" style={{ color: N.text }}>{currentTS.topic.title}</div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 md:px-6">
        {currentTS?.messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
                style={{ backgroundColor: N.indigoBg, border: `1px solid ${N.indigo}33` }}>
                🎓
              </div>
            )}
            <div className="max-w-lg rounded-2xl px-4 py-3 text-sm leading-relaxed"
              style={m.role === 'user'
                ? { backgroundColor: N.indigo, color: '#fff', borderBottomRightRadius: 4 }
                : { backgroundColor: N.bg, color: N.text, borderBottomLeftRadius: 4, border: `1px solid ${N.border}` }}>
              {m.role === 'assistant' ? renderMsg(m.content) : m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
              style={{ backgroundColor: N.indigoBg, border: `1px solid ${N.indigo}33` }}>
              🎓
            </div>
            <div className="rounded-2xl px-4 py-3 text-sm"
              style={{ backgroundColor: N.bg, color: N.muted, border: `1px solid ${N.border}` }}>
              <span className="animate-pulse">Thinking…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 md:px-6 md:py-4" style={{ borderTop: `1px solid ${N.border}`, backgroundColor: N.bg }}>
        <div className="flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Type your answer…"
            disabled={sending}
            autoFocus
            className="flex-1 rounded-lg px-4 py-2.5 text-sm focus:outline-none disabled:opacity-50"
            style={{ border: `1px solid ${N.border}`, backgroundColor: N.sidebar, color: N.text }}
          />
          <button onClick={handleSend} disabled={sending || !input.trim()}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: N.indigo }}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

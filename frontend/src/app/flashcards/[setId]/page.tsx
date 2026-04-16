'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { api } from '../../../lib/api'

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

type Flashcard = {
  id: string
  question: string
  answer: string
  order_index: number
  status?: 'new' | 'review' | 'mastered'
}

type FlashcardSet = {
  id: string
  title: string
  course_id: string
}

// ── Card content renderer (supports fenced code blocks + images + inline bold/code) ──

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[0].startsWith('**')) parts.push(<strong key={m.index}>{m[2]}</strong>)
    else parts.push(<code key={m.index} style={{ backgroundColor: 'rgba(55,53,47,0.08)', borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace', fontSize: '0.88em' }}>{m[3]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>
}

function renderCardContent(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = []
  const combined = /```(\w*)\n?([\s\S]*?)```|!\[([^\]]*)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = combined.exec(text)) !== null) {
    if (m.index > last) {
      const chunk = text.slice(last, m.index)
      chunk.split('\n').forEach((line, li) => {
        if (li > 0) nodes.push(<br key={`br-${m!.index}-${li}`} />)
        nodes.push(<span key={`t-${m!.index}-${li}`}>{renderInline(line)}</span>)
      })
    }
    if (m[0].startsWith('```')) {
      const lang = m[1] || ''
      const code = m[2].trim()
      nodes.push(
        <pre key={m.index} style={{ backgroundColor: 'rgba(55,53,47,0.06)', border: '1px solid rgba(55,53,47,0.1)', borderRadius: 6, padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.82em', overflowX: 'auto', textAlign: 'left', margin: '8px 0', lineHeight: 1.55 }}>
          {lang && <div style={{ fontSize: '0.75em', color: 'rgba(55,53,47,0.4)', marginBottom: 4 }}>{lang}</div>}
          <code>{code}</code>
        </pre>
      )
    } else {
      const alt = m[3] || ''
      const url = m[4]
      nodes.push(
        <img key={m.index} src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 6, margin: '8px auto', display: 'block', objectFit: 'contain' }} />
      )
    }
    last = m.index + m[0].length
  }

  if (last < text.length) {
    const chunk = text.slice(last)
    chunk.split('\n').forEach((line, li) => {
      if (li > 0) nodes.push(<br key={`end-br-${li}`} />)
      nodes.push(<span key={`end-t-${li}`}>{renderInline(line)}</span>)
    })
  }

  return <div style={{ textAlign: 'left' }}>{nodes}</div>
}

export default function StudyPage() {
  const router = useRouter()
  const { setId } = useParams<{ setId: string }>()

  const [set, setSet] = useState<FlashcardSet | null>(null)
  const [cards, setCards] = useState<Flashcard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mastered, setMastered] = useState<Set<string>>(new Set())
  const [review, setReview] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(false)

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editCards, setEditCards] = useState<Flashcard[]>([])
  const [saving, setSaving] = useState(false)
  const [addingCard, setAddingCard] = useState(false)
  const [newQ, setNewQ] = useState('')
  const [newA, setNewA] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: any } }) => {
      if (!session) { router.push('/auth/signin'); return }
      const [setData, cardsData] = await Promise.all([
        supabase.from('flashcard_sets').select('*').eq('id', setId).single().then(r => r.data),
        api.getFlashcards(setId).catch(() => []),
      ])
      setSet(setData)
      setCards(cardsData)
      setEditCards(cardsData)
      setLoading(false)
    })
  }, [setId, router])

  const currentCard = cards[currentIndex]

  const handleGotIt = () => {
    setMastered(prev => new Set([...prev, currentCard.id]))
    setReview(prev => { const n = new Set(prev); n.delete(currentCard.id); return n })
    advance()
  }

  const handleNeedReview = () => {
    setReview(prev => new Set([...prev, currentCard.id]))
    setMastered(prev => { const n = new Set(prev); n.delete(currentCard.id); return n })
    advance()
  }

  const advance = () => {
    setFlipped(false)
    setTimeout(() => {
      if (currentIndex < cards.length - 1) {
        setCurrentIndex(i => i + 1)
      } else {
        setDone(true)
      }
    }, 150)
  }

  const restart = () => {
    setCurrentIndex(0)
    setFlipped(false)
    setDone(false)
    setMastered(new Set())
    setReview(new Set())
  }

  const restartReview = () => {
    const reviewCards = cards.filter(c => review.has(c.id))
    if (reviewCards.length === 0) return
    setCards(reviewCards)
    setCurrentIndex(0)
    setFlipped(false)
    setDone(false)
    setMastered(new Set())
    setReview(new Set())
  }

  // Edit handlers
  const handleSaveEdit = async (card: Flashcard) => {
    setSaving(true)
    await api.updateFlashcard(card.id, { question: card.question, answer: card.answer }).catch(() => {})
    setCards(prev => prev.map(c => c.id === card.id ? card : c))
    setSaving(false)
  }

  const handleDeleteCard = async (cardId: string) => {
    if (!confirm('Delete this card?')) return
    await api.deleteFlashcard(cardId).catch(() => {})
    setCards(prev => prev.filter(c => c.id !== cardId))
    setEditCards(prev => prev.filter(c => c.id !== cardId))
  }

  const handleAddCard = async () => {
    if (!newQ.trim() || !newA.trim()) return
    setSaving(true)
    try {
      const card = await api.addFlashcard({ set_id: setId, question: newQ.trim(), answer: newA.trim(), order_index: cards.length })
      setCards(prev => [...prev, card])
      setEditCards(prev => [...prev, card])
      setNewQ('')
      setNewA('')
      setAddingCard(false)
    } catch {}
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: NOTION.bg }}>
        <div className="text-sm" style={{ color: NOTION.muted }}>Loading…</div>
      </div>
    )
  }

  const progress = cards.length > 0 ? ((mastered.size + review.size) / cards.length) * 100 : 0

  return (
    <div className="min-h-screen" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", backgroundColor: NOTION.bg }}>
      <div className="mx-auto max-w-2xl px-6 py-10">

        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <button onClick={() => router.back()} className="mb-1 text-sm" style={{ color: NOTION.muted }}>← Back</button>
            <h1 className="text-xl font-bold" style={{ color: NOTION.text }}>{set?.title}</h1>
            <div className="mt-1 text-sm" style={{ color: NOTION.muted }}>{cards.length} cards</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/flashcards/${setId}/jeopardy`)}
              className="rounded px-3 py-1.5 text-sm transition-colors"
              style={{ border: `1px solid ${NOTION.btnBorder}`, color: NOTION.text, backgroundColor: NOTION.btn }}>
              🏆 Jeopardy
            </button>
            <button
              onClick={() => setEditing(e => !e)}
              className="rounded px-3 py-1.5 text-sm transition-colors"
              style={{ border: `1px solid ${NOTION.btnBorder}`, color: NOTION.text, backgroundColor: editing ? NOTION.hover : NOTION.btn }}>
              {editing ? 'Done editing' : '✏️ Edit'}
            </button>
          </div>
        </div>

        {/* Edit mode */}
        {editing ? (
          <div className="space-y-3">
            {cards.map((card, i) => (
              <EditableCard
                key={card.id}
                card={card}
                index={i}
                onSave={handleSaveEdit}
                onDelete={handleDeleteCard}
                saving={saving}
              />
            ))}
            {addingCard ? (
              <div className="rounded-lg border p-4" style={{ borderColor: NOTION.border }}>
                <div className="mb-2 text-xs font-semibold uppercase" style={{ color: NOTION.muted }}>New card</div>
                <textarea
                  placeholder="Question"
                  value={newQ}
                  onChange={e => setNewQ(e.target.value)}
                  rows={2}
                  className="mb-2 w-full resize-none rounded border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: NOTION.border, color: NOTION.text }}
                />
                <textarea
                  placeholder="Answer"
                  value={newA}
                  onChange={e => setNewA(e.target.value)}
                  rows={2}
                  className="mb-3 w-full resize-none rounded border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: NOTION.border, color: NOTION.text }}
                />
                <div className="flex gap-2">
                  <button onClick={handleAddCard} disabled={saving} className="rounded px-4 py-1.5 text-sm font-medium text-white" style={{ backgroundColor: '#37352F' }}>
                    {saving ? 'Saving…' : 'Add'}
                  </button>
                  <button onClick={() => setAddingCard(false)} className="text-sm" style={{ color: NOTION.muted }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingCard(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-3 text-sm transition-colors"
                style={{ borderColor: NOTION.border, color: NOTION.muted }}>
                + Add card
              </button>
            )}
          </div>
        ) : done ? (
          /* Done screen */
          <div className="rounded-2xl border py-16 text-center" style={{ borderColor: NOTION.border }}>
            <div className="mb-4 text-5xl">🎉</div>
            <div className="mb-2 text-xl font-bold" style={{ color: NOTION.text }}>Session complete!</div>
            <div className="mb-6 text-sm" style={{ color: NOTION.muted }}>
              {mastered.size} mastered · {review.size} need review
            </div>
            <div className="flex justify-center gap-3">
              <button onClick={restart} className="rounded px-4 py-2 text-sm font-medium" style={{ border: `1px solid ${NOTION.btnBorder}`, color: NOTION.text }}>
                Restart all
              </button>
              {review.size > 0 && (
                <button onClick={restartReview} className="rounded px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: '#37352F' }}>
                  Review {review.size} cards
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Study mode */
          <div>
            {/* Progress bar */}
            <div className="mb-6">
              <div className="mb-1 flex justify-between text-xs" style={{ color: NOTION.muted }}>
                <span>{currentIndex + 1} / {cards.length}</span>
                <span>{mastered.size} mastered</span>
              </div>
              <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: NOTION.border }}>
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: '#22c55e' }} />
              </div>
            </div>

            {/* Flashcard */}
            {currentCard && (
              <div
                onClick={() => setFlipped(f => !f)}
                className="relative mb-6 cursor-pointer select-none rounded-2xl border p-10 text-center transition-all"
                style={{
                  borderColor: NOTION.border,
                  backgroundColor: flipped ? '#FAFAF9' : NOTION.bg,
                  minHeight: 240,
                }}>
                <div className="absolute right-4 top-4 text-xs" style={{ color: NOTION.muted }}>
                  {flipped ? 'Answer' : 'Question'} · click to flip
                </div>
                <div className="flex min-h-[160px] items-center justify-center">
                  <div className="w-full text-base leading-relaxed" style={{ color: NOTION.text }}>
                    {renderCardContent(flipped ? currentCard.answer : currentCard.question)}
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {flipped && (
              <div className="flex gap-3">
                <button
                  onClick={handleNeedReview}
                  className="flex-1 rounded-lg py-3 text-sm font-medium transition-colors"
                  style={{ border: `1px solid #fca5a5`, backgroundColor: '#fef2f2', color: '#dc2626' }}>
                  Need review
                </button>
                <button
                  onClick={handleGotIt}
                  className="flex-1 rounded-lg py-3 text-sm font-medium transition-colors"
                  style={{ border: `1px solid #86efac`, backgroundColor: '#f0fdf4', color: '#16a34a' }}>
                  Got it!
                </button>
              </div>
            )}
            {!flipped && (
              <div className="text-center text-sm" style={{ color: NOTION.muted }}>Click the card to reveal the answer</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EditableCard({ card, index, onSave, onDelete, saving }: {
  card: Flashcard
  index: number
  onSave: (card: Flashcard) => void
  onDelete: (id: string) => void
  saving: boolean
}) {
  const [q, setQ] = useState(card.question)
  const [a, setA] = useState(card.answer)
  const [dirty, setDirty] = useState(false)
  const [uploading, setUploading] = useState<'q' | 'a' | null>(null)
  const qImgRef = useRef<HTMLInputElement>(null)
  const aImgRef = useRef<HTMLInputElement>(null)

  const NOTION_TEXT = '#37352F'
  const NOTION_BORDER = '#EDEDED'
  const NOTION_MUTED = 'rgba(55,53,47,0.65)'

  const handleImageUpload = async (file: File, field: 'q' | 'a') => {
    setUploading(field)
    try {
      const path = `flashcard-images/${card.id}/${crypto.randomUUID()}-${file.name}`
      const { error } = await supabase.storage.from('whiteboards').upload(path, file, { contentType: file.type, upsert: true })
      if (error) { alert('Image upload failed: ' + error.message); return }
      const url = supabase.storage.from('whiteboards').getPublicUrl(path).data.publicUrl
      const tag = `\n![image](${url})`
      if (field === 'q') { setQ(prev => prev + tag); setDirty(true) }
      else { setA(prev => prev + tag); setDirty(true) }
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: NOTION_BORDER }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase" style={{ color: NOTION_MUTED }}>Card {index + 1}</span>
        <button onClick={() => onDelete(card.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs" style={{ color: NOTION_MUTED }}>Question</span>
            <button onClick={() => qImgRef.current?.click()} className="text-xs" style={{ color: NOTION_MUTED }} title="Insert image">
              {uploading === 'q' ? '…' : '🖼'}
            </button>
          </div>
          <textarea
            value={q}
            onChange={e => { setQ(e.target.value); setDirty(true) }}
            rows={3}
            className="w-full resize-none rounded border px-3 py-2 text-sm outline-none"
            style={{ borderColor: NOTION_BORDER, color: NOTION_TEXT, fontFamily: 'monospace' }}
          />
          <input ref={qImgRef} type="file" accept="image/*" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0], 'q'); e.target.value = '' }} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs" style={{ color: NOTION_MUTED }}>Answer</span>
            <button onClick={() => aImgRef.current?.click()} className="text-xs" style={{ color: NOTION_MUTED }} title="Insert image">
              {uploading === 'a' ? '…' : '🖼'}
            </button>
          </div>
          <textarea
            value={a}
            onChange={e => { setA(e.target.value); setDirty(true) }}
            rows={3}
            className="w-full resize-none rounded border px-3 py-2 text-sm outline-none"
            style={{ borderColor: NOTION_BORDER, color: NOTION_TEXT, fontFamily: 'monospace' }}
          />
          <input ref={aImgRef} type="file" accept="image/*" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0], 'a'); e.target.value = '' }} />
        </div>
      </div>
      {dirty && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => { onSave({ ...card, question: q, answer: a }); setDirty(false) }}
            disabled={saving}
            className="rounded px-3 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: '#37352F' }}>
            Save
          </button>
        </div>
      )}
    </div>
  )
}

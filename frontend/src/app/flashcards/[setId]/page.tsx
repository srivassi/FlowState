'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
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
                  <div className="text-lg leading-relaxed" style={{ color: NOTION.text }}>
                    {flipped ? currentCard.answer : currentCard.question}
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

  const NOTION_TEXT = '#37352F'
  const NOTION_BORDER = '#EDEDED'
  const NOTION_MUTED = 'rgba(55,53,47,0.65)'

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: NOTION_BORDER }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase" style={{ color: NOTION_MUTED }}>Card {index + 1}</span>
        <button onClick={() => onDelete(card.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-xs" style={{ color: NOTION_MUTED }}>Question</div>
          <textarea
            value={q}
            onChange={e => { setQ(e.target.value); setDirty(true) }}
            rows={3}
            className="w-full resize-none rounded border px-3 py-2 text-sm outline-none"
            style={{ borderColor: NOTION_BORDER, color: NOTION_TEXT }}
          />
        </div>
        <div>
          <div className="mb-1 text-xs" style={{ color: NOTION_MUTED }}>Answer</div>
          <textarea
            value={a}
            onChange={e => { setA(e.target.value); setDirty(true) }}
            rows={3}
            className="w-full resize-none rounded border px-3 py-2 text-sm outline-none"
            style={{ borderColor: NOTION_BORDER, color: NOTION_TEXT }}
          />
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

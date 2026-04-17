'use client'

export const dynamic = 'force-dynamic'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Link from 'next/link'

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/dashboard')
      } else {
        setChecking(false)
      }
    })
  }, [router])

  if (checking) return null

  return (
    <div style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", backgroundColor: '#FFFFFF', color: '#37352F', minHeight: '100vh' }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5" style={{ borderBottom: '1px solid #EDEDED', backgroundColor: '#FBFBFA' }}>
        <span className="text-lg font-bold tracking-tight">
          <span style={{ color: '#37352F' }}>Flow</span><span style={{ color: '#6366F1' }}>state</span>
        </span>
        <div className="flex items-center gap-3">
          <Link href="/auth/signin"
            className="rounded px-4 py-1.5 text-sm transition-colors"
            style={{ color: 'rgba(55,53,47,0.65)', border: '1px solid #EDEDED', backgroundColor: '#FFFFFF' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#EFEFED')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FFFFFF')}>
            Sign in
          </Link>
          <Link href="/auth/signup"
            className="rounded px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#37352F' }}>
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-8 py-24 text-center">
        <div className="mb-5 inline-block rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}>
          Built for exam season
        </div>
        <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight" style={{ color: '#37352F' }}>
          Study smarter,<br />not harder.
        </h1>
        <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed" style={{ color: 'rgba(55,53,47,0.65)' }}>
          An AI-powered study planner that builds your schedule, annotates your notes, and turns lecture PDFs into flashcards — so you can spend less time organising and more time actually learning.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/auth/signup"
            className="rounded-lg px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#37352F' }}>
            Start for free →
          </Link>
          <Link href="/auth/signin"
            className="rounded-lg px-6 py-3 text-sm font-medium transition-colors"
            style={{ color: '#37352F', border: '1px solid #EDEDED', backgroundColor: '#FFFFFF' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#FAFAF9')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FFFFFF')}>
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-4xl px-8 pb-24">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: '🗓️',
              title: 'AI Scheduler',
              desc: 'Paste your syllabus and let Claude build a day-by-day study plan around your exams and busy periods.',
            },
            {
              icon: '⏱️',
              title: 'Pomodoro Focus',
              desc: 'Work through a custom task queue with timed sessions, smart breaks, and a brain dump between rounds.',
            },
            {
              icon: '🃏',
              title: 'Auto Flashcards',
              desc: 'Upload a lecture PDF and get a full flashcard set generated in seconds — no copy-pasting.',
            },
            {
              icon: '🎨',
              title: 'AI Whiteboard',
              desc: 'Annotate your PDFs with sticky notes that open a Claude conversation thread right on the page.',
            },
            {
              icon: '🔄',
              title: 'Daily Check-in',
              desc: 'End-of-day flow adjusts tomorrow\'s plan based on what you actually got done, with overflow handling.',
            },
            {
              icon: '🏆',
              title: 'Jeopardy Mode',
              desc: 'Turn any flashcard set into a Jeopardy game to make revision actually fun.',
            },
          ].map(f => (
            <div key={f.title} className="rounded-xl border p-6" style={{ borderColor: '#EDEDED', backgroundColor: '#FBFBFA' }}>
              <div className="mb-3 text-2xl">{f.icon}</div>
              <div className="mb-2 text-sm font-semibold" style={{ color: '#37352F' }}>{f.title}</div>
              <div className="text-sm leading-relaxed" style={{ color: 'rgba(55,53,47,0.65)' }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA banner */}
      <section className="mx-8 mb-20 rounded-2xl px-10 py-14 text-center" style={{ backgroundColor: '#37352F' }}>
        <h2 className="mb-3 text-2xl font-bold text-white">Ready to get into flow?</h2>
        <p className="mb-7 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>Set up your modules in under 5 minutes.</p>
        <Link href="/auth/signup"
          className="inline-block rounded-lg px-7 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#FFFFFF', color: '#37352F' }}>
          Get started free →
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t px-8 py-6 text-center text-xs" style={{ borderColor: '#EDEDED', color: 'rgba(55,53,47,0.4)' }}>
        <span style={{ color: 'rgba(55,53,47,0.6)' }}>Flow</span><span style={{ color: '#6366F1', opacity: 0.7 }}>state</span>
      </footer>
    </div>
  )
}

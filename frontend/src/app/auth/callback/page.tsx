'use client'

export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    async function redirect(session: any) {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/onboarding/profile/${session.user.id}`)
        if (res.ok) {
          router.replace('/dashboard')
        } else {
          router.replace('/onboarding')
        }
      } catch {
        router.replace('/onboarding')
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        redirect(session)
      } else {
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
            redirect(session)
          }
        })
      }
    })
  }, [router])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <p style={{ color: '#6B7280' }}>Confirming your account…</p>
    </div>
  )
}

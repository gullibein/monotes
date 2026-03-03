'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import NoteCanvas from './note-canvas'
import Login from './login'
import { loadKeyFromSession, clearKeyFromSession } from '@/lib/crypto'
import { FileText } from 'lucide-react'

export default function AppShell() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null)
  const [keyLoaded, setKeyLoaded] = useState(false)
  const [guestMode, setGuestMode] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    loadKeyFromSession().then((key) => {
      setCryptoKey(key)
      setKeyLoaded(true)
    })
  }, [])

  if (authLoading || !keyLoaded) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <FileText size={18} className="text-primary" />
          </div>
          <p className="text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (guestMode) {
    return <NoteCanvas userId={null} onSignOut={() => setGuestMode(false)} />
  }

  if (!user || !cryptoKey) {
    return (
      <Login
        onSignedIn={(key) => setCryptoKey(key)}
        onContinueAsGuest={() => setGuestMode(true)}
      />
    )
  }

  return (
    <NoteCanvas
      userId={user.id}
      cryptoKey={cryptoKey}
      onSignOut={() => {
        clearKeyFromSession()
        setCryptoKey(null)
        supabase.auth.signOut()
      }}
    />
  )
}

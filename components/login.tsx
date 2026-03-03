'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { deriveKey, saveKeyToSession } from '@/lib/crypto'

export default function Login({
  onSignedIn,
  onContinueAsGuest,
}: {
  onSignedIn: (key: CryptoKey) => void
  onContinueAsGuest: () => void
}) {
  const [mode, setMode] = useState<'signin' | 'create'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setError('')
    if (!email.trim() || !password) return
    if (mode === 'create' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'create') {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
      const key = await deriveKey(password, email.trim())
      await saveKeyToSession(key)
      onSignedIn(key)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Authentication failed.')
      setLoading(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20'

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-8 shadow-xl shadow-black/10">
        {/* Logo */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <FileText size={22} className="text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">FloNotes</h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'signin' ? 'Sign in to access your notes' : 'Create an account'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className={inputClass}
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className={inputClass}
          />
          {mode === 'create' && (
            <input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className={inputClass}
            />
          )}
          <button
            onClick={handleSubmit}
            disabled={loading || !email.trim() || !password}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
          >
            {loading
              ? mode === 'create' ? 'Creating account…' : 'Signing in…'
              : mode === 'create' ? 'Create account' : 'Sign in'}
          </button>
        </div>

        {error && <p className="mt-3 text-center text-xs text-red-500">{error}</p>}

        <div className="mt-4 text-center">
          {mode === 'signin' ? (
            <button
              onClick={() => { setMode('create'); setError('') }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              No account? Create one
            </button>
          ) : (
            <button
              onClick={() => { setMode('signin'); setError(''); setConfirmPassword('') }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Already have an account? Sign in
            </button>
          )}
        </div>

        <div className="mt-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <button
            onClick={onContinueAsGuest}
            className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Continue without signing in
          </button>
          <p className="mt-2.5 text-center text-xs text-muted-foreground/70">
            Notes will not be saved if you continue without signing in
          </p>
        </div>
      </div>
    </div>
  )
}

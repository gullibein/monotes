'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { db } from '@/lib/db'

export default function Login({ onContinueAsGuest }: { onContinueAsGuest: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentEmail, setSentEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const sendCode = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await db.auth.sendMagicCode({ email: email.trim() })
      setSentEmail(email.trim())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send code.')
    } finally {
      setLoading(false)
    }
  }

  const signIn = async () => {
    if (!code.trim()) return
    setLoading(true)
    setError('')
    try {
      await db.auth.signInWithMagicCode({ email: sentEmail, code: code.trim() })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid code. Please try again.')
      setLoading(false)
    }
  }

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
            <p className="text-sm text-muted-foreground">Sign in to access your notes</p>
          </div>
        </div>

        {!sentEmail ? (
          /* Step 1 — enter email */
          <div className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendCode()}
              className="w-full rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            <button
              onClick={sendCode}
              disabled={loading || !email.trim()}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send sign-in code'}
            </button>
          </div>
        ) : (
          /* Step 2 — enter code */
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-muted-foreground">
              We sent a 6-digit code to <span className="font-medium text-foreground">{sentEmail}</span>
            </p>
            <input
              type="text"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && signIn()}
              className="w-full rounded-lg border border-border bg-secondary px-4 py-2.5 text-center text-sm tracking-widest text-foreground placeholder:tracking-normal placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
              maxLength={6}
            />
            <button
              onClick={signIn}
              disabled={loading || !code.trim()}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              onClick={() => { setSentEmail(''); setCode(''); setError('') }}
              className="text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 text-center text-xs text-red-500">{error}</p>
        )}

        {!sentEmail && (
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
        )}
      </div>
    </div>
  )
}

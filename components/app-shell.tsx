'use client'

import { db } from '@/lib/db'
import NoteCanvas from './note-canvas'
import Login from './login'
import { FileText } from 'lucide-react'

export default function AppShell() {
  const { isLoading, user } = db.useAuth()

  if (isLoading) {
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

  if (!user) return <Login />

  return <NoteCanvas userId={user.id} />
}

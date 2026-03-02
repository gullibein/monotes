'use client'

import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { id as instantId } from '@instantdb/react'
import NotepadWindow from '@/components/notepad-window'
import CanvasControls from '@/components/canvas-controls'
import { db } from '@/lib/db'
import { type Note, type Workspace, createNote, createNoteAt, getNextZIndex } from '@/lib/notes-store'

const MIN_SCALE = 0.15
const MAX_SCALE = 2
const ZOOM_STEP = 0.1
const ZOOM_TO_NOTE_SCALE = 1.0
const SAVE_DEBOUNCE_MS = 1500

export default function NoteCanvas({ userId }: { userId: string }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([
    { id: 'ws-1', name: 'Workspace 1', notes: [] },
  ])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('ws-1')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const [latestNoteId, setLatestNoteId] = useState<string | null>(null)
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const focusedNoteIdRef = useRef<string | null>(null)
  focusedNoteIdRef.current = focusedNoteId
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number | null>(null)

  // ── InstantDB persistence ─────────────────────────────────────────────────

  // Track the DB record id once it's known
  const dbRecordId = useRef<string | null>(null)
  // True once we've applied (or skipped) the initial DB load
  const dbInitialized = useRef(false)

  const { data: dbData, isLoading: dbLoading } = db.useQuery({
    userState: { $: { where: { userId } } },
  })

  // Load saved state once when DB data first arrives
  useEffect(() => {
    if (dbLoading || dbInitialized.current) return
    dbInitialized.current = true

    const saved = dbData?.userState?.[0]
    if (saved?.workspaces?.length) {
      dbRecordId.current = saved.id
      setWorkspaces(saved.workspaces)
      setActiveWorkspaceId(saved.activeWorkspaceId ?? saved.workspaces[0].id)
    } else {
      // No saved data — create the default first note (client-side to avoid SSR UUID mismatch)
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === 'ws-1' ? { ...w, notes: [createNote(0)] } : w))
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbLoading, dbData])

  // Debounced save — writes 1.5 s after the last change to workspaces or activeWorkspaceId
  useEffect(() => {
    if (!dbInitialized.current) return
    const stateId = dbRecordId.current ?? (() => {
      const newId = instantId()
      dbRecordId.current = newId
      return newId
    })()
    const timeout = setTimeout(() => {
      db.transact(
        db.tx.userState[stateId].update({
          userId,
          workspaces,
          activeWorkspaceId,
          savedAt: Date.now(),
        })
      )
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [workspaces, activeWorkspaceId, userId])

  // ── Derived state ─────────────────────────────────────────────────────────

  const notes = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId)?.notes ?? [],
    [workspaces, activeWorkspaceId]
  )
  const notesRef = useRef(notes)
  notesRef.current = notes

  const setNotes = useCallback(
    (updater: Note[] | ((prev: Note[]) => Note[])) => {
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === activeWorkspaceId
            ? { ...w, notes: typeof updater === 'function' ? updater(w.notes) : updater }
            : w
        )
      )
    },
    [activeWorkspaceId]
  )

  // ── Note CRUD ────────────────────────────────────────────────────────────

  const addNote = useCallback(() => {
    const newNote = createNote(notes.length)
    setNotes((prev) => [...prev, newNote])
    setLatestNoteId(newNote.id)
    setFocusedNoteId(newNote.id)
  }, [setNotes, notes.length])

  const addNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvasX = (clientX - offset.x) / scale
      const canvasY = (clientY - offset.y) / scale
      const newNote = createNoteAt(canvasX, canvasY, notes.length)
      setNotes((prev) => [...prev, newNote])
      setLatestNoteId(newNote.id)
      setFocusedNoteId(newNote.id)
    },
    [offset, scale, setNotes, notes.length]
  )

  const updateNote = useCallback(
    (noteId: string, updates: Partial<Note>) => {
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, ...updates } : n)))
    },
    [setNotes]
  )

  const closeNote = useCallback(
    (noteId: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    },
    [setNotes]
  )

  const duplicateNote = useCallback(
    (noteId: string) => {
      const newId = crypto.randomUUID()
      setNotes((prev) => {
        const original = prev.find((n) => n.id === noteId)
        if (!original) return prev
        return [
          ...prev,
          {
            ...original,
            id: newId,
            x: original.x + 30,
            y: original.y + 30,
            zIndex: getNextZIndex(),
            createdAt: Date.now(),
          },
        ]
      })
      setLatestNoteId(newId)
      setFocusedNoteId(newId)
    },
    [setNotes]
  )

  const focusNote = useCallback(
    (noteId: string) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, zIndex: getNextZIndex() } : n))
      )
      setFocusedNoteId(noteId)
    },
    [setNotes]
  )

  // ── Workspace operations ─────────────────────────────────────────────────

  const addWorkspace = useCallback(() => {
    const newId = `ws-${Date.now()}`
    const newName = `Workspace ${workspaces.length + 1}`
    setWorkspaces((prev) => [
      ...prev,
      { id: newId, name: newName, notes: [createNote(0)] },
    ])
    setActiveWorkspaceId(newId)
  }, [workspaces.length])

  const renameWorkspace = useCallback((wsId: string, name: string) => {
    setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? { ...w, name } : w)))
  }, [])

  const deleteWorkspace = useCallback((wsId: string) => {
    setWorkspaces((prev) => {
      if (prev.length <= 1) return prev // never delete the last workspace
      const next = prev.filter((w) => w.id !== wsId)
      setActiveWorkspaceId((cur) => (cur === wsId ? next[0].id : cur))
      return next
    })
  }, [])

  const switchWorkspace = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId)
    setLatestNoteId(null)
  }, [])

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => {
      if (!prev && !focusedNoteIdRef.current && notesRef.current.length > 0) {
        focusNote(notesRef.current[0].id)
      }
      return !prev
    })
  }, [focusNote])

  // ── Viewport animation ───────────────────────────────────────────────────

  const animateToViewRef = useRef<(s: number, o: { x: number; y: number }, d?: number) => void>(() => {})
  const animateToView = useCallback(
    (targetScale: number, targetOffset: { x: number; y: number }, duration = 400) => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      const startScale = scale
      const startOffset = { ...offset }
      const startTime = performance.now()
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
      const step = (now: number) => {
        const elapsed = now - startTime
        const progress = Math.min(elapsed / duration, 1)
        const eased = easeOutCubic(progress)
        setScale(startScale + (targetScale - startScale) * eased)
        setOffset({
          x: startOffset.x + (targetOffset.x - startOffset.x) * eased,
          y: startOffset.y + (targetOffset.y - startOffset.y) * eased,
        })
        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(step)
        } else {
          animFrameRef.current = null
        }
      }
      animFrameRef.current = requestAnimationFrame(step)
    },
    [scale, offset]
  )
  animateToViewRef.current = animateToView

  const zoomToNote = useCallback(
    (noteId: string) => {
      const note = notes.find((n) => n.id === noteId)
      if (!note) return
      const targetScale = isFocusMode ? FOCUS_SCALE : ZOOM_TO_NOTE_SCALE
      const vw = window.innerWidth
      const vh = window.innerHeight
      const noteCenterX = note.x + note.width / 2
      const noteCenterY = note.y + note.height / 2
      animateToView(targetScale, {
        x: vw / 2 - noteCenterX * targetScale,
        y: vh / 2 - noteCenterY * targetScale,
      })
    },
    [notes, animateToView, isFocusMode]
  )

  const zoomIn = useCallback(() => setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP)), [])
  const zoomOut = useCallback(() => setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP)), [])

  const zoomReset = useCallback(() => {
    animateToView(1, { x: 0, y: 0 })
  }, [animateToView])

  const zoomToCenter = useCallback(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const canvasCenterX = (vw / 2 - offset.x) / scale
    const canvasCenterY = (vh / 2 - offset.y) / scale
    animateToView(1, { x: vw / 2 - canvasCenterX, y: vh / 2 - canvasCenterY })
  }, [animateToView, offset, scale])

  const zoomFit = useCallback(() => {
    if (notes.length === 0) { zoomReset(); return }
    const padding = 100
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const note of notes) {
      minX = Math.min(minX, note.x); minY = Math.min(minY, note.y)
      maxX = Math.max(maxX, note.x + note.width)
      maxY = Math.max(maxY, note.y + note.height)
    }
    const contentWidth = maxX - minX + padding * 2
    const contentHeight = maxY - minY + padding * 2
    const vw = window.innerWidth
    const vh = window.innerHeight - 96
    const newScale = Math.max(MIN_SCALE, Math.min(1, Math.min(vw / contentWidth, vh / contentHeight)))
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    animateToView(newScale, {
      x: vw / 2 - centerX * newScale,
      y: (vh + 96) / 2 - centerY * newScale,
    })
  }, [notes, zoomReset, animateToView])

  // ── Focus mode ───────────────────────────────────────────────────────────

  const FOCUS_SCALE = 1.2

  // Zoom to the focused note whenever it changes while focus mode is active,
  // or when focus mode is turned on.
  useEffect(() => {
    if (!isFocusMode || !focusedNoteId) return
    const note = notesRef.current.find((n) => n.id === focusedNoteId)
    if (!note) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cx = note.x + note.width / 2
    const cy = note.y + note.height / 2
    animateToViewRef.current(FOCUS_SCALE, {
      x: vw / 2 - cx * FOCUS_SCALE,
      y: vh / 2 - cy * FOCUS_SCALE,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedNoteId, isFocusMode])

  // TAB / Shift-TAB cycles through notes in focus mode.
  useEffect(() => {
    if (!isFocusMode) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return
      e.preventDefault()
      setNotes((prev) => {
        const sorted = [...prev].sort((a, b) => a.x - b.x || a.y - b.y)
        const currentIdx = sorted.findIndex((n) => n.id === focusedNoteIdRef.current)
        const dir = e.shiftKey ? -1 : 1
        const idx = ((currentIdx === -1 ? 0 : currentIdx) + dir + sorted.length) % sorted.length
        const next = sorted[idx]
        if (next) setFocusedNoteId(next.id)
        return next ? prev.map((n) => (n.id === next.id ? { ...n, zIndex: getNextZIndex() } : n)) : prev
      })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocusMode, setNotes])

  // ── Mouse wheel zoom ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return
      e.preventDefault()
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleRef.current + delta))
      const scaleRatio = newScale / scaleRef.current
      setScale(newScale)
      setOffset((prev) => ({ x: mouseX - (mouseX - prev.x) * scaleRatio, y: mouseY - (mouseY - prev.y) * scaleRatio }))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  // Re-run when dbLoading changes: the canvas div doesn't exist while loading,
  // so this is the trigger that attaches the listener once the canvas mounts.
  // scaleRef + functional setOffset keep the handler fresh without needing scale/offset as deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbLoading])

  // ── Canvas panning ───────────────────────────────────────────────────────

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== canvasRef.current && e.target !== canvasRef.current?.firstChild) return
      if (e.button === 1 || e.button === 0) {
        if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
        isPanning.current = true
        panStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
        e.preventDefault()
      }
    },
    [offset]
  )

  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== canvasRef.current && e.target !== canvasRef.current?.firstChild) return
      addNoteAt(e.clientX, e.clientY)
    },
    [addNoteAt]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isPanning.current) setOffset({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y })
    }
    const handleMouseUp = () => { isPanning.current = false }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  useEffect(() => {
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current) }
  }, [])

  // ── Loading state ─────────────────────────────────────────────────────────

  if (dbLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas">
        <p className="text-sm text-muted-foreground">Loading your notes…</p>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern
            id="dot-grid"
            x={offset.x % (24 * scale)} y={offset.y % (24 * scale)}
            width={24 * scale} height={24 * scale}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={1} cy={1} r={1} className="fill-canvas-dot" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
      </svg>

      <div
        ref={canvasRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onMouseDown={handleCanvasMouseDown}
        onDoubleClick={handleCanvasDoubleClick}
      >
        <div
          className="origin-top-left"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, width: '10000px', height: '10000px' }}
        >
          {notes.map((note) => (
            <NotepadWindow
              key={note.id}
              note={note}
              onUpdate={updateNote}
              onClose={closeNote}
              onFocus={focusNote}
              onZoomToNote={zoomToNote}
              onDuplicate={duplicateNote}
              scale={scale}
              allNotes={notes}
              canvasOffset={offset}
              autoFocus={note.id === latestNoteId}
              isFocused={note.id === focusedNoteId}
              isFocusMode={isFocusMode}
            />
          ))}
        </div>
      </div>

      {notes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-lg font-medium text-muted-foreground/50">No notes yet</p>
            <p className="text-sm text-muted-foreground/30">{'Double-click anywhere or click "New Note" to get started'}</p>
          </div>
        </div>
      )}

      <CanvasControls
        scale={scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomFit={zoomFit}
        onZoomReset={zoomReset}
        onZoomToCenter={zoomToCenter}
        onAddNote={addNote}
        noteCount={notes.length}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSwitchWorkspace={switchWorkspace}
        onAddWorkspace={addWorkspace}
        onRenameWorkspace={renameWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onSignOut={() => db.auth.signOut()}
        isFocusMode={isFocusMode}
        onToggleFocusMode={toggleFocusMode}
      />
    </div>
  )
}

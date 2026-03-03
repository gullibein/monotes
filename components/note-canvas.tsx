'use client'

import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { id as instantId } from '@instantdb/react'
import NotepadWindow from '@/components/notepad-window'
import CanvasControls from '@/components/canvas-controls'
import ConfirmDialog from '@/components/confirm-dialog'
import { db } from '@/lib/db'
import { type Note, type Workspace, createNote, createNoteAt, getNextZIndex, initZIndexCounter } from '@/lib/notes-store'
import { encryptText, decryptText } from '@/lib/crypto'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

const MIN_SCALE = 0.15
const MAX_SCALE = 2
const ZOOM_STEP = 0.1
const ZOOM_TO_NOTE_SCALE = 1.0
const SAVE_DEBOUNCE_MS = 1500

export default function NoteCanvas({
  userId,
  cryptoKey = null,
  onSignOut,
}: {
  userId: string | null
  cryptoKey?: CryptoKey | null
  onSignOut?: () => void
}) {
  const isGuest = userId === null
  const cryptoKeyRef = useRef(cryptoKey)
  cryptoKeyRef.current = cryptoKey

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
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [copiedNote, setCopiedNote] = useState<Note | null>(null)
  const contextMenuPosRef = useRef({ x: 0, y: 0 })
  const focusedNoteIdRef = useRef<string | null>(null)
  focusedNoteIdRef.current = focusedNoteId
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number | null>(null)

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  type UndoSnapshot = { workspaces: Workspace[]; activeWorkspaceId: string }
  const undoStack = useRef<UndoSnapshot[]>([])
  const redoStack = useRef<UndoSnapshot[]>([])
  const [undoRevision, setUndoRevision] = useState(0)
  const preTypingSnapshotRef = useRef<UndoSnapshot | null>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── InstantDB persistence ─────────────────────────────────────────────────

  // Track the DB record id once it's known
  const dbRecordId = useRef<string | null>(null)
  // True once we've applied (or skipped) the initial DB load
  const dbInitialized = useRef(false)
  // Set to true when saved data is loaded; triggers a one-time auto-fit
  const pendingAutoFit = useRef(false)

  const { data: dbData, isLoading: dbLoading } = db.useQuery(
    isGuest ? null : { userState: { $: { where: { userId: userId! } } } }
  )

  // Load saved state once when DB data first arrives
  useEffect(() => {
    if (dbInitialized.current) return
    if (isGuest) { dbInitialized.current = true; return }
    if (dbLoading) return
    dbInitialized.current = true

    const saved = dbData?.userState?.[0]
    if (!saved) return

    ;(async () => {
      let workspacesToLoad: Workspace[] | null = null
      let activeIdToLoad: string | null = null

      if (saved.encryptedData && cryptoKeyRef.current) {
        try {
          const decrypted = await decryptText(cryptoKeyRef.current, saved.encryptedData as string)
          const parsed = JSON.parse(decrypted) as { workspaces: Workspace[]; activeWorkspaceId: string }
          workspacesToLoad = parsed.workspaces
          activeIdToLoad = parsed.activeWorkspaceId
        } catch {
          // Decryption failed — start with empty state
        }
      }

      if (workspacesToLoad?.length) {
        dbRecordId.current = saved.id
        setWorkspaces(workspacesToLoad)
        setActiveWorkspaceId(activeIdToLoad ?? workspacesToLoad[0].id)
        pendingAutoFit.current = true
        // Seed the z-index counter so new selections always stack above saved notes
        const maxZ = workspacesToLoad
          .flatMap((w: Workspace) => w.notes.map((n: Note) => n.zIndex ?? 0))
          .reduce((a: number, b: number) => Math.max(a, b), 0)
        initZIndexCounter(maxZ)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbLoading, dbData])

  // Debounced save — writes 1.5 s after the last change to workspaces or activeWorkspaceId
  useEffect(() => {
    if (isGuest || !dbInitialized.current) return
    const stateId = dbRecordId.current ?? (() => {
      const newId = instantId()
      dbRecordId.current = newId
      return newId
    })()
    const timeout = setTimeout(async () => {
      const key = cryptoKeyRef.current
      if (!key) return
      const encryptedData = await encryptText(key, JSON.stringify({ workspaces, activeWorkspaceId }))
      db.transact(
        db.tx.userState[stateId].update({
          userId,
          encryptedData,
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

  // ── Undo helpers (stable — only use refs) ────────────────────────────────

  const scheduleTypingSnapshot = useCallback(() => {
    if (!preTypingSnapshotRef.current) {
      preTypingSnapshotRef.current = {
        workspaces: workspacesRef.current,
        activeWorkspaceId: activeWorkspaceIdRef.current,
      }
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null
      if (preTypingSnapshotRef.current) {
        undoStack.current.push(preTypingSnapshotRef.current)
        preTypingSnapshotRef.current = null
        redoStack.current = []
      }
    }, 1000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pushUndoSnapshot = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
    if (preTypingSnapshotRef.current) {
      undoStack.current.push(preTypingSnapshotRef.current)
      preTypingSnapshotRef.current = null
    }
    undoStack.current.push({
      workspaces: workspacesRef.current,
      activeWorkspaceId: activeWorkspaceIdRef.current,
    })
    redoStack.current = []
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Note CRUD ────────────────────────────────────────────────────────────

  const addNote = useCallback(() => {
    pushUndoSnapshot()
    const newNote = createNote(notes.length)
    setNotes((prev) => [...prev, newNote])
    setLatestNoteId(newNote.id)
    setFocusedNoteId(newNote.id)
  }, [setNotes, notes.length, pushUndoSnapshot])

  const addNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      pushUndoSnapshot()
      const canvasX = (clientX - offset.x) / scale
      const canvasY = (clientY - offset.y) / scale
      const newNote = createNoteAt(canvasX, canvasY, notes.length)
      setNotes((prev) => [...prev, newNote])
      setLatestNoteId(newNote.id)
      setFocusedNoteId(newNote.id)
    },
    [offset, scale, setNotes, notes.length, pushUndoSnapshot]
  )

  const updateNote = useCallback(
    (noteId: string, updates: Partial<Note>) => {
      if ('content' in updates) scheduleTypingSnapshot()
      if ('title' in updates) pushUndoSnapshot()
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, ...updates } : n)))
    },
    [setNotes, scheduleTypingSnapshot, pushUndoSnapshot]
  )

  const closeNote = useCallback(
    (noteId: string) => {
      pushUndoSnapshot()
      const wasSelected = focusedNoteIdRef.current === noteId
      setNotes((prev) => {
        const remaining = prev.filter((n) => n.id !== noteId)
        if (wasSelected) {
          if (remaining.length > 0) {
            const historyNext = selectionHistoryRef.current.find((id) =>
              remaining.some((n) => n.id === id)
            )
            const nextId =
              historyNext ?? [...remaining].sort((a, b) => a.x - b.x || a.y - b.y)[0].id
            setFocusedNoteId(nextId)
          } else {
            setFocusedNoteId(null)
          }
        }
        return remaining
      })
      selectionHistoryRef.current = selectionHistoryRef.current.filter((id) => id !== noteId)
    },
    [setNotes, pushUndoSnapshot]
  )

  const duplicateNote = useCallback(
    (noteId: string) => {
      pushUndoSnapshot()
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
    [setNotes, pushUndoSnapshot]
  )

  const copyNote = useCallback(
    (noteId: string) => {
      const note = notes.find((n) => n.id === noteId)
      if (note) setCopiedNote(note)
    },
    [notes]
  )

  const pasteNote = useCallback(() => {
    if (!copiedNote) return
    pushUndoSnapshot()
    const { x: cx, y: cy } = contextMenuPosRef.current
    const newId = crypto.randomUUID()
    const newNote: Note = {
      ...copiedNote,
      id: newId,
      x: (cx - offset.x) / scale - copiedNote.width / 2,
      y: (cy - offset.y) / scale - copiedNote.height / 2,
      zIndex: getNextZIndex(),
      createdAt: Date.now(),
    }
    setNotes((prev) => [...prev, newNote])
    setLatestNoteId(newId)
    setFocusedNoteId(newId)
  }, [copiedNote, offset, scale, setNotes, pushUndoSnapshot])

  const selectionHistoryRef = useRef<string[]>([])

  const focusNote = useCallback(
    (noteId: string) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, zIndex: getNextZIndex() } : n))
      )
      setFocusedNoteId((prev) => {
        if (prev && prev !== noteId) {
          selectionHistoryRef.current = [
            prev,
            ...selectionHistoryRef.current.filter((id) => id !== prev),
          ].slice(0, 20)
        }
        return noteId
      })
    },
    [setNotes]
  )

  // ── Workspace operations ─────────────────────────────────────────────────

  const addWorkspace = useCallback(() => {
    pushUndoSnapshot()
    const newId = `ws-${Date.now()}`
    const newName = `Workspace ${workspaces.length + 1}`
    setWorkspaces((prev) => [
      ...prev,
      { id: newId, name: newName, notes: [] },
    ])
    setActiveWorkspaceId(newId)
  }, [workspaces.length, pushUndoSnapshot])

  const renameWorkspace = useCallback((wsId: string, name: string) => {
    setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? { ...w, name } : w)))
  }, [])

  const deleteWorkspace = useCallback((wsId: string) => {
    const ws = workspaces.find((w) => w.id === wsId)
    if (!ws) return
    const isEmpty = ws.notes.length === 0
    const isLast = workspaces.length <= 1

    if (isLast) {
      if (isEmpty) return
      setDeleteConfirm({
        message: 'Delete this workspace?',
        onConfirm: () => {
          pushUndoSnapshot()
          setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? { ...w, notes: [] } : w)))
          setDeleteConfirm(null)
        },
      })
      return
    }

    if (isEmpty) {
      pushUndoSnapshot()
      setWorkspaces((prev) => {
        const next = prev.filter((w) => w.id !== wsId)
        setActiveWorkspaceId((cur) => (cur === wsId ? next[0].id : cur))
        return next
      })
      return
    }

    setDeleteConfirm({
      message: 'Delete this workspace?',
      onConfirm: () => {
        pushUndoSnapshot()
        setWorkspaces((prev) => {
          const next = prev.filter((w) => w.id !== wsId)
          setActiveWorkspaceId((cur) => (cur === wsId ? next[0].id : cur))
          return next
        })
        setDeleteConfirm(null)
      },
    })
  }, [workspaces, pushUndoSnapshot])

  const switchWorkspace = useCallback((wsId: string) => {
    setActiveWorkspaceId(wsId)
    setLatestNoteId(null)
  }, [])

  const undo = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
      if (preTypingSnapshotRef.current) {
        undoStack.current.push(preTypingSnapshotRef.current)
        preTypingSnapshotRef.current = null
      }
    }
    if (undoStack.current.length === 0) return
    redoStack.current.push({
      workspaces: workspacesRef.current,
      activeWorkspaceId: activeWorkspaceIdRef.current,
    })
    const snapshot = undoStack.current.pop()!
    setWorkspaces(snapshot.workspaces)
    setActiveWorkspaceId(snapshot.activeWorkspaceId)
    setFocusedNoteId(null)
    setUndoRevision((r) => r + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return
    undoStack.current.push({
      workspaces: workspacesRef.current,
      activeWorkspaceId: activeWorkspaceIdRef.current,
    })
    const snapshot = redoStack.current.pop()!
    setWorkspaces(snapshot.workspaces)
    setActiveWorkspaceId(snapshot.activeWorkspaceId)
    setFocusedNoteId(null)
    setUndoRevision((r) => r + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      } else if (e.key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

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

  // Auto-fit once after saved notes are restored from the DB.
  // pendingAutoFit is set by the DB load effect; this fires on the next
  // render after notes have been populated from the restored workspaces.
  const zoomFitRef = useRef(zoomFit)
  zoomFitRef.current = zoomFit
  useEffect(() => {
    if (!pendingAutoFit.current || notes.length === 0) return
    pendingAutoFit.current = false
    zoomFitRef.current()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes])

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

  if (!isGuest && dbLoading) {
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

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={canvasRef}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            onMouseDown={handleCanvasMouseDown}
            onDoubleClick={handleCanvasDoubleClick}
            onContextMenu={(e) => { contextMenuPosRef.current = { x: e.clientX, y: e.clientY } }}
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
                  onCopy={copyNote}
                  onDragStart={pushUndoSnapshot}
                  onResizeStart={pushUndoSnapshot}
                  scale={scale}
                  allNotes={notes}
                  canvasOffset={offset}
                  autoFocus={note.id === latestNoteId}
                  isFocused={note.id === focusedNoteId}
                  isFocusMode={isFocusMode}
                  undoRevision={undoRevision}
                />
              ))}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => addNoteAt(contextMenuPosRef.current.x, contextMenuPosRef.current.y)}>
            New note
          </ContextMenuItem>
          <ContextMenuItem onSelect={pasteNote} disabled={!copiedNote}>
            Paste note
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={zoomFit} disabled={notes.length === 0}>
            Fit to view
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

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
        onZoomToCenter={zoomToCenter}
        onAddNote={addNote}
        noteCount={notes.length}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSwitchWorkspace={switchWorkspace}
        onAddWorkspace={addWorkspace}
        onRenameWorkspace={renameWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        isGuest={isGuest}
        onSignOut={onSignOut ?? (() => {})}
        isFocusMode={isFocusMode}
        onToggleFocusMode={toggleFocusMode}
      />

      {deleteConfirm && (
        <ConfirmDialog
          message={deleteConfirm.message}
          onConfirm={deleteConfirm.onConfirm}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}

'use client'

import { useCallback, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ConfirmDialog from '@/components/confirm-dialog'
import {
  Bold,
  Italic,
  Underline,
  X,
  Check,
  Minus,
  Maximize2,
  type LucideIcon,
} from 'lucide-react'
import { type Note, NOTE_COLORS } from '@/lib/notes-store'

const SNAP_PX = 12 // screen-pixel snap radius

function snapToGrid(
  rawX: number, rawY: number,
  noteId: string, noteW: number, noteH: number,
  allNotes: Note[], scale: number, offset: { x: number; y: number }
): { x: number; y: number } {
  const threshold = SNAP_PX / scale
  let x = rawX, y = rawY
  let minDx = threshold + 1, minDy = threshold + 1

  const vw = window.innerWidth
  const vh = window.innerHeight
  // Viewport edges (always snap to these)
  const xViewport = [-offset.x / scale, (vw - offset.x) / scale - noteW]
  const yViewport = [(57 - offset.y) / scale, (vh - offset.y) / scale - noteH]

  for (const tx of xViewport) {
    const d = Math.abs(rawX - tx)
    if (d < minDx) { minDx = d; x = tx }
  }
  for (const ty of yViewport) {
    const d = Math.abs(rawY - ty)
    if (d < minDy) { minDy = d; y = ty }
  }

  for (const other of allNotes) {
    if (other.id === noteId) continue
    const ow = other.width, oh = other.height

    // Does the dragged note overlap (or nearly overlap) the other note in X?
    // Used to gate Y touch-snaps (top/bottom edges) — no phantom rows far to the side.
    const xOverlap = rawX + noteW > other.x - threshold && rawX < other.x + ow + threshold

    // Does the dragged note overlap (or nearly overlap) the other note in Y?
    // Used to gate X touch-snaps (left/right edges) — no phantom columns far above/below.
    const yOverlap = rawY + noteH > other.y - threshold && rawY < other.y + oh + threshold

    // Is the dragged note near a horizontal touch-snap position?
    // Used to gate Y alignment snaps.
    const nearXEdge =
      Math.abs(rawX - (other.x - noteW)) < threshold ||
      Math.abs(rawX - (other.x + ow)) < threshold

    // Is the dragged note near a vertical touch-snap position?
    // Used to gate X alignment snaps.
    const nearYEdge =
      Math.abs(rawY - (other.y - noteH)) < threshold ||
      Math.abs(rawY - (other.y + oh)) < threshold

    // X snaps: touch left/right only when Y-overlapping; alignment only when near a Y edge
    const xSnaps: number[] = []
    if (yOverlap) xSnaps.push(other.x - noteW, other.x + ow)
    if (nearYEdge) xSnaps.push(other.x, other.x + ow - noteW)

    // Y snaps: touch top/bottom only when X-overlapping; alignment only when near an X edge
    const ySnaps: number[] = []
    if (xOverlap) ySnaps.push(other.y - noteH, other.y + oh)
    if (nearXEdge) ySnaps.push(other.y, other.y + oh - noteH)

    for (const tx of xSnaps) {
      const d = Math.abs(rawX - tx)
      if (d < minDx) { minDx = d; x = tx }
    }
    for (const ty of ySnaps) {
      const d = Math.abs(rawY - ty)
      if (d < minDy) { minDy = d; y = ty }
    }
  }

  return { x, y }
}
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface ResizePartner {
  id: string
  origX: number
  origY: number
  origWidth: number
  origHeight: number
}

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

const OVERVIEW_THRESHOLD_PCT = 50

interface NotepadWindowProps {
  note: Note
  onUpdate: (id: string, updates: Partial<Note>) => void
  onClose: (id: string) => void
  onFocus: (id: string) => void
  onZoomToNote: (id: string) => void
  onDuplicate: (id: string) => void
  onCopy: (id: string) => void
  onDragStart?: () => void
  onResizeStart?: () => void
  scale: number
  allNotes: Note[]
  canvasOffset: { x: number; y: number }
  autoFocus?: boolean
  isFocused?: boolean
  isFocusMode?: boolean
  undoRevision?: number
}

function ToolbarButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active?: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      aria-label={label}
      className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-note-foreground/50 hover:bg-note-foreground/5 hover:text-note-foreground/80'
      }`}
    >
      <Icon size={15} strokeWidth={active ? 2.5 : 2} />
    </button>
  )
}

export default function NotepadWindow({
  note,
  onUpdate,
  onClose,
  onFocus,
  onZoomToNote,
  onDuplicate,
  onCopy,
  onDragStart,
  onResizeStart,
  scale,
  allNotes,
  canvasOffset,
  autoFocus = false,
  isFocused = false,
  isFocusMode = false,
  undoRevision = 0,
}: NotepadWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const hasDragged = useRef(false)
  // Deferred undo snapshot: pushed on first mousemove, not on mousedown,
  // so plain clicks on the title bar / body don't create undo entries.
  const actionSnapshotPushedRef = useRef(false)
  const onDragStartRef = useRef(onDragStart)
  onDragStartRef.current = onDragStart
  const onResizeStartRef = useRef(onResizeStart)
  onResizeStartRef.current = onResizeStart
  // Keep latest values accessible inside stale drag useEffect closure
  const allNotesRef = useRef(allNotes)
  allNotesRef.current = allNotes
  const canvasOffsetRef = useRef(canvasOffset)
  canvasOffsetRef.current = canvasOffset
  const isResizing = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const resizeStart = useRef<{
    noteX: number; noteY: number; width: number; height: number
    clientX: number; clientY: number
    direction: ResizeDirection
    eastPartners: ResizePartner[]; westPartners: ResizePartner[]
    southPartners: ResizePartner[]; northPartners: ResizePartner[]
  }>({
    noteX: 0, noteY: 0, width: 0, height: 0,
    clientX: 0, clientY: 0, direction: 'se',
    eastPartners: [], westPartners: [], southPartners: [], northPartners: [],
  })
  const [isMaximized, setIsMaximized] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [preMaxState, setPreMaxState] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const editorRef = useRef<HTMLDivElement>(null)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  // True only after the rename input has actually received focus.
  // Prevents spurious blur events fired by Radix UI's focus-restoration
  // (when the context menu closes) from immediately closing the rename field.
  const inputHadFocusRef = useRef(false)
  const [isHovered, setIsHovered] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  // Captures isFocused at mousedown so onClick can test the pre-click state.
  // Without this, React re-renders between mousedown and click, making isFocused
  // always appear true by the time onClick fires.
  const wasFocusedRef = useRef(false)

  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderlined, setIsUnderlined] = useState(false)
  const [currentFontSize, setCurrentFontSize] = useState(14)

  const isOverview = Math.round(scale * 100) <= OVERVIEW_THRESHOLD_PCT

  const updateFormattingState = useCallback(() => {
    setIsBold(document.queryCommandState('bold'))
    setIsItalic(document.queryCommandState('italic'))
    setIsUnderlined(document.queryCommandState('underline'))
    const size = document.queryCommandValue('fontSize')
    if (size) {
      const sizeMap: Record<string, number> = {
        '1': 10, '2': 12, '3': 14, '4': 16, '5': 18, '6': 24, '7': 32,
      }
      setCurrentFontSize(sizeMap[size] || 14)
    }
  }, [])

  useEffect(() => {
    const handleSelectionChange = () => {
      if (!editorRef.current) return
      const sel = window.getSelection()
      if (sel && editorRef.current.contains(sel.anchorNode)) {
        updateFormattingState()
      }
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [updateFormattingState])

  useEffect(() => {
    if (!isEditingTitle) return
    // Defer focus/select so the context menu fully closes first — if we run
    // synchronously the context menu steals focus back and clears the selection.
    const id = setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 0)
    return () => clearTimeout(id)
  }, [isEditingTitle])

  // Keep a ref to the latest note.content so the effect below can read it
  // without note.content being in its dependency array (which would cause the
  // effect to fire on every keystroke and reset the cursor — Bug 1).
  const noteContentRef = useRef(note.content)
  noteContentRef.current = note.content
  useEffect(() => {
    // When isOverview switches to false the contentEditable div (re)mounts.
    // Unconditionally restoring innerHTML here fixes both:
    //   Bug 1: cursor reset on every keystroke (effect only runs when isOverview changes)
    //   Bug 2: content disappears after crossing the 50% threshold (always restores)
    if (!isOverview && editorRef.current) {
      editorRef.current.innerHTML = noteContentRef.current || ''
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverview])

  // Restore contentEditable innerHTML after an undo/redo restores note.content
  useEffect(() => {
    if (!undoRevision || isOverview || !editorRef.current) return
    editorRef.current.innerHTML = noteContentRef.current || ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoRevision])

  const handleClose = useCallback(() => {
    const text = note.content?.replace(/<[^>]*>/g, '').trim() ?? ''
    if (text.length > 0) { setShowCloseConfirm(true); return }
    onClose(note.id)
  }, [note.id, note.content, onClose])

  const startRename = useCallback(() => {
    inputHadFocusRef.current = false
    setDraftTitle(note.title)
    setIsEditingTitle(true)
  }, [note.title])

  const commitRename = useCallback(() => {
    inputHadFocusRef.current = false
    const trimmed = draftTitle.trim()
    if (trimmed) onUpdate(note.id, { title: trimmed })
    setIsEditingTitle(false)
  }, [draftTitle, note.id, onUpdate])

  const cancelRename = useCallback(() => {
    inputHadFocusRef.current = false
    setIsEditingTitle(false)
  }, [])

  // Only commit on blur if the input was actually focused by the user —
  // ignores any synthetic blur fired during context-menu close.
  const handleRenameBlur = useCallback(() => {
    if (!inputHadFocusRef.current) return
    commitRename()
  }, [commitRename])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
    else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  }, [commitRename, cancelRename])

  // Auto-focus the editor when this note was just created
  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount-only

  // Title bar drag (normal mode only)
  const handleMouseDownDrag = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return
      if (isEditingTitle && (e.target as HTMLElement).tagName === 'INPUT') return
      e.preventDefault()
      actionSnapshotPushedRef.current = false
      isDragging.current = true
      dragStart.current = {
        x: e.clientX / scale - note.x,
        y: e.clientY / scale - note.y,
      }
      onFocus(note.id)
    },
    [note.x, note.y, note.id, onFocus, scale, isEditingTitle]
  )

  const handleMouseDownResize = useCallback(
    (e: React.MouseEvent, direction: ResizeDirection) => {
      if (isMaximized) return
      e.preventDefault()
      e.stopPropagation()
      const SNAP_TOL = 4
      const makePartners = (pred: (o: Note) => boolean): ResizePartner[] =>
        allNotesRef.current
          .filter((o) => o.id !== note.id && pred(o))
          .map((o) => ({ id: o.id, origX: o.x, origY: o.y, origWidth: o.width, origHeight: o.height }))
      // How much two ranges [a, a+sa] and [b, b+sb] overlap (negative = gap)
      const yOverlap = (oy: number, oh: number) =>
        Math.min(note.y + note.height, oy + oh) - Math.max(note.y, oy)
      const xOverlap = (ox: number, ow: number) =>
        Math.min(note.x + note.width, ox + ow) - Math.max(note.x, ox)
      // Partners must share a real edge segment, not just touch at a corner.
      // Requiring overlap > SNAP_TOL excludes corner-only contacts.
      actionSnapshotPushedRef.current = false
      isResizing.current = true
      resizeStart.current = {
        noteX: note.x, noteY: note.y, width: note.width, height: note.height,
        clientX: e.clientX, clientY: e.clientY, direction,
        eastPartners:  makePartners((o) => Math.abs(o.x - (note.x + note.width)) < SNAP_TOL && yOverlap(o.y, o.height) > SNAP_TOL),
        westPartners:  makePartners((o) => Math.abs((o.x + o.width) - note.x) < SNAP_TOL && yOverlap(o.y, o.height) > SNAP_TOL),
        southPartners: makePartners((o) => Math.abs(o.y - (note.y + note.height)) < SNAP_TOL && xOverlap(o.x, o.width) > SNAP_TOL),
        northPartners: makePartners((o) => Math.abs((o.y + o.height) - note.y) < SNAP_TOL && xOverlap(o.x, o.width) > SNAP_TOL),
      }
      onFocus(note.id)
    },
    [note.id, note.x, note.y, note.width, note.height, onFocus, isMaximized]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        if (!actionSnapshotPushedRef.current) {
          actionSnapshotPushedRef.current = true
          onDragStartRef.current?.()
        }
        hasDragged.current = true
        const rawX = e.clientX / scale - dragStart.current.x
        const rawY = e.clientY / scale - dragStart.current.y
        const { x: newX, y: newY } = snapToGrid(
          rawX, rawY, note.id, note.width, note.height,
          allNotesRef.current, scale, canvasOffsetRef.current
        )
        onUpdate(note.id, { x: newX, y: newY })
      }
      if (isResizing.current) {
        if (!actionSnapshotPushedRef.current) {
          actionSnapshotPushedRef.current = true
          onResizeStartRef.current?.()
        }
        const { noteX: ox, noteY: oy, width: ow, height: oh, direction: dir,
                eastPartners, westPartners, southPartners, northPartners } = resizeStart.current
        let dx = (e.clientX - resizeStart.current.clientX) / scale
        let dy = (e.clientY - resizeStart.current.clientY) / scale
        const MIN_W = 280, MIN_H = 200
        // Clamp deltas so partners cannot be squeezed below their minimum size.
        // This makes the shared edge behave as a single edge — both notes stop together.
        if (dir.includes('e') && dx > 0 && eastPartners.length > 0)
          dx = Math.min(dx, Math.min(...eastPartners.map((p) => p.origWidth - MIN_W)))
        if (dir.includes('w') && dx < 0 && westPartners.length > 0)
          dx = Math.max(dx, -Math.min(...westPartners.map((p) => p.origWidth - MIN_W)))
        if (dir.includes('s') && dy > 0 && southPartners.length > 0)
          dy = Math.min(dy, Math.min(...southPartners.map((p) => p.origHeight - MIN_H)))
        if (dir.includes('n') && dy < 0 && northPartners.length > 0)
          dy = Math.max(dy, -Math.min(...northPartners.map((p) => p.origHeight - MIN_H)))
        let newX = ox, newY = oy, newW = ow, newH = oh
        if (dir.includes('e')) newW = Math.max(MIN_W, ow + dx)
        if (dir.includes('s')) newH = Math.max(MIN_H, oh + dy)
        if (dir.includes('w')) { const d = Math.min(dx, ow - MIN_W); newX = ox + d; newW = ow - d }
        if (dir.includes('n')) { const d = Math.min(dy, oh - MIN_H); newY = oy + d; newH = oh - d }
        onUpdate(note.id, { x: newX, y: newY, width: newW, height: newH })
        // Coupled resize: snapped partners share the moved edge
        if (dir.includes('e')) {
          const sharedX = ox + newW
          for (const p of eastPartners) {
            const newPW = Math.max(MIN_W, p.origX + p.origWidth - sharedX)
            onUpdate(p.id, { x: p.origX + p.origWidth - newPW, width: newPW })
          }
        }
        if (dir.includes('w')) {
          for (const p of westPartners) {
            onUpdate(p.id, { width: Math.max(MIN_W, newX - p.origX) })
          }
        }
        if (dir.includes('s')) {
          const sharedY = oy + newH
          for (const p of southPartners) {
            const newPH = Math.max(MIN_H, p.origY + p.origHeight - sharedY)
            onUpdate(p.id, { y: p.origY + p.origHeight - newPH, height: newPH })
          }
        }
        if (dir.includes('n')) {
          for (const p of northPartners) {
            onUpdate(p.id, { height: Math.max(MIN_H, newY - p.origY) })
          }
        }
      }
    }
    const handleMouseUp = () => {
      isDragging.current = false
      isResizing.current = false
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [note.id, note.width, note.height, onUpdate, scale])

  const toggleMaximize = useCallback(() => {
    if (!isMaximized) {
      setPreMaxState({ x: note.x, y: note.y, width: note.width, height: note.height })
      const vw = window.innerWidth
      const vh = window.innerHeight
      const HEADER_H = 57
      const usableH = vh - HEADER_H
      // Scale to 95% of usable viewport height, maintaining aspect ratio
      const ratio = note.width / note.height
      let newH = (0.95 * usableH) / scale
      let newW = newH * ratio
      // Cap at 99% of viewport width
      const maxW = (0.99 * vw) / scale
      if (newW > maxW) { newW = maxW; newH = newW / ratio }
      // Center in the current viewport (canvas coords)
      const cx = (vw / 2 - canvasOffset.x) / scale
      const cy = (HEADER_H + usableH / 2 - canvasOffset.y) / scale
      onUpdate(note.id, { x: cx - newW / 2, y: cy - newH / 2, width: newW, height: newH })
    } else {
      onUpdate(note.id, preMaxState)
    }
    setIsMaximized(!isMaximized)
    onFocus(note.id)
  }, [isMaximized, note, onUpdate, onFocus, preMaxState, scale, canvasOffset])

  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev)
    onFocus(note.id)
  }, [note.id, onFocus])

  const execFormat = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value)
    editorRef.current?.focus()
    setIsBold(document.queryCommandState('bold'))
    setIsItalic(document.queryCommandState('italic'))
    setIsUnderlined(document.queryCommandState('underline'))
  }, [])

  const handleFontSizeChange = useCallback(
    (newSize: number) => {
      const pxToCommand: Record<number, string> = {
        10: '1', 12: '2', 14: '3', 16: '4', 18: '5', 24: '6', 32: '7',
      }
      execFormat('fontSize', pxToCommand[newSize] || '3')
      setCurrentFontSize(newSize)
    },
    [execFormat]
  )

  const handleEditorInput = useCallback(() => {
    if (editorRef.current) {
      onUpdate(note.id, { content: editorRef.current.innerHTML })
    }
  }, [note.id, onUpdate])

  const handleEditorPaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    const html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
    document.execCommand('insertHTML', false, html)
  }, [])

  const textContent = editorRef.current?.textContent || ''
  const wordCount = textContent.trim() ? textContent.trim().split(/\s+/).length : 0
  const charCount = textContent.length

  // Double-click title bar → focus note (normal mode)
  const handleTitleBarDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isOverview) return
      if (isEditingTitle) return
      e.stopPropagation()
      onFocus(note.id)
      onZoomToNote(note.id)
    },
    [isOverview, isEditingTitle, note.id, onFocus, onZoomToNote]
  )

  return (
    <>
    <div
      ref={windowRef}
      className={`absolute flex flex-col overflow-hidden rounded-lg border border-note-border bg-note-bg shadow-lg shadow-black/20 transition-shadow ${
        isOverview
          ? 'cursor-grab active:cursor-grabbing hover:border-primary/60 hover:shadow-xl hover:shadow-primary/10'
          : 'hover:shadow-xl hover:shadow-black/25'
      }`}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${note.width}px`,
        height: isMinimized ? 'auto' : `${note.height}px`,
        zIndex: note.zIndex,
        backgroundColor: note.color,
        filter: isFocusMode && !isFocused ? 'brightness(0.4)' : undefined,
      }}
      onMouseDown={(e) => {
        if (isOverview) {
          if ((e.target as HTMLElement).closest('button')) return
          e.preventDefault()
          hasDragged.current = false
          actionSnapshotPushedRef.current = false
          isDragging.current = true
          dragStart.current = {
            x: e.clientX / scale - note.x,
            y: e.clientY / scale - note.y,
          }
          onFocus(note.id)
        } else {
          onFocus(note.id)
        }
      }}
      onDoubleClick={(e) => {
        // In overview mode, double-click anywhere on the note zooms to it
        if (!isOverview) return
        if (hasDragged.current) return
        e.stopPropagation()
        onFocus(note.id)
        onZoomToNote(note.id)
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Overview hover label — pointer-events-none so dblclick reaches the note div */}
      {isOverview && (
        <div
          className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          } bg-note-bg/80 backdrop-blur-sm`}
        >
          <span className="rounded-md bg-primary/10 px-4 py-2 text-5xl font-semibold text-primary">
            {note.title || 'Untitled'}
          </span>
        </div>
      )}

      {/* Title Bar — wrapped in ContextMenu for right-click menu */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`flex shrink-0 items-center gap-2 border-b border-note-border px-3 py-2 ${
              isFocused ? 'bg-note-titlebar/90' : 'bg-note-titlebar/60'
            } cursor-default`}
            style={{ position: 'relative', zIndex: 20 }}
            onMouseDown={isOverview ? undefined : handleMouseDownDrag}
            onDoubleClick={handleTitleBarDoubleClick}
          >
            {!isOverview && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Close note"
                  onMouseDown={() => { wasFocusedRef.current = isFocused }}
                  onClick={() => { if (!wasFocusedRef.current) return; handleClose() }}
                  className={`group flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${
                    isFocused ? 'bg-red-400 hover:bg-red-500' : 'bg-neutral-300 dark:bg-neutral-600'
                  }`}
                >
                  <X size={8} className={`opacity-0 transition-opacity group-hover:opacity-100 ${isFocused ? 'text-red-800' : 'text-neutral-500'}`} />
                </button>
                <button
                  type="button"
                  aria-label="Minimize note"
                  onMouseDown={() => { wasFocusedRef.current = isFocused }}
                  onClick={() => { if (!wasFocusedRef.current) return; toggleMinimize() }}
                  className={`group flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${
                    isFocused ? 'bg-yellow-400 hover:bg-yellow-500' : 'bg-neutral-300 dark:bg-neutral-600'
                  }`}
                >
                  <Minus size={8} className={`opacity-0 transition-opacity group-hover:opacity-100 ${isFocused ? 'text-yellow-800' : 'text-neutral-500'}`} />
                </button>
                <button
                  type="button"
                  aria-label="Maximize note"
                  onMouseDown={() => { wasFocusedRef.current = isFocused }}
                  onClick={() => { if (!wasFocusedRef.current) return; toggleMaximize() }}
                  className={`group flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${
                    isFocused ? 'bg-green-400 hover:bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600'
                  }`}
                >
                  <Maximize2 size={7} className={`opacity-0 transition-opacity group-hover:opacity-100 ${isFocused ? 'text-green-800' : 'text-neutral-500'}`} />
                </button>
              </div>
            )}

            {isEditingTitle && !isOverview ? (
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <input
                  ref={titleInputRef}
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onFocus={() => { inputHadFocusRef.current = true }}
                  onBlur={handleRenameBlur}
                  onKeyDown={handleTitleKeyDown}
                  className="min-w-0 flex-1 rounded-sm bg-note-bg px-1.5 py-0.5 text-center text-xs font-medium text-note-foreground outline-none ring-1 ring-primary/40"
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); commitRename() }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 text-white transition-colors hover:bg-green-600"
                  aria-label="Accept rename"
                >
                  <Check size={11} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); cancelRename() }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-400 text-white transition-colors hover:bg-red-500"
                  aria-label="Cancel rename"
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <div className="min-w-0 flex-1 overflow-hidden text-center">
                <span
                  className={`select-none text-xs ${isFocused ? 'font-semibold text-note-foreground' : 'font-medium text-note-foreground/70'}`}
                  onDoubleClick={(e) => { if (!isOverview) { e.stopPropagation(); startRename() } }}
                >
                  {note.title || 'Untitled'}
                </span>
              </div>
            )}

            {!isOverview && <div className="w-[52px]" />}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          {!isOverview && (
            <ContextMenuItem onSelect={startRename}>
              Rename
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => { onFocus(note.id); onZoomToNote(note.id) }}>
            Focus
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onDuplicate(note.id)}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopy(note.id)}>
            Copy note
          </ContextMenuItem>
          {!isOverview && (
            <ContextMenuItem onSelect={toggleMinimize}>
              {isMinimized ? 'Restore' : 'Minimize'}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Body — hidden when minimized */}
      {!isMinimized && (
        <>
          {/* Formatting Toolbar — hidden in overview mode */}
          {!isOverview && (
            <div className="flex shrink-0 items-center gap-1 border-b border-note-border bg-note-toolbar px-3 py-1.5">
              <ToolbarButton active={isBold} onClick={() => execFormat('bold')} icon={Bold} label="Bold" />
              <ToolbarButton active={isItalic} onClick={() => execFormat('italic')} icon={Italic} label="Italic" />
              <ToolbarButton active={isUnderlined} onClick={() => execFormat('underline')} icon={Underline} label="Underline" />
              <div className="mx-1 h-4 w-px bg-note-foreground/10" />
              <select
                value={currentFontSize}
                onChange={(e) => handleFontSizeChange(Number(e.target.value))}
                onMouseDown={(e) => e.stopPropagation()}
                className="rounded-md border border-note-foreground/10 bg-note-toolbar px-1.5 py-0.5 text-xs text-note-foreground/60 outline-none focus:border-primary/40"
                aria-label="Font size"
              >
                {[10, 12, 14, 16, 18, 24, 32].map((size) => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
          )}

          {/* Content Area */}
          <div className="relative flex-1 overflow-hidden">
            {isOverview ? (
              <div
                className="pointer-events-none h-full w-full select-none overflow-hidden p-4 font-mono text-sm leading-relaxed text-note-foreground/60"
                dangerouslySetInnerHTML={{
                  __html: note.content || '<span style="opacity:0.3">Empty note</span>',
                }}
              />
            ) : (
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onPaste={handleEditorPaste}
                data-placeholder="Start typing your note..."
                className="notepad-editor h-full w-full cursor-text overflow-auto p-4 font-mono text-sm leading-relaxed text-note-foreground focus:outline-none"
              />
            )}
          </div>

          {/* Status Bar — hidden in overview mode */}
          {!isOverview && (
            <div className="flex shrink-0 items-center justify-between border-t border-note-border bg-note-toolbar/60 px-3 py-1">
              <span className="text-[10px] text-note-foreground/35">
                {wordCount} {wordCount === 1 ? 'word' : 'words'} &middot;{' '}
                {charCount} {charCount === 1 ? 'char' : 'chars'}
              </span>
              <div className="flex items-center gap-1">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-label={`${c.name} note color`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onUpdate(note.id, { color: c.value })}
                    className={`h-3.5 w-3.5 rounded-full border transition-transform hover:scale-125 ${
                      note.color === c.value
                        ? 'scale-125 border-note-foreground/50'
                        : 'border-note-foreground/15'
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}


      {/* Resize Handles — all 8 directions.
          Handles extend 1px outside the padding box (into the border) so the
          border pixel between two snapped notes is covered by both handles,
          eliminating the grab-cursor gap at the shared edge. */}
      {!isMaximized && !isOverview && !isMinimized && (
        <>
          {/* Edges */}
          <div className="absolute left-3 right-3 h-1 cursor-ns-resize"
            style={{ top: '-1px', zIndex: 30 }}
            onMouseDown={(e) => handleMouseDownResize(e, 'n')} />
          <div className="absolute left-3 right-3 h-1 cursor-ns-resize"
            style={{ bottom: '-1px', zIndex: 30 }}
            onMouseDown={(e) => handleMouseDownResize(e, 's')} />
          <div className="absolute top-3 bottom-3 w-1 cursor-ew-resize"
            style={{ left: '-1px', zIndex: 30 }}
            onMouseDown={(e) => handleMouseDownResize(e, 'w')} />
          <div className="absolute top-3 bottom-3 w-1 cursor-ew-resize"
            style={{ right: '-1px', zIndex: 30 }}
            onMouseDown={(e) => handleMouseDownResize(e, 'e')} />
          {/* Corners */}
          <div className="absolute h-3 w-3 cursor-nwse-resize"
            style={{ top: '-1px', left: '-1px', zIndex: 40 }}
            onMouseDown={(e) => handleMouseDownResize(e, 'nw')} />
          <div className="absolute h-3 w-3 cursor-nesw-resize"
            style={{ top: '-1px', right: '-1px', zIndex: 40 }}
            onMouseDown={(e) => handleMouseDownResize(e, 'ne')} />
          <div className="absolute h-3 w-3 cursor-nesw-resize"
            style={{ bottom: '-1px', left: '-1px', zIndex: 40 }}
            onMouseDown={(e) => handleMouseDownResize(e, 'sw')} />
          <div className="absolute h-3 w-3 cursor-nwse-resize"
            style={{ bottom: '-1px', right: '-1px', zIndex: 40 }}
            onMouseDown={(e) => handleMouseDownResize(e, 'se')} />
        </>
      )}
    </div>

    {showCloseConfirm && createPortal(
      <ConfirmDialog
        message="Delete note?"
        onConfirm={() => { setShowCloseConfirm(false); onClose(note.id) }}
        onCancel={() => setShowCloseConfirm(false)}
      />,
      document.body
    )}
  </>
  )
}

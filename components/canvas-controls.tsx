'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Maximize, RotateCcw, ZoomIn, ZoomOut, FileText, LogOut, Check, X, Crosshair } from 'lucide-react'
import { type Workspace } from '@/lib/notes-store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

interface CanvasControlsProps {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomFit: () => void
  onZoomReset: () => void
  onZoomToCenter: () => void
  onAddNote: () => void
  noteCount: number
  workspaces: Workspace[]
  activeWorkspaceId: string
  onSwitchWorkspace: (id: string) => void
  onAddWorkspace: () => void
  onRenameWorkspace: (id: string, name: string) => void
  onDeleteWorkspace: (id: string) => void
  onSignOut: () => void
  isFocusMode: boolean
  onToggleFocusMode: () => void
}

function WorkspaceTab({
  workspace,
  isActive,
  onSwitch,
  onRename,
  onDelete,
}: {
  workspace: Workspace
  isActive: boolean
  onSwitch: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(workspace.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputHadFocusRef = useRef(false)

  const startRename = () => {
    inputHadFocusRef.current = false
    setDraft(workspace.name)
    setEditing(true)
  }

  const commit = () => {
    inputHadFocusRef.current = false
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed) onRename(workspace.id, trimmed)
  }

  const cancel = () => {
    inputHadFocusRef.current = false
    setEditing(false)
  }

  const handleBlur = () => {
    if (!inputHadFocusRef.current) return
    commit()
  }

  useEffect(() => {
    if (!editing) return
    const id = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => clearTimeout(id)
  }, [editing])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`flex h-7 cursor-pointer items-center rounded-md px-2 text-xs font-medium transition-colors select-none ${
            isActive
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
          onClick={() => { if (!editing) onSwitch(workspace.id) }}
        >
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => { inputHadFocusRef.current = true }}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit() }
                  else if (e.key === 'Escape') { e.preventDefault(); cancel() }
                }}
                className="w-20 bg-transparent text-xs outline-none"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit() }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-500 text-white transition-colors hover:bg-green-600"
                aria-label="Accept rename"
              >
                <Check size={9} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); cancel() }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-400 text-white transition-colors hover:bg-red-500"
                aria-label="Cancel rename"
              >
                <X size={9} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            workspace.name
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={startRename}>Rename</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onDelete(workspace.id)}
          className="text-red-500 focus:text-red-500"
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default function CanvasControls({
  scale,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoomReset,
  onZoomToCenter,
  onAddNote,
  noteCount,
  workspaces,
  activeWorkspaceId,
  onSwitchWorkspace,
  onAddWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onSignOut,
  isFocusMode,
  onToggleFocusMode,
}: CanvasControlsProps) {
  return (
    <>
      {/* Top Bar */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 py-3">
          {/* Left: app identity + workspace tabs */}
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <FileText size={16} className="text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight text-foreground">FloNotes</h1>
              <p className="text-[10px] text-muted-foreground">
                {noteCount} {noteCount === 1 ? 'note' : 'notes'}
              </p>
            </div>

            <div className="mx-1 h-5 w-px bg-border" />

            {/* Workspace tabs inline with title */}
            {workspaces.map((ws) => (
              <WorkspaceTab
                key={ws.id}
                workspace={ws}
                isActive={ws.id === activeWorkspaceId}
                onSwitch={onSwitchWorkspace}
                onRename={onRenameWorkspace}
                onDelete={onDeleteWorkspace}
              />
            ))}
            <button
              type="button"
              onClick={onAddWorkspace}
              aria-label="Add workspace"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Right: Focus Mode + New Note + Sign Out */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleFocusMode}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors select-none ${
                isFocusMode
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Crosshair size={13} />
              <span>Focus</span>
            </button>
            <button
              type="button"
              onClick={onAddNote}
              className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:brightness-110 active:scale-[0.97]"
            >
              <Plus size={13} />
              <span>New Note</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Zoom Controls — Bottom Center */}
      <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-background/80 px-2 py-1.5 shadow-xl shadow-black/20 backdrop-blur-xl">
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ZoomOut size={16} />
        </button>

        <button
          type="button"
          onClick={onZoomToCenter}
          className="flex h-8 min-w-[52px] items-center justify-center rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Zoom to 100%"
          title="Zoom to 100%"
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Zoom in"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ZoomIn size={16} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          onClick={onZoomFit}
          aria-label="Fit all notes"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Fit all notes in view"
        >
          <Maximize size={14} />
        </button>

        <button
          type="button"
          onClick={onZoomReset}
          aria-label="Reset view"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Reset view to origin"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* Keyboard Hints — Bottom Right */}
      <div className="fixed bottom-5 right-5 z-50 hidden items-center gap-3 text-[10px] text-muted-foreground/50 lg:flex">
        <span>Scroll to zoom</span>
        <span>Double-click canvas for new note</span>
        <span>Right-click note title for options</span>
      </div>
    </>
  )
}

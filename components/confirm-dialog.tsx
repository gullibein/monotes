'use client'

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onMouseDown={onCancel} />
      <div className="relative w-full max-w-[260px] rounded-xl border border-border bg-background p-5 shadow-xl shadow-black/30">
        <p className="text-center text-sm font-medium text-foreground">{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-500 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

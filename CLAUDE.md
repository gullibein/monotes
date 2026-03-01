# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start dev server
pnpm build      # Production build
pnpm lint       # Run ESLint
```

> `next.config.mjs` has `typescript.ignoreBuildErrors: true`, so TS errors won't fail builds.

## Architecture

**NoteCanvas** (`components/note-canvas.tsx`) is the core of the app. It owns all state:
- `notes: Note[]` — all note data (position, size, content, zIndex, color)
- `scale` and `offset` — canvas viewport transform
- Panning via mouse drag on the canvas background; zooming via scroll wheel or control buttons

The canvas is rendered as a `10000×10000px` div with `transform: translate(offset) scale(scale)` applied. Notes are `position: absolute` elements on this div, positioned by their `x`/`y` coordinates in canvas space.

**NotepadWindow** (`components/notepad-window.tsx`) renders each individual note. It handles:
- Drag-to-move (title bar) and resize (bottom-right handle) — both scale-aware (`clientX / scale`)
- Rich text editing via `contentEditable` + `document.execCommand` (bold, italic, underline, font size)
- Note content is stored as raw HTML (`innerHTML`)
- **Overview mode**: when `scale ≤ 0.5`, the note switches to a read-only preview with a click-to-zoom overlay instead of the editor UI. In overview mode the entire note is draggable (not just the title bar); clicking without dragging zooms to the note.

**CanvasControls** (`components/canvas-controls.tsx`) renders the top bar (app title + "New Note" button) and the bottom-center zoom controls. It is purely presentational.

**lib/notes-store.ts** is not a store — it's a collection of factory functions and the `Note` type. There is no global state manager or persistence; all note state lives in `NoteCanvas`'s `useState`.

## Key Conventions

- **No persistence**: Notes are reset on page refresh. There is no localStorage, database, or API.
- **CSS custom properties for theming**: The active theme is defined in `app/globals.css` (not `styles/globals.css`, which is the shadcn default). Canvas-specific tokens (`--canvas`, `--canvas-dot`, `--note-bg`, `--note-foreground`, `--note-toolbar`, `--note-border`, `--note-titlebar`) are defined there and must be referenced via Tailwind classes like `bg-canvas`, `text-note-foreground`, etc.
- **shadcn/ui** components are in `components/ui/` (new-york style, lucide icons). Add new ones via `pnpm dlx shadcn@latest add <component>`.
- **Tailwind v4** — configuration is CSS-first (no `tailwind.config.js`); custom tokens are registered via `@theme inline` in `app/globals.css`.
- **Double-click on empty canvas** creates a new note at the cursor position; `addNoteAt` converts screen coordinates to canvas coordinates using `(clientX - offset.x) / scale`.
- **zIndex management**: `getNextZIndex()` in `notes-store.ts` increments a module-level counter. Focused notes get the next z-index value.
- Smooth zoom animations use `requestAnimationFrame` with an easeOutCubic curve (`animateToView` in `NoteCanvas`).

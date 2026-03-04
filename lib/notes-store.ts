export const NOTE_COLORS = [
  { name: 'White', value: '#fafaf7' },
  { name: 'Yellow', value: '#fef9c3' },
  { name: 'Green', value: '#dcfce7' },
  { name: 'Blue', value: '#dbeafe' },
  { name: 'Pink', value: '#fce7f3' },
  { name: 'Orange', value: '#ffedd5' },
  { name: 'Lavender', value: '#ede9fe' },
] as const

export interface Workspace {
  id: string
  name: string
  notes: Note[]
}

export interface Note {
  id: string
  title: string
  content: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  createdAt: number
  color: string
  type?: 'note' | 'link'
  url?: string
}

let nextZIndex = 1

export function getNextZIndex() {
  return ++nextZIndex
}

/** Call once after loading saved notes to ensure new z-indexes are always higher. */
export function initZIndexCounter(max: number) {
  if (max > nextZIndex) nextZIndex = max
}

const CASCADE_OFFSET_X = 30
const CASCADE_OFFSET_Y = 30

export function createNote(existingCount: number): Note {
  const offsetX = (existingCount % 10) * CASCADE_OFFSET_X
  const offsetY = (existingCount % 10) * CASCADE_OFFSET_Y

  return {
    id: crypto.randomUUID(),
    title: `Note ${existingCount + 1}`,
    content: '',
    x: 80 + offsetX,
    y: 80 + offsetY,
    width: 420,
    height: 340,
    zIndex: getNextZIndex(),
    createdAt: Date.now(),
    color: NOTE_COLORS[0].value,
  }
}

export function createNoteAt(x: number, y: number, existingCount: number): Note {
  return {
    id: crypto.randomUUID(),
    title: `Note ${existingCount + 1}`,
    content: '',
    x: x - 210,
    y: y - 20,
    width: 420,
    height: 340,
    zIndex: getNextZIndex(),
    createdAt: Date.now(),
    color: NOTE_COLORS[0].value,
  }
}

export function createLink(existingCount: number): Note {
  const offsetX = (existingCount % 10) * CASCADE_OFFSET_X
  const offsetY = (existingCount % 10) * CASCADE_OFFSET_Y
  return {
    id: crypto.randomUUID(),
    title: 'New Link',
    content: '',
    x: 80 + offsetX,
    y: 80 + offsetY,
    width: 320,
    height: 260,
    zIndex: getNextZIndex(),
    createdAt: Date.now(),
    color: NOTE_COLORS[0].value,
    type: 'link',
    url: '',
  }
}

export function createLinkAt(x: number, y: number, existingCount: number): Note {
  return { ...createLink(existingCount), x: x - 160, y: y - 20 }
}

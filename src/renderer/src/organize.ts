import { PDFDocument, degrees } from 'pdf-lib'
import type { ExternalDoc, PageItem, PageRotation } from './store'

// Materialise the user's page-edit plan into a brand new PDF.
// Each item references either a page in the original doc or a page in one of
// the loaded external docs. We copy pages into a fresh PDFDocument and apply
// the per-item rotation on top of whatever rotation the source page already
// has.
export async function applyOrganizePlan(
  originalBytes: ArrayBuffer,
  items: PageItem[],
  externalDocs: Record<string, ExternalDoc>
): Promise<Uint8Array> {
  if (items.length === 0) {
    throw new Error('Plan is empty — every page would be removed.')
  }

  const out = await PDFDocument.create()
  const original = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  const externalLoaded = new Map<string, PDFDocument>()
  for (const ext of Object.values(externalDocs)) {
    externalLoaded.set(ext.id, await PDFDocument.load(ext.bytes, { ignoreEncryption: true }))
  }

  for (const item of items) {
    const src =
      item.source.kind === 'doc'
        ? original
        : externalLoaded.get(item.source.externalId)
    if (!src) {
      throw new Error('Missing source document for one of the planned pages.')
    }
    const [copied] = await out.copyPages(src, [item.originalIndex])
    if (item.rotation !== 0) {
      const existing = copied.getRotation().angle
      const total = ((existing + item.rotation) % 360 + 360) % 360
      copied.setRotation(degrees(total))
    }
    out.addPage(copied)
  }

  return out.save({ useObjectStreams: false })
}

// ---------- plan-mutation helpers ----------

export function rotateItems(items: PageItem[], ids: Set<string>, delta: 90 | -90 | 180): PageItem[] {
  return items.map((it) => {
    if (!ids.has(it.id)) return it
    const next = ((it.rotation + delta) % 360 + 360) % 360
    return { ...it, rotation: next as PageRotation }
  })
}

export function deleteItems(items: PageItem[], ids: Set<string>): PageItem[] {
  return items.filter((it) => !ids.has(it.id))
}

export function duplicateItems(items: PageItem[], ids: Set<string>): {
  items: PageItem[]
  newIds: Set<string>
} {
  const newItems: PageItem[] = []
  const newIds = new Set<string>()
  for (const it of items) {
    newItems.push(it)
    if (ids.has(it.id)) {
      const clone = { ...it, id: crypto.randomUUID() }
      newItems.push(clone)
      newIds.add(clone.id)
    }
  }
  return { items: newItems, newIds }
}

// Move every selected item to land just before/after the drop-target item.
// Selected items keep their relative order. If `targetId` is null we move
// them to the very end of the list.
export function moveSelectedTo(
  items: PageItem[],
  selected: Set<string>,
  targetId: string | null,
  position: 'before' | 'after' | 'end'
): PageItem[] {
  if (selected.size === 0) return items
  const moving = items.filter((it) => selected.has(it.id))
  const remaining = items.filter((it) => !selected.has(it.id))
  if (position === 'end' || targetId === null) {
    return [...remaining, ...moving]
  }
  // Don't drop into the moving set itself
  if (selected.has(targetId)) return items
  const idx = remaining.findIndex((it) => it.id === targetId)
  if (idx < 0) return [...remaining, ...moving]
  const insertAt = position === 'before' ? idx : idx + 1
  return [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)]
}

export function insertExternalAfter(
  items: PageItem[],
  external: ExternalDoc,
  afterId: string | null,
  pageIndices?: number[]
): PageItem[] {
  const indices = pageIndices ?? Array.from({ length: external.doc.numPages }, (_, i) => i)
  const newItems: PageItem[] = indices.map((idx) => ({
    id: crypto.randomUUID(),
    source: { kind: 'external', externalId: external.id },
    originalIndex: idx,
    rotation: 0
  }))
  if (afterId === null) return [...items, ...newItems]
  const idx = items.findIndex((it) => it.id === afterId)
  if (idx < 0) return [...items, ...newItems]
  return [...items.slice(0, idx + 1), ...newItems, ...items.slice(idx + 1)]
}

export function replaceSelected(
  items: PageItem[],
  selected: Set<string>,
  external: ExternalDoc
): PageItem[] {
  if (selected.size === 0) return items
  const insertion: PageItem[] = Array.from({ length: external.doc.numPages }, (_, idx) => ({
    id: crypto.randomUUID(),
    source: { kind: 'external', externalId: external.id },
    originalIndex: idx,
    rotation: 0
  }))
  // Insert before the first selected, drop all selected
  const firstSelectedIdx = items.findIndex((it) => selected.has(it.id))
  if (firstSelectedIdx < 0) return items
  const kept = items.filter((it) => !selected.has(it.id))
  const before = kept.slice(0, firstSelectedIdx)
  const after = kept.slice(firstSelectedIdx)
  return [...before, ...insertion, ...after]
}

// Compute the list of items to use for an Extract operation: just the
// currently selected ones in their visual order.
export function extractSelected(items: PageItem[], selected: Set<string>): PageItem[] {
  return items.filter((it) => selected.has(it.id))
}

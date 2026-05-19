import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Trash2,
  RotateCcw,
  RotateCw,
  Copy,
  Scissors,
  FilePlus,
  Replace,
  X,
  Save
} from 'lucide-react'
import { useViewer, type ExternalDoc, type PageItem } from '../store'
import { loadPdf, type PDFDocumentProxy } from '../pdf'
import {
  applyOrganizePlan,
  deleteItems,
  duplicateItems,
  extractSelected,
  insertExternalAfter,
  moveSelectedTo,
  replaceSelected,
  rotateItems
} from '../organize'

interface Props {
  onExit: () => void
  onSavedNew: (path: string) => void
}

export function OrganizeMode({ onExit, onSavedNew }: Props) {
  const doc = useViewer((s) => s.doc)
  const bytes = useViewer((s) => s.bytes)
  const fileName = useViewer((s) => s.fileName)
  const items = useViewer((s) => s.organizeItems)
  const selected = useViewer((s) => s.organizeSelected)
  const externalDocs = useViewer((s) => s.organizeExternalDocs)
  const setItems = useViewer((s) => s.setOrganizeItems)
  const setSelected = useViewer((s) => s.setOrganizeSelected)
  const registerExternalDoc = useViewer((s) => s.registerExternalDoc)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<{ id: string; position: 'before' | 'after' } | null>(
    null
  )
  const lastClickedRef = useRef<string | null>(null)

  if (!doc || !bytes) return null

  const handleSelect = (id: string, e: React.MouseEvent) => {
    const ids = items.map((it) => it.id)
    if (e.shiftKey && lastClickedRef.current) {
      const a = ids.indexOf(lastClickedRef.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        const range = ids.slice(lo, hi + 1)
        const next = new Set(selected)
        for (const r of range) next.add(r)
        setSelected(next)
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelected(next)
      lastClickedRef.current = id
      return
    }
    setSelected(new Set([id]))
    lastClickedRef.current = id
  }

  const selectAll = () => setSelected(new Set(items.map((it) => it.id)))
  const clearSelection = () => setSelected(new Set())

  const onDelete = () => {
    if (selected.size === 0) return
    setItems(deleteItems(items, selected))
    setSelected(new Set())
  }

  const onRotate = (delta: 90 | -90 | 180) => {
    if (selected.size === 0) return
    setItems(rotateItems(items, selected, delta))
  }

  const onDuplicate = () => {
    if (selected.size === 0) return
    const { items: next, newIds } = duplicateItems(items, selected)
    setItems(next)
    setSelected(newIds)
  }

  const onExtract = async () => {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const extractedItems = extractSelected(items, selected)
      const out = await applyOrganizePlan(bytes, extractedItems, externalDocs)
      const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
      const base = (fileName ?? 'extract').replace(/\.pdf$/i, '')
      const result = await window.akv.savePdf(buf, base + '-extract.pdf')
      if (result) {
        onSavedNew(`Extracted ${extractedItems.length} page(s) to ${result.path}`)
      }
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  const pickExternal = async (): Promise<ExternalDoc | null> => {
    const opened = await window.akv.openPdfs()
    if (!opened || opened.length === 0) return null
    const f = opened[0]
    const pdfjsDoc = await loadPdf(f.bytes)
    const ext: ExternalDoc = {
      id: crypto.randomUUID(),
      fileName: f.name,
      bytes: f.bytes,
      doc: pdfjsDoc
    }
    registerExternalDoc(ext)
    return ext
  }

  const onInsertFromPdf = async () => {
    setError(null)
    try {
      const ext = await pickExternal()
      if (!ext) return
      const afterId = selected.size > 0 ? lastSelectedId(items, selected) : null
      setItems(insertExternalAfter(items, ext, afterId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const onReplace = async () => {
    if (selected.size === 0) return
    setError(null)
    try {
      const ext = await pickExternal()
      if (!ext) return
      setItems(replaceSelected(items, selected, ext))
      setSelected(new Set())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const onApply = async () => {
    setBusy(true)
    setError(null)
    try {
      const out = await applyOrganizePlan(bytes, items, externalDocs)
      const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
      const base = (fileName ?? 'organized').replace(/\.pdf$/i, '')
      const result = await window.akv.savePdf(buf, base + '-organized.pdf')
      if (result) {
        onSavedNew(`Saved organized PDF to ${result.path}`)
      }
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  // ---- drag-and-drop ----
  const onDragStart = (e: React.DragEvent, id: string) => {
    // If the dragged item isn't selected, select just it
    if (!selected.has(id)) setSelected(new Set([id]))
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midpoint = rect.left + rect.width / 2
    const position = e.clientX < midpoint ? 'before' : 'after'
    setDragOver({ id, position })
  }

  const onDragLeave = () => setDragOver(null)

  const onDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    if (!dragOver) {
      setDragOver(null)
      return
    }
    const sel = selected.size > 0 ? selected : new Set([id])
    setItems(moveSelectedTo(items, sel, dragOver.id, dragOver.position))
    setDragOver(null)
  }

  const onDropAtEnd = (e: React.DragEvent) => {
    e.preventDefault()
    const sel = selected.size > 0 ? selected : new Set<string>()
    if (sel.size === 0) return
    setItems(moveSelectedTo(items, sel, null, 'end'))
    setDragOver(null)
  }

  return (
    <div className="organize">
      <div className="organize-toolbar">
        <div className="organize-group">
          <button className="ghost" onClick={onExit} disabled={busy}>
            <X size={14} /> Exit
          </button>
          <span className="muted" style={{ marginLeft: 12 }}>
            {selected.size} / {items.length} selected
          </span>
        </div>
        <div className="organize-group">
          <button onClick={selectAll} disabled={busy || items.length === 0}>
            Select all
          </button>
          <button onClick={clearSelection} disabled={busy || selected.size === 0}>
            Clear
          </button>
        </div>
        <div className="organize-group">
          <button onClick={() => onRotate(-90)} disabled={busy || selected.size === 0} title="Rotate left">
            <RotateCcw size={14} />
          </button>
          <button onClick={() => onRotate(90)} disabled={busy || selected.size === 0} title="Rotate right">
            <RotateCw size={14} />
          </button>
          <button onClick={() => onRotate(180)} disabled={busy || selected.size === 0} title="Rotate 180°">
            180°
          </button>
          <button onClick={onDuplicate} disabled={busy || selected.size === 0} title="Duplicate">
            <Copy size={14} />
          </button>
          <button onClick={onDelete} disabled={busy || selected.size === 0} title="Delete">
            <Trash2 size={14} />
          </button>
          <button onClick={onExtract} disabled={busy || selected.size === 0} title="Extract to new PDF">
            <Scissors size={14} /> Extract
          </button>
        </div>
        <div className="organize-group">
          <button onClick={onInsertFromPdf} disabled={busy} title="Insert pages from another PDF">
            <FilePlus size={14} /> Insert PDF
          </button>
          <button onClick={onReplace} disabled={busy || selected.size === 0} title="Replace selected with another PDF">
            <Replace size={14} /> Replace
          </button>
        </div>
        <div className="organize-group right">
          <button className="primary" onClick={onApply} disabled={busy || items.length === 0}>
            <Save size={14} /> {busy ? 'Saving…' : 'Apply & Save'}
          </button>
        </div>
      </div>

      {error && <div className="merge-error" style={{ margin: '8px 16px' }}>{error}</div>}

      <div className="organize-grid" onDragOver={(e) => e.preventDefault()} onDrop={onDropAtEnd}>
        {items.map((item, idx) => (
          <PageTile
            key={item.id}
            item={item}
            index={idx}
            selected={selected.has(item.id)}
            sourceDoc={
              item.source.kind === 'doc'
                ? doc
                : externalDocs[item.source.externalId]?.doc
            }
            sourceLabel={
              item.source.kind === 'doc'
                ? null
                : externalDocs[item.source.externalId]?.fileName ?? null
            }
            onClick={(e) => handleSelect(item.id, e)}
            onDragStart={(e) => onDragStart(e, item.id)}
            onDragOver={(e) => onDragOver(e, item.id)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, item.id)}
            dropIndicator={
              dragOver?.id === item.id ? dragOver.position : null
            }
          />
        ))}
      </div>
    </div>
  )
}

function lastSelectedId(items: PageItem[], selected: Set<string>): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (selected.has(items[i].id)) return items[i].id
  }
  return null
}

interface TileProps {
  item: PageItem
  index: number
  selected: boolean
  sourceDoc: PDFDocumentProxy | undefined
  sourceLabel: string | null
  onClick: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  dropIndicator: 'before' | 'after' | null
}

function PageTile({
  item,
  index,
  selected,
  sourceDoc,
  sourceLabel,
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dropIndicator
}: TileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    if (!sourceDoc) return
    const render = async () => {
      const page = await sourceDoc.getPage(item.originalIndex + 1)
      if (cancelled) return
      const viewport = page.getViewport({ scale: 0.4 })
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
      const ctx = canvas.getContext('2d')!
      const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      try {
        await page.render({
          canvasContext: ctx,
          viewport,
          transform
        } as Parameters<typeof page.render>[0]).promise
      } catch (err) {
        if ((err as { name?: string }).name !== 'RenderingCancelledException') throw err
      }
    }
    render().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sourceDoc, item.originalIndex])

  return (
    <div
      className={
        'page-tile' +
        (selected ? ' selected' : '') +
        (dropIndicator === 'before' ? ' drop-before' : '') +
        (dropIndicator === 'after' ? ' drop-after' : '')
      }
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="page-tile-canvas-wrap"
        style={{ transform: `rotate(${item.rotation}deg)` }}
      >
        <canvas ref={canvasRef} />
      </div>
      <div className="page-tile-label">
        <span>{index + 1}</span>
        {item.rotation !== 0 && <span className="rot-badge">{item.rotation}°</span>}
        {sourceLabel && (
          <span className="external-badge" title={`From ${sourceLabel}`}>
            ↳
          </span>
        )}
      </div>
    </div>
  )
}

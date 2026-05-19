import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { Scissors } from 'lucide-react'

type Mode = 'ranges' | 'chunks'

interface Range {
  start: number
  end: number
}

interface Props {
  open: boolean
  bytes: ArrayBuffer | null
  fileName: string | null
  pageCount: number
  onCancel: () => void
  onDone: (count: number, dir: string) => void
}

export function SplitModal({ open, bytes, fileName, pageCount, onCancel, onDone }: Props) {
  const [mode, setMode] = useState<Mode>('ranges')
  const [rangesInput, setRangesInput] = useState('')
  const [chunkSize, setChunkSize] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const baseName = (fileName ?? 'document').replace(/\.pdf$/i, '')

  // Preview the ranges so the user can see what they'll get before splitting.
  let preview: { ranges: Range[]; error?: string } = { ranges: [] }
  if (mode === 'ranges') {
    try {
      preview = { ranges: rangesInput.trim() ? parseRanges(rangesInput, pageCount) : [] }
    } catch (err) {
      preview = { ranges: [], error: (err as Error).message }
    }
  } else {
    const n = Math.max(1, Math.floor(chunkSize) || 1)
    const ranges: Range[] = []
    for (let i = 1; i <= pageCount; i += n) {
      ranges.push({ start: i, end: Math.min(i + n - 1, pageCount) })
    }
    preview = { ranges }
  }

  const handleCancel = () => {
    if (busy) return
    setError(null)
    setBusy(false)
    onCancel()
  }

  const doSplit = async () => {
    if (!bytes) return
    if (preview.error || preview.ranges.length === 0) {
      setError(preview.error ?? 'No valid ranges to split.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const outputs: Array<{ name: string; bytes: ArrayBuffer }> = []
      for (let i = 0; i < preview.ranges.length; i++) {
        const r = preview.ranges[i]
        const indices: number[] = []
        for (let p = r.start - 1; p <= r.end - 1; p++) indices.push(p)
        const target = await PDFDocument.create()
        const copied = await target.copyPages(source, indices)
        copied.forEach((p) => target.addPage(p))
        const data = await target.save()
        const label = mode === 'ranges'
          ? r.start === r.end ? `${baseName}-p${r.start}.pdf` : `${baseName}-p${r.start}-${r.end}.pdf`
          : `${baseName}-part-${String(i + 1).padStart(2, '0')}.pdf`
        outputs.push({
          name: label,
          bytes: data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
          ) as ArrayBuffer
        })
      }
      const result = await window.akv.saveMany(outputs)
      if (result) {
        onDone(result.paths.length, result.dir)
      } else {
        setBusy(false)
      }
    } catch (err) {
      setError(`Split failed: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  const totalPages = preview.ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0)

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal split-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Split PDF</h2>
        <p className="muted">
          {fileName} • {pageCount} pages
        </p>

        <div className="split-modes">
          <label className={'split-mode' + (mode === 'ranges' ? ' selected' : '')}>
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'ranges'}
              onChange={() => setMode('ranges')}
            />
            <div className="split-mode-body">
              <div className="split-mode-title">Custom ranges</div>
              <div className="split-mode-desc">
                One file per range. Example: <code>1-3, 5, 7-9</code>
              </div>
              {mode === 'ranges' && (
                <input
                  type="text"
                  placeholder="1-3, 5, 7-9"
                  value={rangesInput}
                  onChange={(e) => setRangesInput(e.target.value)}
                  autoFocus
                  style={{ width: '100%', marginTop: 8 }}
                />
              )}
            </div>
          </label>

          <label className={'split-mode' + (mode === 'chunks' ? ' selected' : '')}>
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'chunks'}
              onChange={() => setMode('chunks')}
            />
            <div className="split-mode-body">
              <div className="split-mode-title">Every N pages</div>
              <div className="split-mode-desc">
                Splits the document into evenly-sized chunks.
              </div>
              {mode === 'chunks' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={chunkSize}
                    onChange={(e) => setChunkSize(parseInt(e.target.value, 10) || 1)}
                    style={{ width: 80 }}
                  />
                  <span className="muted">pages per file</span>
                </div>
              )}
            </div>
          </label>
        </div>

        {preview.error ? (
          <div className="merge-error">{preview.error}</div>
        ) : preview.ranges.length > 0 ? (
          <div className="split-preview">
            Will create <strong>{preview.ranges.length}</strong> file
            {preview.ranges.length === 1 ? '' : 's'} covering{' '}
            <strong>{totalPages}</strong> page{totalPages === 1 ? '' : 's'}.
          </div>
        ) : null}

        {error && <div className="merge-error">{error}</div>}

        <div className="actions">
          <button onClick={handleCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !!preview.error || preview.ranges.length === 0}
            onClick={doSplit}
          >
            <Scissors size={14} /> {busy ? 'Splitting…' : 'Split & Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function parseRanges(input: string, max: number): Range[] {
  const result: Range[] = []
  const parts = input.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error('Enter at least one range.')
  for (const p of parts) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(p)
    if (!m) throw new Error(`"${p}" isn't a valid range. Use formats like 1-5 or 7.`)
    const s = parseInt(m[1], 10)
    const e = m[2] ? parseInt(m[2], 10) : s
    if (s < 1 || e < 1) throw new Error(`Range "${p}": pages start at 1.`)
    if (s > max || e > max) {
      throw new Error(`Range "${p}" goes past the last page (${max}).`)
    }
    if (s > e) throw new Error(`Range "${p}": start must come before end.`)
    result.push({ start: s, end: e })
  }
  return result
}

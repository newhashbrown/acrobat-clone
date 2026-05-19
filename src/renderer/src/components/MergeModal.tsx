import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { ChevronUp, ChevronDown, X, FilePlus, Files } from 'lucide-react'

interface MergeFile {
  id: string
  name: string
  path: string
  bytes: ArrayBuffer
  pageCount: number
}

interface Props {
  open: boolean
  onCancel: () => void
  onMerged: (path: string) => void
}

export function MergeModal({ open, onCancel, onMerged }: Props) {
  const [files, setFiles] = useState<MergeFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const reset = () => {
    setFiles([])
    setError(null)
    setBusy(false)
  }

  const handleCancel = () => {
    reset()
    onCancel()
  }

  const addFiles = async () => {
    setError(null)
    const opened = await window.akv.openPdfs()
    if (!opened) return
    try {
      const additions: MergeFile[] = []
      for (const f of opened) {
        const doc = await PDFDocument.load(f.bytes, { ignoreEncryption: true })
        additions.push({
          id: crypto.randomUUID(),
          name: f.name,
          path: f.path,
          bytes: f.bytes,
          pageCount: doc.getPageCount()
        })
      }
      setFiles((prev) => [...prev, ...additions])
    } catch (err) {
      setError(`Couldn't read one of the PDFs: ${(err as Error).message}`)
    }
  }

  const move = (id: string, dir: -1 | 1) => {
    setFiles((prev) => {
      const idx = prev.findIndex((f) => f.id === id)
      const ni = idx + dir
      if (idx < 0 || ni < 0 || ni >= prev.length) return prev
      const next = prev.slice()
      ;[next[idx], next[ni]] = [next[ni], next[idx]]
      return next
    })
  }

  const remove = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id))

  const doMerge = async () => {
    if (files.length < 2) {
      setError('Add at least two PDFs to combine.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const merged = await PDFDocument.create()
      for (const f of files) {
        const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true })
        const copied = await merged.copyPages(src, src.getPageIndices())
        copied.forEach((p) => merged.addPage(p))
      }
      const out = await merged.save()
      const buf = out.buffer.slice(
        out.byteOffset,
        out.byteOffset + out.byteLength
      ) as ArrayBuffer
      const result = await window.akv.savePdf(buf, suggestName(files))
      if (result) {
        onMerged(result.path)
        reset()
      } else {
        setBusy(false)
      }
    } catch (err) {
      setError(`Merge failed: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  const totalPages = files.reduce((sum, f) => sum + f.pageCount, 0)

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal merge-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Combine PDFs</h2>
        <p className="muted">
          Add two or more PDFs in the order you want them. Reorder with the arrows.
        </p>

        <div className="merge-list">
          {files.length === 0 ? (
            <div className="merge-empty">
              <Files size={36} />
              <span>No files added yet</span>
            </div>
          ) : (
            files.map((f, i) => (
              <div className="merge-row" key={f.id}>
                <span className="merge-index">{i + 1}</span>
                <div className="merge-info">
                  <div className="merge-name" title={f.path}>
                    {f.name}
                  </div>
                  <div className="merge-meta">
                    {f.pageCount} page{f.pageCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="merge-controls">
                  <button
                    title="Move up"
                    onClick={() => move(f.id, -1)}
                    disabled={i === 0 || busy}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    title="Move down"
                    onClick={() => move(f.id, 1)}
                    disabled={i === files.length - 1 || busy}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button title="Remove" onClick={() => remove(f.id)} disabled={busy}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="merge-footer">
          <button onClick={addFiles} disabled={busy}>
            <FilePlus size={14} /> Add PDFs…
          </button>
          {files.length > 0 && (
            <span className="muted">
              {files.length} file{files.length === 1 ? '' : 's'} • {totalPages} pages total
            </span>
          )}
        </div>

        {error && <div className="merge-error">{error}</div>}

        <div className="actions">
          <button onClick={handleCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={files.length < 2 || busy}
            onClick={doMerge}
          >
            {busy ? 'Combining…' : 'Combine & Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function suggestName(files: MergeFile[]): string {
  if (files.length === 0) return 'combined.pdf'
  const base = files[0].name.replace(/\.pdf$/i, '')
  return `${base}-combined.pdf`
}

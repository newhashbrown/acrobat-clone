import { useState } from 'react'
import { GitCompare, FilePlus } from 'lucide-react'
import { loadPdf } from '../pdf'

interface Props {
  open: boolean
  leftName: string | null
  onCancel: () => void
  onReady: (right: { doc: Awaited<ReturnType<typeof loadPdf>>; name: string }) => void
}

export function CompareModal({ open, leftName, onCancel, onReady }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ name: string; bytes: ArrayBuffer } | null>(null)

  if (!open) return null

  const handleCancel = () => {
    setError(null)
    setPicked(null)
    onCancel()
  }

  const pick = async () => {
    setError(null)
    const res = await window.akv.openPdfs()
    if (!res || res.length === 0) return
    setPicked({ name: res[0].name, bytes: res[0].bytes })
  }

  const start = async () => {
    if (!picked) return
    setBusy(true)
    try {
      const doc = await loadPdf(picked.bytes)
      onReady({ doc, name: picked.name })
    } catch (err) {
      setError(`Couldn't open ${picked.name}: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : handleCancel}>
      <div className="modal compare-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Compare PDFs</h2>
        <p className="muted">
          Comparing against currently open document: <strong>{leftName ?? '—'}</strong>
        </p>

        <div className="compare-pick">
          <div className="compare-pick-label">Second document</div>
          {picked ? (
            <div className="compare-pick-row">
              <span className="merge-name" title={picked.name}>
                {picked.name}
              </span>
              <button onClick={pick} disabled={busy}>
                Change…
              </button>
            </div>
          ) : (
            <button onClick={pick} disabled={busy}>
              <FilePlus size={14} /> Choose PDF…
            </button>
          )}
        </div>

        {error && <div className="merge-error">{error}</div>}

        <div className="actions">
          <button onClick={handleCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={!picked || busy} onClick={start}>
            <GitCompare size={14} /> {busy ? 'Opening…' : 'Compare'}
          </button>
        </div>
      </div>
    </div>
  )
}

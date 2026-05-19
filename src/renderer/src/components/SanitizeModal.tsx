import { useEffect, useState } from 'react'
import { ShieldCheck, AlertTriangle } from 'lucide-react'
import { preScan, sanitize, type PreScanReport, type SanitizeOptions } from '../sanitize'

interface Props {
  open: boolean
  bytes: ArrayBuffer | null
  fileName: string | null
  onCancel: () => void
  onDone: (summary: string) => void
}

interface Category {
  key: keyof SanitizeOptions
  title: string
  description: string
  count: (r: PreScanReport) => number
  detail: (r: PreScanReport) => string | null
}

const CATEGORIES: Category[] = [
  {
    key: 'metadata',
    title: 'Document metadata',
    description: 'Title, author, subject, creator app, dates, XMP packet.',
    count: (r) => r.metadata.length + (r.hasXmp ? 1 : 0),
    detail: (r) => {
      const fields = r.metadata.map((m) => `${m.key}: ${m.value}`)
      if (r.hasXmp) fields.push('XMP metadata packet')
      return fields.length ? fields.join(' · ') : null
    }
  },
  {
    key: 'bookmarks',
    title: 'Bookmarks / outline',
    description: 'Document outline tree shown in the sidebar.',
    count: (r) => r.bookmarks,
    detail: (r) => (r.bookmarks ? `${r.bookmarks} bookmark${r.bookmarks === 1 ? '' : 's'}` : null)
  },
  {
    key: 'javascript',
    title: 'JavaScript & actions',
    description: 'Embedded scripts, open actions, additional actions.',
    count: (r) =>
      r.javascript.namedScripts + r.javascript.additionalActions + (r.javascript.openAction ? 1 : 0),
    detail: (r) => {
      const bits: string[] = []
      if (r.javascript.namedScripts) bits.push(`${r.javascript.namedScripts} named script(s)`)
      if (r.javascript.openAction) bits.push('open action')
      if (r.javascript.additionalActions)
        bits.push(`${r.javascript.additionalActions} additional action(s)`)
      return bits.length ? bits.join(' · ') : null
    }
  },
  {
    key: 'annotations',
    title: 'Annotations & comments',
    description: 'Highlights, sticky notes, ink, popup comments.',
    count: (r) => r.annotations.total,
    detail: (r) => {
      if (!r.annotations.total) return null
      const pages = Object.keys(r.annotations.perPage).length
      return `${r.annotations.total} on ${pages} page${pages === 1 ? '' : 's'}`
    }
  },
  {
    key: 'formData',
    title: 'Form fields',
    description: 'Fillable fields will be flattened to their visible value, then removed.',
    count: (r) => r.formFields,
    detail: (r) => (r.formFields ? `${r.formFields} field${r.formFields === 1 ? '' : 's'}` : null)
  },
  {
    key: 'attachments',
    title: 'File attachments',
    description: 'Embedded files attached to the PDF.',
    count: (r) => r.attachments.length,
    detail: (r) =>
      r.attachments.length
        ? r.attachments.slice(0, 5).join(', ') + (r.attachments.length > 5 ? '…' : '')
        : null
  }
]

export function SanitizeModal({ open, bytes, fileName, onCancel, onDone }: Props) {
  const [scan, setScan] = useState<PreScanReport | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [opts, setOpts] = useState<SanitizeOptions>({
    metadata: true,
    bookmarks: false,
    javascript: true,
    annotations: false,
    formData: false,
    attachments: true
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !bytes) {
      setScan(null)
      setScanError(null)
      return
    }
    setScan(null)
    setScanError(null)
    preScan(bytes)
      .then(setScan)
      .catch((err) => setScanError((err as Error).message))
  }, [open, bytes])

  if (!open) return null

  const allOn = (val: boolean) =>
    setOpts({
      metadata: val,
      bookmarks: val,
      javascript: val,
      annotations: val,
      formData: val,
      attachments: val
    })

  const apply = async () => {
    if (!bytes || !fileName) return
    if (!Object.values(opts).some(Boolean)) {
      setError('Pick at least one category to remove.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { bytes: out, audit } = await sanitize(bytes, opts)
      const buf = out.buffer.slice(
        out.byteOffset,
        out.byteOffset + out.byteLength
      ) as ArrayBuffer
      const suggested = fileName.replace(/\.pdf$/i, '') + '-sanitized.pdf'
      const result = await window.akv.savePdf(buf, suggested)
      if (result) {
        const summary = summarize(audit)
        onDone(`Sanitized and saved to ${result.path}. ${summary}`)
      } else {
        setBusy(false)
      }
    } catch (err) {
      setError(`Sanitize failed: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  const totalToRemove = scan
    ? CATEGORIES.reduce((sum, c) => sum + (opts[c.key] ? c.count(scan) : 0), 0)
    : 0

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal sanitize-modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          <ShieldCheck size={18} style={{ verticalAlign: 'text-bottom' }} /> Sanitize PDF
        </h2>
        <p className="muted">
          Remove sensitive content before sharing. Output goes to a separate file so the
          original stays untouched.
        </p>

        {scanError && <div className="merge-error">Couldn't scan: {scanError}</div>}

        {!scan && !scanError && <div className="muted">Scanning document…</div>}

        {scan && (
          <>
            <div className="sanitize-actions-row">
              <button onClick={() => allOn(true)}>Select all</button>
              <button onClick={() => allOn(false)}>Clear</button>
            </div>
            <div className="sanitize-list">
              {CATEGORIES.map((c) => {
                const count = c.count(scan)
                const detail = c.detail(scan)
                const hasItems = count > 0
                return (
                  <label
                    key={c.key}
                    className={
                      'sanitize-row' + (opts[c.key] ? ' on' : '') + (!hasItems ? ' empty' : '')
                    }
                  >
                    <input
                      type="checkbox"
                      checked={opts[c.key]}
                      onChange={(e) =>
                        setOpts((prev) => ({ ...prev, [c.key]: e.target.checked }))
                      }
                      disabled={!hasItems || busy}
                    />
                    <div className="sanitize-row-body">
                      <div className="sanitize-row-title">
                        {c.title}
                        <span className={'sanitize-count' + (hasItems ? ' active' : '')}>
                          {hasItems ? count : 'none'}
                        </span>
                      </div>
                      <div className="sanitize-row-desc">{c.description}</div>
                      {detail && <div className="sanitize-row-detail">{detail}</div>}
                    </div>
                  </label>
                )
              })}
            </div>
          </>
        )}

        {error && <div className="merge-error">{error}</div>}

        {scan && totalToRemove > 0 && !error && (
          <div className="sanitize-preview">
            <AlertTriangle size={14} /> Will remove <strong>{totalToRemove}</strong> item
            {totalToRemove === 1 ? '' : 's'} across {scannedCategories(scan, opts)} categor
            {scannedCategories(scan, opts) === 1 ? 'y' : 'ies'}.
          </div>
        )}

        <div className="actions">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !scan || totalToRemove === 0}
            onClick={apply}
          >
            {busy ? 'Sanitizing…' : 'Sanitize & Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function scannedCategories(scan: PreScanReport, opts: SanitizeOptions): number {
  return CATEGORIES.filter((c) => opts[c.key] && c.count(scan) > 0).length
}

function summarize(audit: import('../sanitize').AuditReport): string {
  const parts: string[] = []
  if (audit.metadata.fieldsCleared.length || audit.metadata.xmpRemoved) {
    const n = audit.metadata.fieldsCleared.length + (audit.metadata.xmpRemoved ? 1 : 0)
    parts.push(`${n} metadata item(s)`)
  }
  if (audit.bookmarks) parts.push(`${audit.bookmarks} bookmark(s)`)
  const jsTotal =
    audit.javascript.namedScripts +
    audit.javascript.additionalActions +
    (audit.javascript.openAction ? 1 : 0)
  if (jsTotal) parts.push(`${jsTotal} script/action(s)`)
  if (audit.annotations.total) parts.push(`${audit.annotations.total} annotation(s)`)
  if (audit.formData.fields)
    parts.push(`${audit.formData.fields} form field(s)${audit.formData.flattened ? ' (flattened)' : ''}`)
  if (audit.attachments.length) parts.push(`${audit.attachments.length} attachment(s)`)
  return parts.length ? `Removed ${parts.join(', ')}.` : 'Nothing to remove.'
}

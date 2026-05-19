import { useEffect, useRef, useState } from 'react'
import { Languages, ScanText } from 'lucide-react'
import { OCR_LANGUAGES, OcrSession } from '../ocr'
import { parseRanges } from './SplitModal'
import { useViewer } from '../store'
import type { PDFDocumentProxy } from '../pdf'

type Scope = 'current' | 'all' | 'range'

interface Props {
  open: boolean
  doc: PDFDocumentProxy | null
  pageCount: number
  currentPage: number
  onCancel: () => void
  onDone: (pages: number) => void
}

export function OcrModal({
  open,
  doc,
  pageCount,
  currentPage,
  onCancel,
  onDone
}: Props) {
  const setOcrResult = useViewer((s) => s.setOcrResult)
  const [scope, setScope] = useState<Scope>('current')
  const [rangeInput, setRangeInput] = useState('1-' + pageCount)
  const [lang, setLang] = useState('eng')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<string>('')
  const [progressPct, setProgressPct] = useState(0)
  const [pageProgress, setPageProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<OcrSession | null>(null)

  useEffect(() => {
    if (open) setRangeInput('1-' + pageCount)
  }, [open, pageCount])

  if (!open) return null

  const reset = () => {
    setBusy(false)
    setPhase('')
    setProgressPct(0)
    setPageProgress(null)
    setError(null)
  }

  const handleCancel = async () => {
    sessionRef.current?.cancel()
    await sessionRef.current?.destroy()
    sessionRef.current = null
    reset()
    onCancel()
  }

  const computePages = (): number[] => {
    if (scope === 'current') return [currentPage]
    if (scope === 'all') return Array.from({ length: pageCount }, (_, i) => i + 1)
    // custom range
    const ranges = parseRanges(rangeInput, pageCount)
    const pages = new Set<number>()
    for (const r of ranges) for (let p = r.start; p <= r.end; p++) pages.add(p)
    return [...pages].sort((a, b) => a - b)
  }

  const run = async () => {
    if (!doc) return
    let pages: number[]
    try {
      pages = computePages()
      if (pages.length === 0) throw new Error('No pages selected.')
    } catch (err) {
      setError((err as Error).message)
      return
    }
    setError(null)
    setBusy(true)
    setPageProgress({ done: 0, total: pages.length })
    setPhase('Loading language model…')

    const session = new OcrSession()
    sessionRef.current = session
    try {
      await session.init(lang, (p) => {
        if (p.kind === 'loading') {
          setPhase(humanStatus(p.message))
          setProgressPct(Math.round((p.progress ?? 0) * 100))
        }
      })

      let completed = 0
      for (const pageNumber of pages) {
        setPhase(`Recognizing page ${pageNumber}…`)
        setProgressPct(0)
        const result = await session.recognizePage(doc, pageNumber, 2)
        if (!result) {
          // cancelled
          break
        }
        setOcrResult(result)
        completed += 1
        setPageProgress({ done: completed, total: pages.length })
      }

      await session.destroy()
      sessionRef.current = null

      if (completed > 0) onDone(completed)
      else reset()
    } catch (err) {
      setError((err as Error).message)
      await session.destroy()
      sessionRef.current = null
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : handleCancel}>
      <div className="modal ocr-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Recognize Text</h2>
        <p className="muted">
          Runs OCR locally. The first run downloads the language model (~12 MB).
        </p>

        <div className="ocr-section">
          <h3>Pages</h3>
          <label className="ocr-radio">
            <input
              type="radio"
              name="ocr-scope"
              checked={scope === 'current'}
              onChange={() => setScope('current')}
              disabled={busy}
            />
            Current page (page {currentPage})
          </label>
          <label className="ocr-radio">
            <input
              type="radio"
              name="ocr-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
              disabled={busy}
            />
            All pages ({pageCount})
          </label>
          <label className="ocr-radio">
            <input
              type="radio"
              name="ocr-scope"
              checked={scope === 'range'}
              onChange={() => setScope('range')}
              disabled={busy}
            />
            Custom range
            {scope === 'range' && (
              <input
                type="text"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder="1-5, 7"
                disabled={busy}
                style={{ marginLeft: 8, width: 140 }}
              />
            )}
          </label>
        </div>

        <div className="ocr-section">
          <h3>
            <Languages size={14} style={{ verticalAlign: 'text-bottom' }} /> Language
          </h3>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={busy}
            className="ocr-lang"
          >
            {OCR_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {busy && (
          <div className="ocr-progress">
            <div className="ocr-progress-row">
              <span>{phase}</span>
              {pageProgress && (
                <span className="muted">
                  {pageProgress.done} / {pageProgress.total} pages
                </span>
              )}
            </div>
            <div className="ocr-bar">
              <div className="ocr-bar-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {error && <div className="merge-error">{error}</div>}

        <div className="actions">
          <button onClick={handleCancel}>{busy ? 'Cancel' : 'Close'}</button>
          {!busy && (
            <button className="primary" onClick={run} disabled={!doc}>
              <ScanText size={14} /> Recognize
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function humanStatus(s: string): string {
  switch (s) {
    case 'loading tesseract core':
      return 'Loading OCR engine…'
    case 'initializing tesseract':
      return 'Initialising OCR engine…'
    case 'loading language traineddata':
    case 'loading language traineddata (from cache)':
      return 'Downloading language model…'
    case 'initializing api':
      return 'Preparing recognizer…'
    case 'recognizing text':
      return 'Recognizing text…'
    default:
      return s.charAt(0).toUpperCase() + s.slice(1)
  }
}

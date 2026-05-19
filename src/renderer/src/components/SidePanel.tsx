import { useEffect, useMemo, useState } from 'react'
import type { PDFDocumentProxy } from '../pdf'
import { useViewer } from '../store'
import { DiffPanel } from './DiffPanel'

interface Props {
  doc: PDFDocumentProxy
}

export function SidePanel({ doc }: Props) {
  const which = useViewer((s) => s.sidePanel)
  const compareDoc = useViewer((s) => s.compareDoc)
  if (which === 'metadata') return <MetadataPanel />
  if (which === 'search') return <SearchPanel doc={doc} />
  if (which === 'ocr') return <OcrPanel />
  if (which === 'diff' && compareDoc) return <DiffPanel left={doc} right={compareDoc} />
  return null
}

function OcrPanel() {
  const ocrResults = useViewer((s) => s.ocrResults)
  const currentPage = useViewer((s) => s.currentPage)
  const setPage = useViewer((s) => s.setPage)
  const clearOcrResults = useViewer((s) => s.clearOcrResults)
  const pageNumbers = Object.keys(ocrResults)
    .map(Number)
    .sort((a, b) => a - b)
  const active = ocrResults[currentPage]

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div className="panel">
      <h3>Recognized Text</h3>
      {pageNumbers.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          No OCR results yet. Use File → Recognize Text… (Ctrl+Shift+O) to scan pages.
        </div>
      ) : (
        <>
          <div className="row">
            <span className="k">Pages OCR'd</span>
            <span className="v">
              {pageNumbers.length === 1
                ? `Page ${pageNumbers[0]}`
                : pageNumbers.length <= 6
                  ? pageNumbers.join(', ')
                  : `${pageNumbers.length} pages`}
            </span>
          </div>
          {active ? (
            <>
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <button onClick={() => copy(active.text)}>Copy this page</button>
                <button
                  onClick={() =>
                    copy(pageNumbers.map((n) => ocrResults[n].text).join('\n\n'))
                  }
                >
                  Copy all
                </button>
              </div>
              <pre className="ocr-text">{active.text || '(no text detected)'}</pre>
            </>
          ) : (
            <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
              No OCR result for page {currentPage}. Jump to one of these:{' '}
              {pageNumbers.slice(0, 12).map((n, i) => (
                <span key={n}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      setPage(n)
                    }}
                  >
                    {n}
                  </a>
                  {i < Math.min(12, pageNumbers.length) - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <button onClick={clearOcrResults}>Clear all OCR data</button>
          </div>
        </>
      )}
    </div>
  )
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

function fmtPdfDate(s?: string): string | undefined {
  if (!s) return undefined
  // Acrobat date strings: D:YYYYMMDDHHmmSSOHH'mm'
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(s)
  if (!m) return s
  const [, y, mo, d, h, mi] = m
  return `${y}-${mo}-${d}${h ? ' ' + h + ':' + (mi ?? '00') : ''}`
}

function MetadataPanel() {
  const metadata = useViewer((s) => s.metadata)
  const fileSize = useViewer((s) => s.fileSize)
  const filePath = useViewer((s) => s.filePath)
  if (!metadata) return null

  const rows: Array<[string, string | undefined]> = [
    ['Title', metadata.title],
    ['Author', metadata.author],
    ['Subject', metadata.subject],
    ['Keywords', metadata.keywords],
    ['Creator', metadata.creator],
    ['Producer', metadata.producer],
    ['Created', fmtPdfDate(metadata.creationDate)],
    ['Modified', fmtPdfDate(metadata.modificationDate)],
    ['Pages', String(metadata.pageCount)],
    ['File size', fmtBytes(fileSize)],
    ['Path', filePath ?? undefined]
  ]

  return (
    <div className="panel">
      <h3>Document Info</h3>
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span className="k">{k}</span>
          <span className="v" title={v ?? ''}>
            {v ?? '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

interface SearchHit {
  pageNumber: number
  context: string // already has highlight markers (\x01 / \x02)
}

function SearchPanel({ doc }: { doc: PDFDocumentProxy }) {
  const setPage = useViewer((s) => s.setPage)
  const searchQuery = useViewer((s) => s.searchQuery)
  const setSearchQuery = useViewer((s) => s.setSearchQuery)
  const [query, setQuery] = useState(searchQuery)
  const [results, setResults] = useState<SearchHit[]>([])
  const [running, setRunning] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)

  useEffect(() => {
    setQuery(searchQuery)
  }, [searchQuery])

  // Debounce search
  const debounced = useDebounced(query, 200)

  useEffect(() => {
    let cancelled = false
    if (!debounced.trim()) {
      setResults([])
      return
    }
    setRunning(true)
    ;(async () => {
      const needle = debounced.toLowerCase()
      const hits: SearchHit[] = []
      for (let p = 1; p <= doc.numPages; p++) {
        if (cancelled) return
        const page = await doc.getPage(p)
        const tc = await page.getTextContent()
        const text = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ')
        const lower = text.toLowerCase()
        let from = 0
        while (true) {
          const idx = lower.indexOf(needle, from)
          if (idx < 0) break
          const start = Math.max(0, idx - 30)
          const end = Math.min(text.length, idx + needle.length + 30)
          const before = text.slice(start, idx)
          const hit = text.slice(idx, idx + needle.length)
          const after = text.slice(idx + needle.length, end)
          hits.push({
            pageNumber: p,
            context: `${start > 0 ? '…' : ''}${before}\x01${hit}\x02${after}${end < text.length ? '…' : ''}`
          })
          from = idx + needle.length
          if (hits.length > 200) break
        }
        if (hits.length > 200) break
      }
      if (!cancelled) {
        setResults(hits)
        setActiveIdx(hits.length ? 0 : -1)
        setRunning(false)
      }
    })().catch((err) => {
      console.error('search failed', err)
      if (!cancelled) setRunning(false)
    })
    return () => {
      cancelled = true
    }
  }, [debounced, doc])

  const jump = (i: number) => {
    setActiveIdx(i)
    setPage(results[i].pageNumber)
  }

  return (
    <div className="panel">
      <h3>Search</h3>
      <input
        type="search"
        className="search-input"
        placeholder="Find in document…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSearchQuery(e.target.value)
        }}
        autoFocus
      />
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
        {running
          ? 'Searching…'
          : results.length
            ? `${results.length} match${results.length === 1 ? '' : 'es'}`
            : query
              ? 'No matches'
              : ''}
      </div>
      <div className="match-list">
        {results.map((hit, i) => (
          <div
            key={i}
            className={'match' + (i === activeIdx ? ' active' : '')}
            onClick={() => jump(i)}
          >
            <div>Page {hit.pageNumber}</div>
            <div className="ctx">{renderContext(hit.context)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function renderContext(s: string) {
  const parts: Array<string | { hit: string }> = []
  let i = 0
  while (i < s.length) {
    const open = s.indexOf('\x01', i)
    if (open < 0) {
      parts.push(s.slice(i))
      break
    }
    if (open > i) parts.push(s.slice(i, open))
    const close = s.indexOf('\x02', open)
    if (close < 0) break
    parts.push({ hit: s.slice(open + 1, close) })
    i = close + 1
  }
  return parts.map((p, idx) =>
    typeof p === 'string' ? <span key={idx}>{p}</span> : <em key={idx}>{p.hit}</em>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from '../pdf'
import { compareDocuments, type DocDiff } from '../diff'
import { useViewer } from '../store'

interface Props {
  left: PDFDocumentProxy
  right: PDFDocumentProxy
}

export function DiffPanel({ left, right }: Props) {
  const currentPage = useViewer((s) => s.currentPage)
  const setPage = useViewer((s) => s.setPage)
  const [diff, setDiff] = useState<DocDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'changed'>('changed')

  useEffect(() => {
    let cancelled = false
    setError(null)
    setDiff(null)
    compareDocuments(left, right)
      .then((d) => {
        if (!cancelled) setDiff(d)
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [left, right])

  if (error) return <div className="panel"><h3>Comparison failed</h3><div>{error}</div></div>
  if (!diff)
    return (
      <div className="panel">
        <h3>Comparing…</h3>
        <div className="muted">Extracting and diffing text on every page.</div>
      </div>
    )

  const currentPageDiff = diff.pages.find((p) => p.pageNumber === currentPage)
  const visiblePages = filter === 'all'
    ? diff.pages
    : diff.pages.filter((p) => !p.unchanged)

  return (
    <div className="panel diff-panel">
      <h3>Comparison Summary</h3>
      <div className="diff-stats">
        <div>
          <span className="diff-added">+{diff.totalAdded}</span> added
        </div>
        <div>
          <span className="diff-removed">−{diff.totalRemoved}</span> removed
        </div>
        <div>
          <span className="muted">{diff.totalUnchanged}</span> unchanged
        </div>
      </div>

      <div className="diff-filter">
        <label>
          <input
            type="radio"
            checked={filter === 'changed'}
            onChange={() => setFilter('changed')}
          />
          Only changed ({diff.pages.filter((p) => !p.unchanged).length})
        </label>
        <label>
          <input
            type="radio"
            checked={filter === 'all'}
            onChange={() => setFilter('all')}
          />
          All pages ({diff.pages.length})
        </label>
      </div>

      <h3 style={{ marginTop: 16 }}>This page</h3>
      {currentPageDiff ? (
        <DiffRenderer diff={currentPageDiff.changes} />
      ) : (
        <div className="muted">No diff for page {currentPage}.</div>
      )}

      <h3 style={{ marginTop: 16 }}>Pages</h3>
      <div className="diff-pagelist">
        {visiblePages.length === 0 ? (
          <div className="muted">No changes found.</div>
        ) : (
          visiblePages.map((p) => (
            <div
              key={p.pageNumber}
              className={
                'diff-page-row' + (p.pageNumber === currentPage ? ' active' : '')
              }
              onClick={() => setPage(p.pageNumber)}
            >
              <span>Page {p.pageNumber}</span>
              {p.unchanged ? (
                <span className="muted">unchanged</span>
              ) : (
                <span>
                  <span className="diff-added">+{p.addedWords}</span>{' '}
                  <span className="diff-removed">−{p.removedWords}</span>
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function DiffRenderer({ diff }: { diff: Array<{ value: string; added?: boolean; removed?: boolean }> }) {
  return (
    <div className="diff-inline">
      {diff.map((c, i) =>
        c.added ? (
          <ins key={i}>{c.value}</ins>
        ) : c.removed ? (
          <del key={i}>{c.value}</del>
        ) : (
          <span key={i}>{c.value}</span>
        )
      )}
    </div>
  )
}

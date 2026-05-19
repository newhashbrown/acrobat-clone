import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from '../pdf'
import { useViewer } from '../store'

interface Props {
  doc: PDFDocumentProxy
}

export function Thumbnails({ doc }: Props) {
  const currentPage = useViewer((s) => s.currentPage)
  const pageCount = useViewer((s) => s.pageCount)
  const setPage = useViewer((s) => s.setPage)
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll the active thumb into view when current page changes.
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const el = c.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentPage])

  return (
    <div className="sidebar" ref={containerRef}>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
        <ThumbItem
          key={n}
          doc={doc}
          pageNumber={n}
          active={n === currentPage}
          onClick={() => setPage(n)}
        />
      ))}
    </div>
  )
}

function ThumbItem({
  doc,
  pageNumber,
  active,
  onClick
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  active: boolean
  onClick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale: 0.25 })
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
  }, [doc, pageNumber])

  return (
    <div
      className={'thumb' + (active ? ' active' : '')}
      data-thumb={pageNumber}
      onClick={onClick}
    >
      <canvas ref={canvasRef} />
      <div className="label">{pageNumber}</div>
    </div>
  )
}

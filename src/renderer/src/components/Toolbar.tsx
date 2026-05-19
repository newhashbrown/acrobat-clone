import { useEffect, useState } from 'react'
import {
  FolderOpen,
  Save,
  Printer,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Columns2,
  FileText,
  Rows,
  Search,
  Info,
  PenTool,
  Highlighter,
  ScanText
} from 'lucide-react'
import { useViewer } from '../store'

interface Props {
  onOpen: () => void
  onSaveCopy: () => void
  onPrint: () => void
  onSign: () => void
  onRedact: () => void
  onOcr: () => void
}

export function Toolbar({
  onOpen,
  onSaveCopy,
  onPrint,
  onSign,
  onRedact,
  onOcr
}: Props) {
  const {
    doc,
    fileName,
    currentPage,
    pageCount,
    zoom,
    fitMode,
    viewMode,
    redactMode,
    setPage,
    zoomIn,
    zoomOut,
    setFitMode,
    setViewMode,
    toggleSidePanel
  } = useViewer()
  const [pageInput, setPageInput] = useState(String(currentPage))

  // Sync the input when the current page changes externally (thumbnails, prev/next,
  // keyboard nav). Doing this in an effect — not during render — so the user can
  // still type freely without their keystrokes being clobbered on every render.
  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const commitPage = () => {
    const n = parseInt(pageInput, 10)
    if (!isNaN(n)) setPage(n)
    else setPageInput(String(currentPage))
  }

  const zoomPct = Math.round(zoom * 100) + '%'
  const hasDoc = !!doc

  return (
    <div className="toolbar">
      <div className="group">
        <button title="Open (Ctrl+O)" onClick={onOpen}>
          <FolderOpen size={16} /> Open
        </button>
        <button title="Save Copy (Ctrl+S)" onClick={onSaveCopy} disabled={!hasDoc}>
          <Save size={16} />
        </button>
        <button title="Print (Ctrl+P)" onClick={onPrint} disabled={!hasDoc}>
          <Printer size={16} />
        </button>
      </div>

      <div className="divider" />

      <div className="group">
        <button
          title="Previous page"
          onClick={() => setPage(currentPage - 1)}
          disabled={!hasDoc || currentPage <= 1}
        >
          <ChevronLeft size={16} />
        </button>
        <input
          type="text"
          className="page-input"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          disabled={!hasDoc}
        />
        <span className="zoom-display">/ {pageCount || '–'}</span>
        <button
          title="Next page"
          onClick={() => setPage(currentPage + 1)}
          disabled={!hasDoc || currentPage >= pageCount}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="divider" />

      <div className="group">
        <button title="Zoom out (Ctrl+-)" onClick={zoomOut} disabled={!hasDoc}>
          <ZoomOut size={16} />
        </button>
        <span className="zoom-display">{zoomPct}</span>
        <button title="Zoom in (Ctrl+=)" onClick={zoomIn} disabled={!hasDoc}>
          <ZoomIn size={16} />
        </button>
        <button
          title="Fit width"
          onClick={() => setFitMode('width')}
          disabled={!hasDoc}
          className={fitMode === 'width' ? 'ghost' : ''}
        >
          <Maximize2 size={16} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <button
          title="Fit page"
          onClick={() => setFitMode('page')}
          disabled={!hasDoc}
          className={fitMode === 'page' ? 'ghost' : ''}
        >
          <Maximize2 size={16} />
        </button>
      </div>

      <div className="divider" />

      <div className="group">
        <button
          title="Single page"
          onClick={() => setViewMode('single')}
          disabled={!hasDoc}
          className={viewMode === 'single' ? 'ghost' : ''}
        >
          <FileText size={16} />
        </button>
        <button
          title="Two-up"
          onClick={() => setViewMode('two-up')}
          disabled={!hasDoc}
          className={viewMode === 'two-up' ? 'ghost' : ''}
        >
          <Columns2 size={16} />
        </button>
        <button
          title="Continuous"
          onClick={() => setViewMode('continuous')}
          disabled={!hasDoc}
          className={viewMode === 'continuous' ? 'ghost' : ''}
        >
          <Rows size={16} />
        </button>
      </div>

      <div className="divider" />

      <div className="group">
        <button title="Find (Ctrl+F)" onClick={() => toggleSidePanel('search')} disabled={!hasDoc}>
          <Search size={16} />
        </button>
        <button title="Document info" onClick={() => toggleSidePanel('metadata')} disabled={!hasDoc}>
          <Info size={16} />
        </button>
        <button title="Sign (Ctrl+Shift+S)" onClick={onSign} disabled={!hasDoc}>
          <PenTool size={16} /> Sign
        </button>
        <button
          title="Redact (Ctrl+Shift+R)"
          onClick={onRedact}
          disabled={!hasDoc}
          className={redactMode ? 'redact-active' : ''}
        >
          <Highlighter size={16} /> Redact
        </button>
        <button title="Recognize Text (Ctrl+Shift+O)" onClick={onOcr} disabled={!hasDoc}>
          <ScanText size={16} /> OCR
        </button>
      </div>

      <div className="spacer" />
      <div className="title" title={fileName ?? ''}>
        {fileName ?? 'No document open'}
      </div>
    </div>
  )
}

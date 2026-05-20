import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Files } from 'lucide-react'
import { loadPdf, readMetadata, type PDFDocumentProxy } from './pdf'
import { useViewer, type PlacedSignature } from './store'
import { Toolbar } from './components/Toolbar'
import { Thumbnails } from './components/Thumbnails'
import { SidePanel } from './components/SidePanel'
import { PageRenderer } from './components/PageRenderer'
import { SignatureModal } from './components/SignatureModal'
import { MergeModal } from './components/MergeModal'
import { SplitModal } from './components/SplitModal'
import { OcrModal } from './components/OcrModal'
import { CompareModal } from './components/CompareModal'
import { SanitizeModal } from './components/SanitizeModal'
import { OrganizeMode } from './components/OrganizeMode'
import { findRedactionsInDoc, PATTERN_PRESETS } from './redact-find'
import { stampSignatures } from './sign'
import { countFormFields } from './form'
import type { RecentFile } from '../../preload/index'

export function App() {
  const {
    doc,
    bytes,
    currentPage,
    pageCount,
    zoom,
    fitMode,
    viewMode,
    sidePanel,
    signatures,
    redactions,
    redactMode,
    ocrResults,
    formValues,
    compareDoc,
    compareFileName,
    compareMode,
    fileName,
    setDoc,
    setPage,
    zoomIn,
    zoomOut,
    setZoom,
    setViewMode,
    toggleSidePanel,
    addSignature,
    clearSignatures,
    toggleRedactMode,
    setRedactMode,
    clearRedactions,
    addRedactions,
    clearOcrResults,
    setFormFieldCount,
    clearFormValues,
    setCompareDoc,
    setCompareMode,
    enterOrganize,
    exitOrganize,
    undo,
    redo
  } = useViewer()
  const organizeActive = useViewer((s) => s.organizeActive)
  const canUndo = useViewer((s) => s.undoStack.length > 0)
  const canRedo = useViewer((s) => s.redoStack.length > 0)

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [ocrOpen, setOcrOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [sanitizeOpen, setSanitizeOpen] = useState(false)
  const [redactFindInput, setRedactFindInput] = useState('')
  const [redactPatternId, setRedactPatternId] = useState('')
  const [redactBusy, setRedactBusy] = useState(false)
  const [pendingPlacement, setPendingPlacement] = useState<{
    dataUrl: string
    aspectRatio: number
  } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const viewerRef = useRef<HTMLDivElement>(null)
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    window.akv.recentList().then(setRecentFiles)
  }, [doc])

  // Track viewer container size for fit-to-width/page math.
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewerSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setViewerSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [doc])

  // Ref that the scroll handler sets before publishing a scroll-driven page
  // change. The jump-to-page effect checks and clears it, so user scrolling
  // doesn't get snapped back by the auto-scroll.
  const scrollDrivenPageRef = useRef<number | null>(null)

  // In continuous mode, scroll the main viewer to the active page whenever
  // currentPage changes from an explicit jump (thumbnail, prev/next, keyboard).
  // Skipped when the change originated from the scroll handler below.
  useEffect(() => {
    if (!doc || viewMode !== 'continuous') return
    if (scrollDrivenPageRef.current === currentPage) {
      scrollDrivenPageRef.current = null
      return
    }
    const viewer = viewerRef.current
    if (!viewer) return
    const target = viewer.querySelector<HTMLElement>(`[data-page="${currentPage}"]`)
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [currentPage, viewMode, doc])

  // While scrolling through pages in continuous mode, update currentPage to
  // whichever page sits closest to the top of the viewer. Keeps the thumbnail
  // highlight and toolbar page number in sync with what the user is actually
  // looking at.
  useEffect(() => {
    if (!doc || viewMode !== 'continuous') return
    const viewer = viewerRef.current
    if (!viewer) return
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const wraps = viewer.querySelectorAll<HTMLElement>('[data-page]')
        const top = viewer.scrollTop + 40
        let best = 1
        for (const w of wraps) {
          if (w.offsetTop <= top) best = Number(w.dataset.page)
          else break
        }
        if (best !== useViewer.getState().currentPage) {
          scrollDrivenPageRef.current = best
          useViewer.setState({ currentPage: best })
        }
      })
    }
    viewer.addEventListener('scroll', onScroll, { passive: true })
    return () => viewer.removeEventListener('scroll', onScroll)
  }, [doc, viewMode])

  // Open file by path (used by recent list)
  const openByPath = useCallback(async (filePath: string) => {
    const res = await window.akv.openPath(filePath)
    if (!res || 'error' in res) {
      flash(res && 'error' in res ? `Couldn't open: ${res.error}` : 'Open cancelled')
      return
    }
    await loadDoc(res.bytes, res.path, res.name, res.size)
  }, [])

  const handleOpen = useCallback(async () => {
    const res = await window.akv.openPdf()
    if (!res) return
    await loadDoc(res.bytes, res.path, res.name, res.size)
  }, [])

  const loadDoc = async (
    pdfBytes: ArrayBuffer,
    filePath: string,
    name: string,
    size: number
  ) => {
    try {
      const document = await loadPdf(pdfBytes)
      const meta = await readMetadata(document)
      setDoc(document, pdfBytes, filePath, name, size, {
        ...meta,
        pageCount: document.numPages,
        fileSize: size
      })
      window.akv.recentList().then(setRecentFiles)
      // Background-detect AcroForm widgets. Walks pages in parallel so even
      // multi-hundred-page documents return in well under a second; failures
      // per page are swallowed so a single bad annotation can't break load.
      detectFormFields(document).catch((err) =>
        console.warn('[load] form detect failed:', err)
      )
    } catch (err) {
      flash(`Failed to load PDF: ${(err as Error).message}`)
    }
  }

  const detectFormFields = async (document: PDFDocumentProxy) => {
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, (_, i) => document.getPage(i + 1))
    )
    const counts = await Promise.all(
      pages.map((p) => countFormFields(p).catch(() => 0))
    )
    const total = counts.reduce((a, b) => a + b, 0)
    if (total > 0) {
      setFormFieldCount(total)
      flash(
        `This PDF has ${total} fillable field${total === 1 ? '' : 's'} — ` +
          'fill them and use Save Copy to write your answers.'
      )
    }
  }

  const handleSaveCopy = useCallback(async () => {
    if (!bytes || !fileName) return
    try {
      const ocrList = Object.values(ocrResults)
      const hasFormEdits = Object.keys(formValues).length > 0
      const stamped = await stampSignatures(
        bytes,
        signatures,
        redactions,
        ocrList,
        formValues
      )
      const base = fileName.replace(/\.pdf$/i, '')
      const tags: string[] = []
      if (hasFormEdits) tags.push('filled')
      if (redactions.length) tags.push('redacted')
      if (signatures.length) tags.push('signed')
      if (ocrList.length) tags.push('ocr')
      const suffix = tags.length ? '-' + tags.join('-') + '.pdf' : '-copy.pdf'
      const suggested = base + suffix
      const out = stamped.buffer.slice(
        stamped.byteOffset,
        stamped.byteOffset + stamped.byteLength
      ) as ArrayBuffer
      const result = await window.akv.savePdf(out, suggested)
      if (result) {
        flash(`Saved to ${result.path}`)
        if (signatures.length) clearSignatures()
        if (redactions.length) clearRedactions()
        if (ocrList.length) clearOcrResults()
        if (hasFormEdits) clearFormValues()
      }
    } catch (err) {
      flash(`Save failed: ${(err as Error).message}`)
    }
  }, [
    bytes,
    fileName,
    signatures,
    redactions,
    ocrResults,
    formValues,
    clearSignatures,
    clearRedactions,
    clearOcrResults,
    clearFormValues
  ])

  const handlePrint = useCallback(async () => {
    if (!doc) return
    const prevMode = useViewer.getState().viewMode
    // Print preview captures whatever is in the DOM. In single/two-up modes
    // only one or two pages are rendered, so multi-page printing would show
    // blanks. Switch to continuous so every page is mounted, briefly wait for
    // PDF.js to start drawing, then open the preview.
    if (prevMode !== 'continuous') {
      setViewMode('continuous')
      await new Promise((r) => setTimeout(r, 500))
    }
    window.print()
    if (prevMode !== 'continuous') {
      setViewMode(prevMode)
    }
  }, [doc, setViewMode])

  const handleSign = useCallback(() => setSignatureOpen(true), [])

  const handleMerge = useCallback(() => setMergeOpen(true), [])

  const onMerged = useCallback(async (path: string) => {
    setMergeOpen(false)
    flash(`Combined PDF saved to ${path}. Opening…`)
    await openByPath(path)
  }, [openByPath])

  const handleSplit = useCallback(() => {
    if (!doc) {
      flash('Open a PDF first to split it.')
      return
    }
    setSplitOpen(true)
  }, [doc])

  const handleRedact = useCallback(() => {
    if (!doc) {
      flash('Open a PDF first to redact it.')
      return
    }
    toggleRedactMode()
  }, [doc, toggleRedactMode])

  const runFindRedact = useCallback(async () => {
    if (!doc || redactBusy) return
    const text = redactFindInput.trim()
    const preset = redactPatternId
      ? PATTERN_PRESETS.find((p) => p.id === redactPatternId)
      : null
    if (!text && !preset) return
    setRedactBusy(true)
    try {
      const results: typeof redactions = []
      if (text) {
        results.push(...(await findRedactionsInDoc(doc, text)))
      }
      if (preset) {
        results.push(...(await findRedactionsInDoc(doc, preset.regex)))
      }
      if (results.length === 0) {
        flash('No matches found.')
      } else {
        addRedactions(results)
        const label = preset
          ? `${preset.label.split(' (')[0]}${text ? ` and "${text}"` : ''}`
          : `"${text}"`
        flash(`Marked ${results.length} match${results.length === 1 ? '' : 'es'} for ${label}.`)
      }
    } catch (err) {
      flash(`Find-and-redact failed: ${(err as Error).message}`)
    }
    setRedactBusy(false)
  }, [doc, redactBusy, redactFindInput, redactPatternId, addRedactions, redactions])

  const handleOcr = useCallback(() => {
    if (!doc) {
      flash('Open a PDF first to run OCR.')
      return
    }
    setOcrOpen(true)
  }, [doc])

  const handleCompare = useCallback(() => {
    if (!doc) {
      flash('Open a PDF first to compare it.')
      return
    }
    setCompareOpen(true)
  }, [doc])

  const handleSanitize = useCallback(() => {
    if (!doc) {
      flash('Open a PDF first to sanitize it.')
      return
    }
    setSanitizeOpen(true)
  }, [doc])

  const handleOrganize = useCallback(() => {
    if (!doc) {
      flash('Open a PDF first to organize its pages.')
      return
    }
    enterOrganize()
  }, [doc, enterOrganize])

  const onOrganizeSaved = useCallback(
    async (msg: string) => {
      flash(msg)
      // Extract message: open the saved file as the current doc if it's the
      // organized version. Match path on `\` or `/`.
      const match = /to (.+\.pdf)/.exec(msg)
      if (match) {
        exitOrganize()
        await openByPath(match[1])
      }
    },
    [openByPath, exitOrganize]
  )

  const onSanitizeDone = useCallback((summary: string) => {
    setSanitizeOpen(false)
    flash(summary)
  }, [])

  const handleUndo = useCallback(() => {
    // If the focus is in a text input, let the browser undo typing there
    // instead of popping app-state history.
    const t = document.activeElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      document.execCommand('undo')
      return
    }
    if (!undo()) flash('Nothing to undo.')
  }, [undo])

  const handleRedo = useCallback(() => {
    const t = document.activeElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      document.execCommand('redo')
      return
    }
    if (!redo()) flash('Nothing to redo.')
  }, [redo])

  const onCompareReady = useCallback(
    (right: { doc: PDFDocumentProxy; name: string }) => {
      setCompareOpen(false)
      setCompareDoc(right.doc, right.name)
      setCompareMode(true)
      // Force single-page view so left/right line up page-for-page, and open
      // the diff side panel so the user immediately sees the summary.
      useViewer.setState({
        viewMode: 'single',
        sidePanel: 'diff'
      })
      flash(`Comparing ${fileName} vs ${right.name}`)
    },
    [setCompareDoc, setCompareMode, fileName]
  )

  const exitCompare = useCallback(() => {
    setCompareMode(false)
    setCompareDoc(null, null)
    useViewer.setState({ sidePanel: null })
  }, [setCompareMode, setCompareDoc])

  const onOcrDone = useCallback(
    (pages: number) => {
      setOcrOpen(false)
      useViewer.setState({ sidePanel: 'ocr' })
      flash(`Recognized text on ${pages} page${pages === 1 ? '' : 's'}.`)
    },
    []
  )

  const onSplitDone = useCallback((count: number, dir: string) => {
    setSplitOpen(false)
    flash(`Saved ${count} file${count === 1 ? '' : 's'} to ${dir}`)
  }, [])

  const onSignatureConfirm = useCallback(
    (sig: { dataUrl: string; aspectRatio: number }) => {
      setSignatureOpen(false)
      setPendingPlacement(sig)
    },
    []
  )

  const onPlaceSignature = useCallback(
    (pageNumber: number, pdfX: number, pdfY: number) => {
      if (!pendingPlacement) return
      const targetWidth = 150 // PDF points (~2 inches)
      const targetHeight = targetWidth / pendingPlacement.aspectRatio
      const placed: PlacedSignature = {
        id: crypto.randomUUID(),
        pageNumber,
        // Center the signature on the click point so it lands where the user is looking.
        x: pdfX - targetWidth / 2,
        y: pdfY - targetHeight / 2,
        width: targetWidth,
        height: targetHeight,
        imageDataUrl: pendingPlacement.dataUrl
      }
      addSignature(placed)
      setPendingPlacement(null)
    },
    [pendingPlacement, addSignature]
  )

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  // Reflect undo/redo availability into the page title so the user gets a
  // visible hint at the top of the window. Real menu enable/disable would
  // require rebuilding the native menu on every state change — that's overkill
  // for this case.
  useEffect(() => {
    const base = fileName ?? 'Acrobat Clone'
    const marker = canUndo ? ' • edited' : ''
    document.title = base + marker
    void canRedo
  }, [fileName, canUndo, canRedo])

  // Wire up the application menu IPC events.
  useEffect(() => {
    const offs = [
      window.akv.onMenu('menu:open', handleOpen),
      window.akv.onMenu('menu:save-copy', handleSaveCopy),
      window.akv.onMenu('menu:print', handlePrint),
      window.akv.onMenu('menu:find', () => toggleSidePanel('search')),
      window.akv.onMenu('menu:zoom-in', zoomIn),
      window.akv.onMenu('menu:zoom-out', zoomOut),
      window.akv.onMenu('menu:zoom-reset', () => setZoom(1)),
      window.akv.onMenu('menu:sign', handleSign),
      window.akv.onMenu('menu:redact', handleRedact),
      window.akv.onMenu('menu:merge', handleMerge),
      window.akv.onMenu('menu:split', handleSplit),
      window.akv.onMenu('menu:ocr', handleOcr),
      window.akv.onMenu('menu:compare', handleCompare),
      window.akv.onMenu('menu:sanitize', handleSanitize),
      window.akv.onMenu('menu:organize', handleOrganize),
      window.akv.onMenu('menu:undo', handleUndo),
      window.akv.onMenu('menu:redo', handleRedo)
    ]
    return () => offs.forEach((off) => off())
  }, [
    handleOpen,
    handleSaveCopy,
    handlePrint,
    toggleSidePanel,
    zoomIn,
    zoomOut,
    setZoom,
    handleSign,
    handleRedact,
    handleMerge,
    handleSplit,
    handleOcr,
    handleCompare,
    handleSanitize,
    handleOrganize,
    handleUndo,
    handleRedo
  ])

  // Keyboard: arrows / pgup / pgdn for page nav
  useEffect(() => {
    if (!doc) return
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        setPage(currentPage + 1)
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        setPage(currentPage - 1)
      } else if (e.key === 'Home') {
        setPage(1)
      } else if (e.key === 'End') {
        setPage(pageCount)
      } else if (e.key === 'Escape') {
        if (pendingPlacement) {
          setPendingPlacement(null)
          flash('Placement cancelled.')
        } else if (redactMode) {
          setRedactMode(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, currentPage, pageCount, setPage, pendingPlacement, redactMode, setRedactMode])

  const hasDoc = !!doc

  return (
    <div className="app">
      <Toolbar
        onOpen={handleOpen}
        onSaveCopy={handleSaveCopy}
        onPrint={handlePrint}
        onSign={handleSign}
        onRedact={handleRedact}
        onOcr={handleOcr}
      />
      {organizeActive && doc && (
        <OrganizeMode onExit={exitOrganize} onSavedNew={onOrganizeSaved} />
      )}
      {!organizeActive && (
      <div
        className={
          'body' +
          (hasDoc ? '' : ' no-sidebar') +
          (sidePanel ? ' with-panel' : '')
        }
      >
        {hasDoc && doc && <Thumbnails doc={doc} />}
        <div className="viewer" ref={viewerRef}>
          {pendingPlacement && (
            <div className="placement-banner">
              <span>Click anywhere on a page to drop the signature.</span>
              <button onClick={() => setPendingPlacement(null)}>Cancel (Esc)</button>
            </div>
          )}
          {redactMode && (
            <div className="placement-banner redact-banner">
              <div className="redact-banner-row">
                <span>
                  Drag through text or empty area to mark redactions ·{' '}
                  {redactions.length} marked
                </span>
                <div className="redact-banner-actions">
                  {redactions.length > 0 && (
                    <button onClick={() => clearRedactions()}>Clear all</button>
                  )}
                  <button onClick={() => setRedactMode(false)}>Done (Esc)</button>
                </div>
              </div>
              <div className="redact-banner-row find-row">
                <input
                  type="text"
                  placeholder="Find text to redact…"
                  value={redactFindInput}
                  onChange={(e) => setRedactFindInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runFindRedact()
                  }}
                  disabled={redactBusy}
                />
                <select
                  value={redactPatternId}
                  onChange={(e) => setRedactPatternId(e.target.value)}
                  disabled={redactBusy}
                >
                  <option value="">— Patterns —</option>
                  {PATTERN_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={runFindRedact}
                  disabled={redactBusy || (!redactFindInput.trim() && !redactPatternId)}
                >
                  {redactBusy ? 'Scanning…' : 'Find & Redact'}
                </button>
              </div>
              <div className="redact-banner-row">
                <em>
                  Visual redaction only — text underneath is hidden but not removed
                  from the file.
                </em>
              </div>
            </div>
          )}
          {!hasDoc && (
            <Welcome
              onOpen={handleOpen}
              onMerge={handleMerge}
              recent={recentFiles}
              onOpenRecent={openByPath}
            />
          )}
          {hasDoc && doc && compareMode && compareDoc && (
            <div className="compare-banner">
              <span>
                Comparing <strong>{fileName}</strong> ↔ <strong>{compareFileName}</strong>
              </span>
              <button onClick={exitCompare}>Exit compare</button>
            </div>
          )}
          {hasDoc && doc && !compareMode && (
            <div className={'pages ' + (viewMode === 'two-up' ? 'two-up' : '')}>
              {renderPages({
                doc,
                viewMode,
                currentPage,
                pageCount,
                zoom,
                fitMode,
                containerWidth: viewerSize.width,
                containerHeight: viewerSize.height,
                pendingPlacement,
                onPlaceSignature
              })}
            </div>
          )}
          {hasDoc && doc && compareMode && compareDoc && (
            <div className="compare-pages">
              <div className="compare-col">
                <div className="compare-col-label">
                  Original • {fileName} • page {currentPage} of {pageCount}
                </div>
                <PageRenderer
                  doc={doc}
                  pageNumber={currentPage}
                  zoom={zoom}
                  fitMode={fitMode}
                  containerWidth={viewerSize.width / 2}
                  containerHeight={viewerSize.height}
                  isActive
                  signaturePlacement={null}
                  onPlaceSignature={() => {}}
                />
              </div>
              <div className="compare-col">
                <div className="compare-col-label">
                  Revised • {compareFileName} • page{' '}
                  {Math.min(currentPage, compareDoc.numPages)} of {compareDoc.numPages}
                </div>
                {currentPage <= compareDoc.numPages ? (
                  <PageRenderer
                    doc={compareDoc}
                    pageNumber={currentPage}
                    zoom={zoom}
                    fitMode={fitMode}
                    containerWidth={viewerSize.width / 2}
                    containerHeight={viewerSize.height}
                    isActive
                    signaturePlacement={null}
                    onPlaceSignature={() => {}}
                  />
                ) : (
                  <div className="compare-empty">
                    Revised document has no page {currentPage}.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {hasDoc && doc && sidePanel && <SidePanel doc={doc} />}
      </div>
      )}
      <SignatureModal
        open={signatureOpen}
        onCancel={() => setSignatureOpen(false)}
        onConfirm={onSignatureConfirm}
      />
      <MergeModal
        open={mergeOpen}
        onCancel={() => setMergeOpen(false)}
        onMerged={onMerged}
      />
      <SplitModal
        open={splitOpen}
        bytes={bytes}
        fileName={fileName}
        pageCount={pageCount}
        onCancel={() => setSplitOpen(false)}
        onDone={onSplitDone}
      />
      <OcrModal
        open={ocrOpen}
        doc={doc}
        pageCount={pageCount}
        currentPage={currentPage}
        onCancel={() => setOcrOpen(false)}
        onDone={onOcrDone}
      />
      <CompareModal
        open={compareOpen}
        leftName={fileName}
        onCancel={() => setCompareOpen(false)}
        onReady={onCompareReady}
      />
      <SanitizeModal
        open={sanitizeOpen}
        bytes={bytes}
        fileName={fileName}
        onCancel={() => setSanitizeOpen(false)}
        onDone={onSanitizeDone}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function renderPages(args: {
  doc: PDFDocumentProxy
  viewMode: 'single' | 'two-up' | 'continuous'
  currentPage: number
  pageCount: number
  zoom: number
  fitMode: 'custom' | 'width' | 'page'
  containerWidth: number
  containerHeight: number
  pendingPlacement: { dataUrl: string; aspectRatio: number } | null
  onPlaceSignature: (pageNumber: number, x: number, y: number) => void
}) {
  const { viewMode, currentPage, pageCount } = args
  let pages: number[]
  if (viewMode === 'continuous') {
    pages = Array.from({ length: pageCount }, (_, i) => i + 1)
  } else if (viewMode === 'two-up') {
    const left = currentPage % 2 === 0 ? currentPage - 1 : currentPage
    pages = [left, left + 1].filter((p) => p >= 1 && p <= pageCount)
  } else {
    pages = [currentPage]
  }

  return pages.map((p) => (
    <PageRenderer
      key={p}
      doc={args.doc}
      pageNumber={p}
      zoom={args.zoom}
      fitMode={args.fitMode}
      containerWidth={args.containerWidth}
      containerHeight={args.containerHeight}
      isActive={p === args.currentPage}
      signaturePlacement={args.pendingPlacement}
      onPlaceSignature={args.onPlaceSignature}
    />
  ))
}

function Welcome({
  onOpen,
  onMerge,
  recent,
  onOpenRecent
}: {
  onOpen: () => void
  onMerge: () => void
  recent: RecentFile[]
  onOpenRecent: (path: string) => void
}) {
  return (
    <div className="welcome">
      <h1>Acrobat Clone</h1>
      <p>Open a PDF to get started.</p>
      <div className="welcome-actions">
        <button className="primary" onClick={onOpen}>
          <FolderOpen size={16} /> Open File
        </button>
        <button className="ghost" onClick={onMerge}>
          <Files size={16} /> Combine PDFs
        </button>
      </div>
      {recent.length > 0 && (
        <div className="recent">
          <h2>Recent</h2>
          {recent.map((r) => (
            <div className="item" key={r.path} onClick={() => onOpenRecent(r.path)}>
              <div>
                <div className="name">{r.name}</div>
                <div className="path">{r.path}</div>
              </div>
              <div className="path">{relativeTime(r.openedAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function relativeTime(ms: number): string {
  const delta = Math.floor((Date.now() - ms) / 1000)
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}

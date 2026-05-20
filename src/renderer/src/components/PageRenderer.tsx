import { useEffect, useRef, useState } from 'react'
import { pdfjsLib, type PDFDocumentProxy } from '../pdf'
import { useViewer, type PlacedSignature, type Redaction } from '../store'
import { extractFormFields, type FormField } from '../form'

interface Props {
  doc: PDFDocumentProxy
  pageNumber: number
  zoom: number
  fitMode: 'custom' | 'width' | 'page'
  containerWidth: number
  containerHeight: number
  isActive: boolean
  signaturePlacement?: { dataUrl: string; aspectRatio: number } | null
  onPlaceSignature?: (pageNumber: number, x: number, y: number) => void
}

interface PageDims {
  cssWidth: number
  cssHeight: number
  scale: number
  viewportWidth: number
  viewportHeight: number
}

export function PageRenderer({
  doc,
  pageNumber,
  zoom,
  fitMode,
  containerWidth,
  containerHeight,
  isActive,
  signaturePlacement,
  onPlaceSignature
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<PageDims | null>(null)
  const allSignatures = useViewer((s) => s.signatures)
  const signatures = allSignatures.filter((sig) => sig.pageNumber === pageNumber)
  const allRedactions = useViewer((s) => s.redactions)
  const redactions = allRedactions.filter((r) => r.pageNumber === pageNumber)
  const redactMode = useViewer((s) => s.redactMode)
  const addRedaction = useViewer((s) => s.addRedaction)
  const addRedactions = useViewer((s) => s.addRedactions)
  const removeRedaction = useViewer((s) => s.removeRedaction)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [formFields, setFormFields] = useState<FormField[]>([])
  // Form value subscriptions happen per-input inside FormFieldInput so a
  // single keystroke re-renders only the changed widget — not every page.
  // Form inputs are disabled while the user is placing a signature or marking
  // redactions — those modes need clicks on the page to drop the artifact, and
  // an interactive input would steal the event before the page click handler
  // can run.
  const formInteractive = !signaturePlacement && !redactMode

  useEffect(() => {
    let cancelled = false
    let renderTask: ReturnType<ReturnType<PDFDocumentProxy['getPage']> extends Promise<infer P> ? (P extends { render: (...args: any[]) => infer R } ? () => R : never) : never> | null = null

    const render = async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return

      const unscaled = page.getViewport({ scale: 1 })
      let scale = zoom
      if (fitMode === 'width' && containerWidth > 0) {
        scale = (containerWidth - 40) / unscaled.width
      } else if (fitMode === 'page' && containerWidth > 0 && containerHeight > 0) {
        const sw = (containerWidth - 40) / unscaled.width
        const sh = (containerHeight - 40) / unscaled.height
        scale = Math.min(sw, sh)
      }

      const outputScale = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = Math.floor(viewport.width) + 'px'
      canvas.style.height = Math.floor(viewport.height) + 'px'

      const ctx = canvas.getContext('2d')!
      const transform =
        outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined

      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform
      } as Parameters<typeof page.render>[0])
      renderTask = task as never

      try {
        await task.promise
      } catch (err) {
        if ((err as { name?: string }).name === 'RenderingCancelledException') return
        throw err
      }
      if (cancelled) return

      const textLayer = textLayerRef.current
      if (textLayer) {
        textLayer.innerHTML = ''
        textLayer.style.width = Math.floor(viewport.width) + 'px'
        textLayer.style.height = Math.floor(viewport.height) + 'px'
        const textContent = await page.getTextContent()
        if (cancelled) return
        renderTextLayer(textContent, textLayer, viewport)
      }

      // Form fields — extracted at the same scale so positions match the
      // current zoom. Cheap on most documents (annotation count is small);
      // skipped on cancel like the rest of the render pipeline.
      try {
        const fields = await extractFormFields(page, scale)
        if (cancelled) return
        setFormFields(fields)
      } catch (err) {
        console.warn(`[page ${pageNumber}] form extract failed:`, err)
        setFormFields([])
      }

      setDims({
        cssWidth: viewport.width,
        cssHeight: viewport.height,
        scale,
        viewportWidth: unscaled.width,
        viewportHeight: unscaled.height
      })
    }

    render().catch((err) => {
      if (cancelled) return
      console.error(`[page ${pageNumber}] render failed:`, err)
    })

    return () => {
      cancelled = true
      if (renderTask && typeof (renderTask as { cancel?: () => void }).cancel === 'function') {
        (renderTask as { cancel?: () => void }).cancel!()
      }
    }
  }, [doc, pageNumber, zoom, fitMode, containerWidth, containerHeight])

  const handleClick = (e: React.MouseEvent) => {
    if (!signaturePlacement || !dims || !onPlaceSignature) return
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    // Convert CSS pixels back to PDF page units (origin top-left)
    const pdfX = cssX / dims.scale
    const pdfY = cssY / dims.scale
    onPlaceSignature(pageNumber, pdfX, pdfY)
  }

  // Redaction drag: in redact mode, pressing down on the page starts a
  // rubber-band selection. On release we convert the box back to PDF coords
  // and persist it. Click on an existing redaction's × removes it.
  const cursorPosToCss = (e: React.PointerEvent): { x: number; y: number } | null => {
    const wrap = wrapRef.current
    if (!wrap) return null
    const rect = wrap.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onRedactDown = (e: React.PointerEvent) => {
    if (!redactMode || !dims) return
    const target = e.target as HTMLElement
    if (target.closest('.redaction-mark')) return // ignore clicks on existing redactions
    // If the user is pressing on a text-layer span, let the browser handle
    // selection. We'll convert the selection to redactions on pointer up.
    if (target.closest('.text-layer span')) return
    const p = cursorPosToCss(e)
    if (!p) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }

  const onRedactMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = cursorPosToCss(e)
    if (!p) return
    setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d))
  }

  const onRedactUp = () => {
    // Text selection takes priority over area drag — if the user dragged
    // through text, the browser has a selection and we convert each
    // selected span's bbox into a redaction (as a single batch so undo
    // removes the entire selection in one step).
    if (redactTextSelection(wrapRef.current, textLayerRef.current, dims, pageNumber, addRedactions)) {
      setDrag(null)
      return
    }
    if (!drag || !dims) {
      setDrag(null)
      return
    }
    const cssX = Math.min(drag.x0, drag.x1)
    const cssY = Math.min(drag.y0, drag.y1)
    const cssW = Math.abs(drag.x1 - drag.x0)
    const cssH = Math.abs(drag.y1 - drag.y0)
    if (cssW < 4 || cssH < 4) {
      setDrag(null)
      return
    }
    addRedaction({
      id: crypto.randomUUID(),
      pageNumber,
      x: cssX / dims.scale,
      y: cssY / dims.scale,
      width: cssW / dims.scale,
      height: cssH / dims.scale
    })
    setDrag(null)
  }

  const liveBox = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0)
  }

  const wrapClass =
    'page-wrap' +
    (signaturePlacement ? ' placing' : '') +
    (redactMode ? ' redacting' : '')

  const cursor = signaturePlacement || redactMode ? 'crosshair' : 'default'

  return (
    <div
      ref={wrapRef}
      className={wrapClass}
      data-page={pageNumber}
      data-active={isActive}
      onClick={signaturePlacement ? handleClick : undefined}
      onPointerDown={redactMode ? onRedactDown : undefined}
      onPointerMove={redactMode ? onRedactMove : undefined}
      onPointerUp={redactMode ? onRedactUp : undefined}
      onPointerCancel={redactMode ? onRedactUp : undefined}
      style={{ cursor }}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="text-layer" />
      {dims && formFields.length > 0 && (
        <div
          className={'form-overlay' + (formInteractive ? '' : ' inactive')}
          aria-hidden={!formInteractive}
        >
          {formFields.map((f) => (
            <FormFieldInput key={f.id} field={f} disabled={!formInteractive} />
          ))}
        </div>
      )}
      <div className="signature-overlay">
        {dims &&
          signatures.map((sig) => (
            <PlacedSig key={sig.id} sig={sig} pageScale={dims.scale} />
          ))}
      </div>
      <div className="redaction-overlay">
        {dims &&
          redactions.map((r) => (
            <RedactionMark
              key={r.id}
              redaction={r}
              pageScale={dims.scale}
              onRemove={() => removeRedaction(r.id)}
            />
          ))}
        {liveBox && (
          <div
            className="redaction-rubberband"
            style={{
              left: liveBox.left,
              top: liveBox.top,
              width: liveBox.width,
              height: liveBox.height
            }}
          />
        )}
      </div>
    </div>
  )
}

// Convert the current browser selection (when it falls within `textLayer`)
// into one redaction per highlighted span. Returns true if anything was
// added, so the caller can skip the rubber-band fallback. All spans are
// committed in one batch so a single Ctrl+Z removes the whole selection.
function redactTextSelection(
  wrap: HTMLDivElement | null,
  textLayer: HTMLDivElement | null,
  dims: PageDims | null,
  pageNumber: number,
  addRedactions: (rs: Redaction[]) => void
): boolean {
  if (!wrap || !textLayer || !dims) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!textLayer.contains(range.commonAncestorContainer)) return false
  const wrapRect = wrap.getBoundingClientRect()
  const spans = textLayer.querySelectorAll<HTMLSpanElement>('span')
  const batch: Redaction[] = []
  for (const span of spans) {
    if (!range.intersectsNode(span)) continue
    const rect = span.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    batch.push({
      id: crypto.randomUUID(),
      pageNumber,
      x: (rect.left - wrapRect.left) / dims.scale,
      y: (rect.top - wrapRect.top) / dims.scale,
      width: rect.width / dims.scale,
      height: rect.height / dims.scale
    })
  }
  if (batch.length === 0) return false
  addRedactions(batch)
  sel.removeAllRanges()
  return true
}

function RedactionMark({
  redaction,
  pageScale,
  onRemove
}: {
  redaction: Redaction
  pageScale: number
  onRemove: () => void
}) {
  return (
    <div
      className="redaction-mark"
      style={{
        left: redaction.x * pageScale,
        top: redaction.y * pageScale,
        width: redaction.width * pageScale,
        height: redaction.height * pageScale
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="remove-btn"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        ×
      </div>
    </div>
  )
}

// Renders a single AcroForm widget as an absolutely-positioned HTML input.
// Value resolution: store value wins; field's defaultValue is the fallback.
// Stops pointer events from propagating up so signature/redaction drags don't
// initiate on top of a field — the wrapping `.form-overlay` is otherwise
// `pointer-events: none` so empty space between fields still routes clicks
// through to the page.
function FormFieldInput({
  field,
  disabled
}: {
  field: FormField
  disabled: boolean
}) {
  // Per-field Zustand selector: only this widget re-renders when its value
  // changes. Radios in the same group share a name, so they all subscribe to
  // the same slot and update together — that's the desired behavior.
  const storeValue = useViewer((s) => s.formValues[field.name])
  const onChange = useViewer((s) => s.setFormValue)
  const style: React.CSSProperties = {
    left: field.cssLeft,
    top: field.cssTop,
    width: field.cssWidth,
    height: field.cssHeight
  }
  const stopProp = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()
  const isReadOnly = field.readOnly || disabled

  if (field.kind === 'text') {
    const value =
      typeof storeValue === 'string' ? storeValue : (storeValue == null ? field.defaultValue : '')
    const common = {
      className: 'form-field form-field-text',
      style,
      value,
      readOnly: isReadOnly,
      maxLength: field.maxLength,
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
      ) => onChange(field.name, e.target.value),
      onPointerDown: stopProp,
      onClick: stopProp
    }
    return field.multiline ? <textarea {...common} /> : <input type="text" {...common} />
  }

  if (field.kind === 'checkbox') {
    const checked =
      typeof storeValue === 'boolean' ? storeValue : field.defaultChecked
    return (
      <input
        type="checkbox"
        className="form-field form-field-checkbox"
        style={style}
        checked={checked}
        disabled={isReadOnly}
        onChange={(e) => onChange(field.name, e.target.checked)}
        onPointerDown={stopProp}
        onClick={stopProp}
      />
    )
  }

  if (field.kind === 'radio') {
    // Store value is the selected option's export value (or undefined). A
    // widget is checked when the store reports its own exportValue.
    const selected =
      typeof storeValue === 'string'
        ? storeValue === field.exportValue
        : field.defaultChecked
    return (
      <input
        type="radio"
        className="form-field form-field-radio"
        style={style}
        name={field.name}
        checked={selected}
        disabled={isReadOnly}
        onChange={() => onChange(field.name, field.exportValue)}
        onPointerDown={stopProp}
        onClick={stopProp}
      />
    )
  }

  // dropdown: combo → editable input + datalist; non-combo → plain select.
  const dropdownValue =
    typeof storeValue === 'string' ? storeValue : field.defaultValue
  if (field.combo) {
    const listId = `dl-${field.id}`
    return (
      <>
        <input
          type="text"
          className="form-field form-field-combo"
          style={style}
          list={listId}
          value={dropdownValue}
          readOnly={isReadOnly}
          onChange={(e) => onChange(field.name, e.target.value)}
          onPointerDown={stopProp}
          onClick={stopProp}
        />
        <datalist id={listId}>
          {field.options.map((o) => (
            <option key={o.exportValue} value={o.exportValue}>
              {o.displayValue}
            </option>
          ))}
        </datalist>
      </>
    )
  }
  return (
    <select
      className="form-field form-field-select"
      style={style}
      value={dropdownValue}
      disabled={isReadOnly}
      onChange={(e) => onChange(field.name, e.target.value)}
      onPointerDown={stopProp}
      onClick={stopProp}
    >
      {/* Allow a blank/unset selection so users can clear a default. */}
      {!field.options.some((o) => o.exportValue === '') && (
        <option value="">— Select —</option>
      )}
      {field.options.map((o) => (
        <option key={o.exportValue} value={o.exportValue}>
          {o.displayValue}
        </option>
      ))}
    </select>
  )
}

function PlacedSig({ sig, pageScale }: { sig: PlacedSignature; pageScale: number }) {
  const updateSignature = useViewer((s) => s.updateSignature)
  const removeSignature = useViewer((s) => s.removeSignature)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  )
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(
    null
  )

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: sig.x, origY: sig.y }
  }

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current
    const r = resizeRef.current
    if (d) {
      const dx = (e.clientX - d.startX) / pageScale
      const dy = (e.clientY - d.startY) / pageScale
      updateSignature(sig.id, { x: d.origX + dx, y: d.origY + dy })
    } else if (r) {
      const dx = (e.clientX - r.startX) / pageScale
      const dy = (e.clientY - r.startY) / pageScale
      const ratio = sig.width / sig.height
      let w = Math.max(20, r.origW + dx)
      let h = Math.max(10, r.origH + dy)
      // Keep aspect ratio
      if (Math.abs(dx) > Math.abs(dy)) h = w / ratio
      else w = h * ratio
      updateSignature(sig.id, { width: w, height: h })
    }
  }

  const endDrag = () => {
    dragRef.current = null
    resizeRef.current = null
  }

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: sig.width,
      origH: sig.height
    }
  }

  return (
    <div
      className="placed-sig"
      style={{
        left: sig.x * pageScale,
        top: sig.y * pageScale,
        width: sig.width * pageScale,
        height: sig.height * pageScale
      }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => e.stopPropagation()}
    >
      <img src={sig.imageDataUrl} draggable={false} alt="signature" />
      <div className="resize-handle" onPointerDown={startResize} />
      <div
        className="remove-btn"
        onClick={(e) => {
          e.stopPropagation()
          removeSignature(sig.id)
        }}
      >
        ×
      </div>
    </div>
  )
}

// Lightweight text-layer renderer (just enough for selection + copy).
// pdf.js ships a fuller renderTextLayer but we keep this simple and CSP-safe.
function renderTextLayer(
  textContent: Awaited<ReturnType<import('pdfjs-dist').PDFPageProxy['getTextContent']>>,
  container: HTMLDivElement,
  viewport: { width: number; height: number; transform: number[] }
) {
  const frag = document.createDocumentFragment()
  for (const item of textContent.items) {
    if (!('str' in item)) continue
    const span = document.createElement('span')
    span.textContent = item.str
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
    const fontHeight = Math.hypot(tx[2], tx[3])
    span.style.fontSize = fontHeight + 'px'
    span.style.fontFamily = item.fontName || 'sans-serif'
    span.style.left = tx[4] + 'px'
    span.style.top = tx[5] - fontHeight + 'px'
    if (item.width) {
      span.style.width = item.width * Math.abs(tx[0]) + 'px'
    }
    frag.appendChild(span)
  }
  container.appendChild(frag)
}

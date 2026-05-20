import {
  PDFDocument,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  beginText,
  endText,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  TextRenderingMode,
  showText,
  PDFHexString
} from 'pdf-lib'
import type { FormValue, PlacedSignature, Redaction } from './store'
import type { OcrPageResult, OcrWord } from './ocr'

// Stamp placed signatures, redactions, and an invisible OCR text layer into a
// copy of the original PDF bytes. Inputs use top-left origin in unscaled PDF
// page units; pdf-lib uses bottom-left origin, so we convert per page.
//
// Note on redaction: drawing an opaque rectangle hides the content visually
// but does NOT remove the underlying text from the file. For true redaction
// the page would need to be rasterised or the content stream rewritten.
export async function stampSignatures(
  originalBytes: ArrayBuffer,
  signatures: PlacedSignature[],
  redactions: Redaction[] = [],
  ocrResults: OcrPageResult[] = [],
  formValues: Record<string, FormValue> = {},
  flattenForm = false
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  const hasFormWork = Object.keys(formValues).length > 0 || flattenForm
  if (
    signatures.length === 0 &&
    redactions.length === 0 &&
    ocrResults.length === 0 &&
    !hasFormWork
  ) {
    return await pdf.save()
  }

  // --- Form values first so subsequent stamps land on top of any filled UI ---
  if (hasFormWork) {
    applyFormValues(pdf, formValues, flattenForm)
  }

  // --- OCR text layer (invisible, searchable) ---
  // Embed font once and reuse across pages. Helvetica covers WinAnsi; OCR
  // words containing characters Helvetica can't encode are skipped silently
  // rather than failing the whole save.
  if (ocrResults.length > 0) {
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (const result of ocrResults) {
      const page = pdf.getPage(result.pageNumber - 1)
      const { height: pageHeight } = page.getSize()
      const ops = buildInvisibleTextOps(result, pageHeight, font)
      if (ops.length > 0) page.pushOperators(...ops)
    }
  }

  // --- Redactions next so signatures land on top of them ---
  for (const r of redactions) {
    const page = pdf.getPage(r.pageNumber - 1)
    const { height: pageHeight } = page.getSize()
    page.drawRectangle({
      x: r.x,
      y: pageHeight - r.y - r.height,
      width: r.width,
      height: r.height,
      color: rgb(0, 0, 0),
      opacity: 1
    })
  }

  // --- Signatures ---
  const byPage = new Map<number, PlacedSignature[]>()
  for (const sig of signatures) {
    const list = byPage.get(sig.pageNumber) ?? []
    list.push(sig)
    byPage.set(sig.pageNumber, list)
  }

  const imageCache = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  const embedImage = async (dataUrl: string) => {
    const cached = imageCache.get(dataUrl)
    if (cached) return cached
    const bytes = dataUrlToBytes(dataUrl)
    const img = dataUrl.startsWith('data:image/jpeg')
      ? await pdf.embedJpg(bytes)
      : await pdf.embedPng(bytes)
    imageCache.set(dataUrl, img)
    return img
  }

  for (const [pageNumber, list] of byPage) {
    const page = pdf.getPage(pageNumber - 1)
    const { height: pageHeight } = page.getSize()
    for (const sig of list) {
      const img = await embedImage(sig.imageDataUrl)
      page.drawImage(img, {
        x: sig.x,
        y: pageHeight - sig.y - sig.height,
        width: sig.width,
        height: sig.height
      })
    }
  }

  return await pdf.save()
}

// Apply user-supplied AcroForm values to the loaded PDF. Field type drives
// the pdf-lib call: text fields take strings, check boxes take booleans,
// radio groups + dropdowns + option lists take an option name. Unknown names
// are silently skipped — the document may have changed since the user opened
// it, or the value could reference a stale field id. Option lists and
// dropdowns are both Choice fields; treat them identically here. Calling
// flatten() at the end is one-way: fields become baked-in static content.
function applyFormValues(
  pdf: PDFDocument,
  values: Record<string, FormValue>,
  flatten: boolean
) {
  let form
  try {
    form = pdf.getForm()
  } catch {
    // No /AcroForm dictionary — nothing to fill.
    return
  }
  const fieldsByName = new Map(form.getFields().map((f) => [f.getName(), f]))

  for (const [name, value] of Object.entries(values)) {
    const field = fieldsByName.get(name)
    if (!field) continue
    try {
      if (field instanceof PDFTextField) {
        if (typeof value === 'string') field.setText(value)
      } else if (field instanceof PDFCheckBox) {
        if (typeof value === 'boolean') {
          if (value) field.check()
          else field.uncheck()
        }
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value.length > 0) field.select(value)
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (typeof value === 'string' && value.length > 0) field.select(value)
      }
    } catch (err) {
      // Individual field write failure (e.g. invalid radio option) shouldn't
      // abort the whole save. Log and move on.
      console.warn(`[form-fill] failed to set "${name}":`, err)
    }
  }

  if (flatten) {
    try {
      form.flatten()
    } catch (err) {
      console.warn('[form-fill] flatten failed:', err)
    }
  }
}

function buildInvisibleTextOps(
  result: OcrPageResult,
  pageHeight: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>
) {
  const s = result.renderScale
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)]
  let pushedAny = false
  for (const w of result.words) {
    const word = sanitizeWord(w, font)
    if (!word) continue
    const widthPdf = (word.bbox.x1 - word.bbox.x0) / s
    const heightPdf = (word.bbox.y1 - word.bbox.y0) / s
    if (widthPdf <= 0 || heightPdf <= 0) continue
    // Use bbox height as font size (rough but consistent). Scale the X axis
    // so the rendered text width matches the bbox — keeps copy-paste output
    // word-aligned even though Helvetica's glyphs don't match the original.
    const fontSize = heightPdf
    const textWidthAtNominal = font.widthOfTextAtSize(word.text, fontSize) || widthPdf
    const xScale = widthPdf / textWidthAtNominal
    const pdfX = word.bbox.x0 / s
    const pdfY = pageHeight - word.bbox.y1 / s
    ops.push(setFontAndSize(font.name, fontSize))
    ops.push(setTextMatrix(xScale, 0, 0, 1, pdfX, pdfY))
    ops.push(showText(PDFHexString.fromText(word.text)))
    pushedAny = true
  }
  ops.push(endText(), popGraphicsState())
  return pushedAny ? ops : []
}

// Strip characters the font can't encode. Helvetica supports WinAnsi only,
// so non-Latin scripts are dropped here (the user still sees them in the
// side-panel text; we just can't put them in the PDF text layer with this
// font). Trailing punctuation is preserved.
function sanitizeWord(
  w: OcrWord,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>
): OcrWord | null {
  let cleaned = ''
  for (const ch of w.text) {
    try {
      font.encodeText(ch)
      cleaned += ch
    } catch {
      // skip unsupported glyph
    }
  }
  cleaned = cleaned.trim()
  if (!cleaned) return null
  return { text: cleaned, bbox: w.bbox }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',')
  const b64 = dataUrl.slice(idx + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

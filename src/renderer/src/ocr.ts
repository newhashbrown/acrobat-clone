import { createWorker, type Worker } from 'tesseract.js'
import type { PDFDocumentProxy } from './pdf'

export interface OcrWord {
  text: string
  // Image-pixel bounding box (origin top-left of the rendered image)
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

export interface OcrPageResult {
  pageNumber: number
  text: string
  words: OcrWord[]
  // Scale at which the source canvas was rendered. Use this to convert
  // image-pixel bbox values back to PDF page units when stamping the
  // searchable text layer.
  renderScale: number
}

export type OcrProgress =
  | { kind: 'loading'; message: string; progress: number }
  | { kind: 'page'; pageNumber: number; index: number; total: number }

export interface OcrLanguage {
  code: string
  label: string
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'eng', label: 'English' },
  { code: 'fra', label: 'French' },
  { code: 'spa', label: 'Spanish' },
  { code: 'deu', label: 'German' },
  { code: 'por', label: 'Portuguese' },
  { code: 'ita', label: 'Italian' },
  { code: 'nld', label: 'Dutch' },
  { code: 'rus', label: 'Russian' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'kor', label: 'Korean' },
  { code: 'ara', label: 'Arabic' }
]

// Resolve vendor asset URLs against the renderer's location so they work in
// both dev (http://localhost:5173) and production (file://…/out/renderer/).
function url(rel: string): string {
  return new URL(rel, window.location.href).toString()
}

export class OcrSession {
  private worker: Worker | null = null
  private cancelled = false

  async init(lang: string, onProgress?: (p: OcrProgress) => void): Promise<void> {
    this.worker = await createWorker(lang, 1, {
      workerPath: url('./tesseract/worker.min.js'),
      corePath: url('./tesseract/'),
      logger: (m) => {
        if (!onProgress) return
        onProgress({ kind: 'loading', message: m.status, progress: m.progress ?? 0 })
      }
    })
  }

  async recognizePage(
    doc: PDFDocumentProxy,
    pageNumber: number,
    renderScale = 2
  ): Promise<OcrPageResult | null> {
    if (this.cancelled || !this.worker) return null
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: renderScale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({
      canvasContext: ctx,
      viewport
    } as Parameters<typeof page.render>[0]).promise
    if (this.cancelled) return null
    const { data } = await this.worker.recognize(canvas)
    if (this.cancelled) return null

    const words: OcrWord[] = []
    // Tesseract returns nested blocks/lines/words; in v5 the top-level
    // result.data.words contains a flat list of words with bboxes.
    const flatWords = (data as { words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }).words ?? []
    for (const w of flatWords) {
      if (!w.text || !w.text.trim()) continue
      words.push({
        text: w.text,
        bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }
      })
    }
    return { pageNumber, text: data.text ?? '', words, renderScale }
  }

  cancel(): void {
    this.cancelled = true
  }

  async destroy(): Promise<void> {
    this.cancelled = true
    try {
      await this.worker?.terminate()
    } catch {
      // already terminated
    }
    this.worker = null
  }
}

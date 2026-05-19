import * as pdfjsLib from 'pdfjs-dist'

// Worker file is copied into src/renderer/public/ so Vite serves it at the
// root in dev and copies it next to index.html in production. Resolving
// against window.location.href makes the URL work for both http://localhost
// (dev) and file:// (packaged build).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './pdf.worker.min.mjs',
  window.location.href
).toString()

export { pdfjsLib }
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export async function loadPdf(bytes: ArrayBuffer): Promise<pdfjsLib.PDFDocumentProxy> {
  // pdf.js mutates the buffer — clone so we keep the original bytes intact
  // for saving and stamping later.
  const copy = bytes.slice(0)
  return await pdfjsLib.getDocument({ data: copy }).promise
}

export interface ExtractedMetadata {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
}

export async function readMetadata(
  doc: pdfjsLib.PDFDocumentProxy
): Promise<ExtractedMetadata> {
  try {
    const meta = await doc.getMetadata()
    const info = (meta.info ?? {}) as Record<string, unknown>
    const get = (k: string): string | undefined => {
      const v = info[k]
      return typeof v === 'string' && v.length ? v : undefined
    }
    return {
      title: get('Title'),
      author: get('Author'),
      subject: get('Subject'),
      keywords: get('Keywords'),
      creator: get('Creator'),
      producer: get('Producer'),
      creationDate: get('CreationDate'),
      modificationDate: get('ModDate')
    }
  } catch {
    return {}
  }
}

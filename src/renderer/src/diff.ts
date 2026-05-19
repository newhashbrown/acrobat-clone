import { diffWords, type Change } from 'diff'
import type { PDFDocumentProxy } from './pdf'

export interface PageDiff {
  pageNumber: number // 1-based, against the LEFT document
  // Parallel page in the right document; null if the right doc has fewer pages.
  rightPageNumber: number | null
  unchanged: boolean
  changes: Change[] // diff hunks from diffWords
  addedWords: number
  removedWords: number
}

export interface DocDiff {
  pages: PageDiff[]
  totalAdded: number
  totalRemoved: number
  totalUnchanged: number
  leftPageCount: number
  rightPageCount: number
}

export async function extractPageText(
  doc: PDFDocumentProxy,
  pageNumber: number
): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()
  const parts: string[] = []
  for (const item of content.items) {
    if (!('str' in item)) continue
    parts.push(item.str)
    if (item.hasEOL) parts.push('\n')
    else parts.push(' ')
  }
  return parts.join('').replace(/[ \t]+/g, ' ').trim()
}

export async function compareDocuments(
  left: PDFDocumentProxy,
  right: PDFDocumentProxy
): Promise<DocDiff> {
  const leftPages = left.numPages
  const rightPages = right.numPages
  const maxPages = Math.max(leftPages, rightPages)
  const pages: PageDiff[] = []
  let totalAdded = 0
  let totalRemoved = 0
  let totalUnchanged = 0

  for (let n = 1; n <= maxPages; n++) {
    const leftText = n <= leftPages ? await extractPageText(left, n) : ''
    const rightText = n <= rightPages ? await extractPageText(right, n) : ''
    const changes = diffWords(leftText, rightText)
    let added = 0
    let removed = 0
    let unchanged = 0
    for (const c of changes) {
      const wordCount = c.value.split(/\s+/).filter(Boolean).length
      if (c.added) added += wordCount
      else if (c.removed) removed += wordCount
      else unchanged += wordCount
    }
    totalAdded += added
    totalRemoved += removed
    totalUnchanged += unchanged
    pages.push({
      pageNumber: n <= leftPages ? n : leftPages,
      rightPageNumber: n <= rightPages ? n : null,
      unchanged: added === 0 && removed === 0,
      changes,
      addedWords: added,
      removedWords: removed
    })
  }

  return {
    pages,
    totalAdded,
    totalRemoved,
    totalUnchanged,
    leftPageCount: leftPages,
    rightPageCount: rightPages
  }
}

import type { PDFDocumentProxy } from './pdf'
import type { Redaction } from './store'

export interface PatternPreset {
  id: string
  label: string
  regex: RegExp
}

// Common sensitive-data patterns. Kept deliberately conservative — false
// negatives are better than redacting an unrelated number string.
export const PATTERN_PRESETS: PatternPreset[] = [
  {
    id: 'ssn',
    label: 'US Social Security Number (123-45-6789)',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g
  },
  {
    id: 'email',
    label: 'Email address',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
  },
  {
    id: 'phone',
    label: 'US phone number',
    regex: /\b(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g
  },
  {
    id: 'credit-card',
    label: 'Credit card number',
    regex: /\b(?:\d[ -]?){13,19}\b/g
  },
  {
    id: 'ipv4',
    label: 'IPv4 address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
  },
  {
    id: 'date',
    label: 'Date (MM/DD/YYYY or DD/MM/YYYY)',
    regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g
  }
]

interface ItemSlot {
  // Original item from PDF.js
  text: string
  pdfX: number // top-left origin, in PDF points
  pdfY: number
  pdfWidth: number
  pdfHeight: number
  // Range within the concatenated page string
  startOffset: number
  endOffset: number
}

// Find all matches of `needle` on every page and convert each match's
// approximate bounding box into a Redaction. `needle` can be a literal string
// or a regex. Strings are matched case-insensitively as substrings.
export async function findRedactionsInDoc(
  doc: PDFDocumentProxy,
  needle: string | RegExp
): Promise<Redaction[]> {
  const out: Redaction[] = []
  const regex = needle instanceof RegExp
    ? new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : needle.flags + 'g')
    : new RegExp(escapeRegex(needle), 'gi')

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const { height: pageHeight } = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()

    // Build a flat string for searching, plus a parallel list of item slots
    // that record where each substring lives geometrically.
    const slots: ItemSlot[] = []
    let concat = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      const str = item.str
      const transform = item.transform
      // transform = [a b c d e f]; e/f are translateX/Y in PDF coords (bottom-left)
      // For straight horizontal text without rotation: baseline at (e, f), text rises by height
      const pdfX = transform[4]
      const baselineY = transform[5]
      const itemHeight = item.height || Math.abs(transform[3]) || 12
      const itemWidth = item.width || 0
      const pdfYTopLeft = pageHeight - baselineY - itemHeight
      const startOffset = concat.length
      concat += str
      const endOffset = concat.length
      slots.push({
        text: str,
        pdfX,
        pdfY: pdfYTopLeft,
        pdfWidth: itemWidth,
        pdfHeight: itemHeight,
        startOffset,
        endOffset
      })
      // Add a space between items so words separated by item boundaries stay
      // searchable. This shifts subsequent offsets, which is fine because
      // slots themselves are anchored to their own [startOffset, endOffset).
      if (item.hasEOL) {
        concat += '\n'
      } else {
        concat += ' '
      }
    }

    // Find all matches in the concatenated text and resolve each match back
    // to one or more item slots, then to per-slot pixel rectangles.
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(concat)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1
        continue
      }
      const matchStart = m.index
      const matchEnd = m.index + m[0].length
      for (const slot of slots) {
        const overlapStart = Math.max(slot.startOffset, matchStart)
        const overlapEnd = Math.min(slot.endOffset, matchEnd)
        if (overlapEnd <= overlapStart) continue
        // Proportional positioning within the slot's bbox.
        const localStart = overlapStart - slot.startOffset
        const localEnd = overlapEnd - slot.startOffset
        const itemLen = Math.max(1, slot.endOffset - slot.startOffset)
        const fracStart = localStart / itemLen
        const fracEnd = localEnd / itemLen
        const x = slot.pdfX + fracStart * slot.pdfWidth
        const width = (fracEnd - fracStart) * slot.pdfWidth
        if (width <= 0) continue
        out.push({
          id: crypto.randomUUID(),
          pageNumber: p,
          x,
          y: slot.pdfY,
          width,
          height: slot.pdfHeight
        })
      }
    }
  }
  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

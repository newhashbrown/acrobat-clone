import { PDFDocument, PDFDict, PDFArray, PDFName, PDFString } from 'pdf-lib'

export interface SanitizeOptions {
  metadata: boolean
  bookmarks: boolean
  javascript: boolean
  annotations: boolean
  formData: boolean
  attachments: boolean
}

export interface AuditReport {
  metadata: {
    fieldsCleared: string[]
    xmpRemoved: boolean
  }
  bookmarks: number
  javascript: {
    namedScripts: number
    openAction: boolean
    additionalActions: number
  }
  annotations: {
    total: number
    perPage: Record<number, number>
  }
  formData: {
    fields: number
    flattened: boolean
  }
  attachments: string[]
}

export interface PreScanReport {
  metadata: Array<{ key: string; value: string }>
  hasXmp: boolean
  bookmarks: number
  javascript: {
    namedScripts: number
    openAction: boolean
    additionalActions: number
  }
  annotations: {
    total: number
    perPage: Record<number, number>
  }
  formFields: number
  attachments: string[]
}

const META_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'] as const

// ---------- pre-scan ----------

export async function preScan(bytes: ArrayBuffer): Promise<PreScanReport> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const catalog = pdf.catalog
  const context = pdf.context

  // --- Metadata ---
  const metadata: Array<{ key: string; value: string }> = []
  const info = context.lookup(pdf.context.trailerInfo.Info) as PDFDict | undefined
  if (info) {
    for (const key of META_KEYS) {
      const v = info.lookup(PDFName.of(key))
      if (v && 'asString' in v) {
        const s = (v as PDFString).asString()
        if (s) metadata.push({ key, value: s })
      }
    }
  }
  const hasXmp = catalog.lookup(PDFName.of('Metadata')) !== undefined

  // --- Bookmarks ---
  const outlines = catalog.lookup(PDFName.of('Outlines')) as PDFDict | undefined
  let bookmarks = 0
  if (outlines) {
    const first = outlines.lookup(PDFName.of('First'))
    bookmarks = first ? countOutlines(first as PDFDict) : 0
  }

  // --- JavaScript ---
  const names = catalog.lookup(PDFName.of('Names')) as PDFDict | undefined
  let namedScripts = 0
  if (names) {
    const js = names.lookup(PDFName.of('JavaScript')) as PDFDict | undefined
    if (js) namedScripts = countNameTree(js)
  }
  const openAction = catalog.lookup(PDFName.of('OpenAction')) !== undefined
  const aa = catalog.lookup(PDFName.of('AA')) as PDFDict | undefined
  let additionalActions = aa ? aa.keys().length : 0
  // Also page-level /AA
  for (let i = 0; i < pdf.getPageCount(); i++) {
    const page = pdf.getPage(i)
    const pageAA = page.node.lookup(PDFName.of('AA')) as PDFDict | undefined
    if (pageAA) additionalActions += pageAA.keys().length
  }

  // --- Annotations ---
  let totalAnnots = 0
  const perPage: Record<number, number> = {}
  for (let i = 0; i < pdf.getPageCount(); i++) {
    const page = pdf.getPage(i)
    const annots = page.node.lookup(PDFName.of('Annots')) as PDFArray | undefined
    if (annots) {
      const count = annots.size()
      if (count > 0) {
        perPage[i + 1] = count
        totalAnnots += count
      }
    }
  }

  // --- Form fields ---
  let formFields = 0
  try {
    const form = pdf.getForm()
    formFields = form.getFields().length
  } catch {
    // no form
  }

  // --- Attachments ---
  const attachments: string[] = []
  if (names) {
    const ef = names.lookup(PDFName.of('EmbeddedFiles')) as PDFDict | undefined
    if (ef) walkNameTreeNames(ef, attachments)
  }

  return {
    metadata,
    hasXmp,
    bookmarks,
    javascript: { namedScripts, openAction, additionalActions },
    annotations: { total: totalAnnots, perPage },
    formFields,
    attachments
  }
}

// ---------- sanitize ----------

export async function sanitize(
  bytes: ArrayBuffer,
  opts: SanitizeOptions
): Promise<{ bytes: Uint8Array; audit: AuditReport }> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const catalog = pdf.catalog
  const context = pdf.context

  const audit: AuditReport = {
    metadata: { fieldsCleared: [], xmpRemoved: false },
    bookmarks: 0,
    javascript: { namedScripts: 0, openAction: false, additionalActions: 0 },
    annotations: { total: 0, perPage: {} },
    formData: { fields: 0, flattened: false },
    attachments: []
  }

  if (opts.metadata) {
    const info = context.lookup(pdf.context.trailerInfo.Info) as PDFDict | undefined
    if (info) {
      for (const key of META_KEYS) {
        const k = PDFName.of(key)
        const v = info.lookup(k)
        if (v) {
          audit.metadata.fieldsCleared.push(key)
          info.delete(k)
        }
      }
    }
    if (catalog.lookup(PDFName.of('Metadata'))) {
      catalog.delete(PDFName.of('Metadata'))
      audit.metadata.xmpRemoved = true
    }
  }

  if (opts.bookmarks) {
    const outlines = catalog.lookup(PDFName.of('Outlines')) as PDFDict | undefined
    if (outlines) {
      const first = outlines.lookup(PDFName.of('First'))
      audit.bookmarks = first ? countOutlines(first as PDFDict) : 0
      catalog.delete(PDFName.of('Outlines'))
    }
    if (catalog.lookup(PDFName.of('PageMode'))) {
      catalog.delete(PDFName.of('PageMode'))
    }
  }

  if (opts.javascript) {
    const names = catalog.lookup(PDFName.of('Names')) as PDFDict | undefined
    if (names) {
      const js = names.lookup(PDFName.of('JavaScript')) as PDFDict | undefined
      if (js) {
        audit.javascript.namedScripts = countNameTree(js)
        names.delete(PDFName.of('JavaScript'))
      }
    }
    if (catalog.lookup(PDFName.of('OpenAction'))) {
      catalog.delete(PDFName.of('OpenAction'))
      audit.javascript.openAction = true
    }
    const aa = catalog.lookup(PDFName.of('AA')) as PDFDict | undefined
    if (aa) {
      audit.javascript.additionalActions += aa.keys().length
      catalog.delete(PDFName.of('AA'))
    }
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const page = pdf.getPage(i)
      const pageAA = page.node.lookup(PDFName.of('AA')) as PDFDict | undefined
      if (pageAA) {
        audit.javascript.additionalActions += pageAA.keys().length
        page.node.delete(PDFName.of('AA'))
      }
    }
  }

  if (opts.annotations) {
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const page = pdf.getPage(i)
      const annots = page.node.lookup(PDFName.of('Annots')) as PDFArray | undefined
      if (annots) {
        const count = annots.size()
        if (count > 0) {
          audit.annotations.perPage[i + 1] = count
          audit.annotations.total += count
          page.node.delete(PDFName.of('Annots'))
        }
      }
    }
  }

  if (opts.formData) {
    try {
      const form = pdf.getForm()
      const fields = form.getFields()
      audit.formData.fields = fields.length
      if (fields.length > 0) {
        form.flatten()
        audit.formData.flattened = true
      }
    } catch {
      // no form
    }
    if (catalog.lookup(PDFName.of('AcroForm'))) {
      catalog.delete(PDFName.of('AcroForm'))
    }
  }

  if (opts.attachments) {
    const names = catalog.lookup(PDFName.of('Names')) as PDFDict | undefined
    if (names) {
      const ef = names.lookup(PDFName.of('EmbeddedFiles')) as PDFDict | undefined
      if (ef) {
        walkNameTreeNames(ef, audit.attachments)
        names.delete(PDFName.of('EmbeddedFiles'))
      }
    }
  }

  // Force a clean rewrite that won't preserve unreferenced objects.
  const out = await pdf.save({ useObjectStreams: false })
  return { bytes: out, audit }
}

// ---------- helpers ----------

function countOutlines(node: PDFDict): number {
  let total = 0
  let cur: PDFDict | undefined = node
  while (cur) {
    total += 1
    const child = cur.lookup(PDFName.of('First')) as PDFDict | undefined
    if (child) total += countOutlines(child)
    cur = cur.lookup(PDFName.of('Next')) as PDFDict | undefined
  }
  return total
}

function countNameTree(node: PDFDict): number {
  // Name trees have either /Names (leaf) or /Kids (intermediate)
  const namesArr = node.lookup(PDFName.of('Names')) as PDFArray | undefined
  if (namesArr) return namesArr.size() / 2
  const kids = node.lookup(PDFName.of('Kids')) as PDFArray | undefined
  if (!kids) return 0
  let total = 0
  for (let i = 0; i < kids.size(); i++) {
    const child = kids.lookup(i) as PDFDict | undefined
    if (child) total += countNameTree(child)
  }
  return total
}

function walkNameTreeNames(node: PDFDict, out: string[]): void {
  const namesArr = node.lookup(PDFName.of('Names')) as PDFArray | undefined
  if (namesArr) {
    for (let i = 0; i < namesArr.size(); i += 2) {
      const nameEntry = namesArr.lookup(i)
      if (nameEntry && 'asString' in nameEntry) {
        out.push((nameEntry as PDFString).asString())
      }
    }
    return
  }
  const kids = node.lookup(PDFName.of('Kids')) as PDFArray | undefined
  if (!kids) return
  for (let i = 0; i < kids.size(); i++) {
    const child = kids.lookup(i) as PDFDict | undefined
    if (child) walkNameTreeNames(child, out)
  }
}

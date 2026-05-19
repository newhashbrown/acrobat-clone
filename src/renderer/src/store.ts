import { create } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OcrPageResult } from './ocr'

export type ViewMode = 'single' | 'two-up' | 'continuous'
export type SidePanel = 'metadata' | 'search' | 'ocr' | 'diff' | null

export type PageRotation = 0 | 90 | 180 | 270

export type PageSource = { kind: 'doc' } | { kind: 'external'; externalId: string }

export interface PageItem {
  id: string
  source: PageSource
  originalIndex: number // 0-based within the source doc
  rotation: PageRotation // additional rotation on top of the source page's own rotation
}

export interface ExternalDoc {
  id: string
  fileName: string
  bytes: ArrayBuffer
  doc: PDFDocumentProxy
}

interface HistorySnapshot {
  redactions: Redaction[]
  signatures: PlacedSignature[]
}

const HISTORY_LIMIT = 50

export interface PlacedSignature {
  id: string
  pageNumber: number
  // PDF-space coords (origin top-left, page units)
  x: number
  y: number
  width: number
  height: number
  imageDataUrl: string
}

export interface Redaction {
  id: string
  pageNumber: number
  // PDF-space coords (origin top-left, page units)
  x: number
  y: number
  width: number
  height: number
}

export interface DocMetadata {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
  pageCount: number
  fileSize: number
}

interface ViewerState {
  doc: PDFDocumentProxy | null
  bytes: ArrayBuffer | null
  filePath: string | null
  fileName: string | null
  fileSize: number
  pageCount: number
  currentPage: number
  zoom: number // 1.0 = 100%
  fitMode: 'custom' | 'width' | 'page'
  viewMode: ViewMode
  sidePanel: SidePanel
  metadata: DocMetadata | null
  signatures: PlacedSignature[]
  redactions: Redaction[]
  redactMode: boolean
  ocrResults: Record<number, OcrPageResult>
  searchQuery: string
  // Compare mode: a second PDF loaded for side-by-side diff
  compareDoc: PDFDocumentProxy | null
  compareFileName: string | null
  compareMode: boolean
  // Organize Pages mode
  organizeActive: boolean
  organizeItems: PageItem[]
  organizeSelected: Set<string>
  organizeExternalDocs: Record<string, ExternalDoc>
  // Undo/redo: snapshots of the edit-bearing slices (redactions + signatures).
  // Page navigation, zoom, view-mode etc. are intentionally excluded — those
  // are ephemeral and would just pollute history.
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]

  setDoc: (
    doc: PDFDocumentProxy,
    bytes: ArrayBuffer,
    filePath: string,
    fileName: string,
    fileSize: number,
    metadata: DocMetadata
  ) => void
  closeDoc: () => void
  setPage: (n: number) => void
  setZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
  setFitMode: (m: 'custom' | 'width' | 'page') => void
  setViewMode: (m: ViewMode) => void
  toggleSidePanel: (p: SidePanel) => void
  setSearchQuery: (q: string) => void
  addSignature: (sig: PlacedSignature) => void
  updateSignature: (id: string, patch: Partial<PlacedSignature>) => void
  removeSignature: (id: string) => void
  clearSignatures: () => void
  toggleRedactMode: () => void
  setRedactMode: (on: boolean) => void
  addRedaction: (r: Redaction) => void
  addRedactions: (rs: Redaction[]) => void
  removeRedaction: (id: string) => void
  clearRedactions: () => void
  setOcrResult: (r: OcrPageResult) => void
  clearOcrResults: () => void
  setCompareDoc: (doc: PDFDocumentProxy | null, fileName: string | null) => void
  setCompareMode: (on: boolean) => void
  enterOrganize: () => void
  exitOrganize: () => void
  setOrganizeItems: (items: PageItem[]) => void
  setOrganizeSelected: (selected: Set<string>) => void
  registerExternalDoc: (doc: ExternalDoc) => void
  undo: () => boolean
  redo: () => boolean
}

export const useViewer = create<ViewerState>((set, get) => ({
  doc: null,
  bytes: null,
  filePath: null,
  fileName: null,
  fileSize: 0,
  pageCount: 0,
  currentPage: 1,
  zoom: 1,
  fitMode: 'width',
  viewMode: 'continuous',
  sidePanel: null,
  metadata: null,
  signatures: [],
  redactions: [],
  redactMode: false,
  ocrResults: {},
  searchQuery: '',
  compareDoc: null,
  compareFileName: null,
  compareMode: false,
  organizeActive: false,
  organizeItems: [],
  organizeSelected: new Set(),
  organizeExternalDocs: {},
  undoStack: [],
  redoStack: [],

  setDoc: (doc, bytes, filePath, fileName, fileSize, metadata) =>
    set({
      doc,
      bytes,
      filePath,
      fileName,
      fileSize,
      pageCount: doc.numPages,
      metadata,
      currentPage: 1,
      signatures: [],
      redactions: [],
      redactMode: false,
      ocrResults: {},
      compareDoc: null,
      compareFileName: null,
      compareMode: false,
      organizeActive: false,
      organizeItems: [],
      organizeSelected: new Set(),
      organizeExternalDocs: {},
      undoStack: [],
      redoStack: []
    }),
  closeDoc: () =>
    set({
      doc: null,
      bytes: null,
      filePath: null,
      fileName: null,
      fileSize: 0,
      pageCount: 0,
      currentPage: 1,
      metadata: null,
      signatures: [],
      redactions: [],
      redactMode: false,
      ocrResults: {},
      compareDoc: null,
      compareFileName: null,
      compareMode: false,
      organizeActive: false,
      organizeItems: [],
      organizeSelected: new Set(),
      organizeExternalDocs: {},
      undoStack: [],
      redoStack: []
    }),
  setPage: (n) => {
    const max = get().pageCount
    if (max <= 0) return
    set({ currentPage: Math.max(1, Math.min(max, n)) })
  },
  setZoom: (z) => set({ zoom: Math.max(0.25, Math.min(6, z)), fitMode: 'custom' }),
  zoomIn: () => {
    const z = get().zoom
    const next = Math.min(6, Math.round(z * 1.2 * 100) / 100)
    set({ zoom: next, fitMode: 'custom' })
  },
  zoomOut: () => {
    const z = get().zoom
    const next = Math.max(0.25, Math.round((z / 1.2) * 100) / 100)
    set({ zoom: next, fitMode: 'custom' })
  },
  setFitMode: (m) => set({ fitMode: m }),
  setViewMode: (m) => set({ viewMode: m }),
  toggleSidePanel: (p) => set({ sidePanel: get().sidePanel === p ? null : p }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  addSignature: (sig) => {
    pushHistoryFromGet(get, set)
    set({ signatures: [...get().signatures, sig] })
  },
  updateSignature: (id, patch) => {
    // Don't push history on every drag tick — too noisy. The eventual position
    // is captured at drag start by addSignature's history entry, and only the
    // final delete/clear actions deserve their own history entries.
    set({
      signatures: get().signatures.map((s) => (s.id === id ? { ...s, ...patch } : s))
    })
  },
  removeSignature: (id) => {
    pushHistoryFromGet(get, set)
    set({ signatures: get().signatures.filter((s) => s.id !== id) })
  },
  clearSignatures: () => {
    if (get().signatures.length === 0) return
    pushHistoryFromGet(get, set)
    set({ signatures: [] })
  },
  toggleRedactMode: () => set({ redactMode: !get().redactMode }),
  setRedactMode: (on) => set({ redactMode: on }),
  addRedaction: (r) => {
    pushHistoryFromGet(get, set)
    set({ redactions: [...get().redactions, r] })
  },
  addRedactions: (rs) => {
    if (rs.length === 0) return
    pushHistoryFromGet(get, set)
    set({ redactions: [...get().redactions, ...rs] })
  },
  removeRedaction: (id) => {
    pushHistoryFromGet(get, set)
    set({ redactions: get().redactions.filter((r) => r.id !== id) })
  },
  clearRedactions: () => {
    if (get().redactions.length === 0) return
    pushHistoryFromGet(get, set)
    set({ redactions: [] })
  },
  setOcrResult: (r) =>
    set({ ocrResults: { ...get().ocrResults, [r.pageNumber]: r } }),
  clearOcrResults: () => set({ ocrResults: {} }),
  setCompareDoc: (doc, fileName) => set({ compareDoc: doc, compareFileName: fileName }),
  setCompareMode: (on) => set({ compareMode: on }),
  enterOrganize: () => {
    const count = get().pageCount
    const items: PageItem[] = Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      source: { kind: 'doc' },
      originalIndex: i,
      rotation: 0
    }))
    set({
      organizeActive: true,
      organizeItems: items,
      organizeSelected: new Set(),
      organizeExternalDocs: {}
    })
  },
  exitOrganize: () =>
    set({
      organizeActive: false,
      organizeItems: [],
      organizeSelected: new Set(),
      organizeExternalDocs: {},
      undoStack: [],
      redoStack: []
    }),
  setOrganizeItems: (items) => set({ organizeItems: items }),
  setOrganizeSelected: (selected) => set({ organizeSelected: selected }),
  registerExternalDoc: (doc) =>
    set({
      organizeExternalDocs: { ...get().organizeExternalDocs, [doc.id]: doc }
    }),
  undo: () => {
    const { undoStack, redactions, signatures } = get()
    if (undoStack.length === 0) return false
    const prev = undoStack[undoStack.length - 1]
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, { redactions, signatures }].slice(-HISTORY_LIMIT),
      redactions: prev.redactions,
      signatures: prev.signatures
    })
    return true
  },
  redo: () => {
    const { redoStack, redactions, signatures } = get()
    if (redoStack.length === 0) return false
    const next = redoStack[redoStack.length - 1]
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, { redactions, signatures }].slice(-HISTORY_LIMIT),
      redactions: next.redactions,
      signatures: next.signatures
    })
    return true
  }
}))

// Capture the current edit-bearing state and push it onto the undo stack.
// Called by every action that mutates redactions or signatures.
function pushHistoryFromGet(
  get: () => ViewerState,
  set: (partial: Partial<ViewerState>) => void
) {
  const { redactions, signatures, undoStack } = get()
  set({
    undoStack: [...undoStack, { redactions, signatures }].slice(-HISTORY_LIMIT),
    redoStack: []
  })
}

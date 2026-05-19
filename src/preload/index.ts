import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

export interface OpenedPdf {
  path: string
  name: string
  size: number
  bytes: ArrayBuffer
}

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

type MenuChannel =
  | 'menu:open'
  | 'menu:save-copy'
  | 'menu:print'
  | 'menu:find'
  | 'menu:zoom-in'
  | 'menu:zoom-out'
  | 'menu:zoom-reset'
  | 'menu:sign'
  | 'menu:redact'
  | 'menu:merge'
  | 'menu:split'
  | 'menu:ocr'
  | 'menu:compare'
  | 'menu:sanitize'
  | 'menu:organize'
  | 'menu:undo'
  | 'menu:redo'
  | 'menu:about'

const api = {
  openPdf: (): Promise<OpenedPdf | null> => ipcRenderer.invoke('dialog:open-pdf'),
  openPdfs: (): Promise<OpenedPdf[] | null> => ipcRenderer.invoke('dialog:open-pdfs'),
  openPath: (p: string): Promise<OpenedPdf | { error: string } | null> =>
    ipcRenderer.invoke('file:open-path', p),
  savePdf: (bytes: ArrayBuffer, suggestedName: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke('dialog:save-pdf', bytes, suggestedName),
  saveMany: (
    files: Array<{ name: string; bytes: ArrayBuffer }>
  ): Promise<{ dir: string; paths: string[] } | null> =>
    ipcRenderer.invoke('dialog:save-many', files),
  recentList: (): Promise<RecentFile[]> => ipcRenderer.invoke('recent:list'),
  recentClear: (): Promise<RecentFile[]> => ipcRenderer.invoke('recent:clear'),
  print: (): Promise<void> => ipcRenderer.invoke('app:print'),
  onMenu: (channel: MenuChannel, listener: () => void) => {
    const handler = (_e: IpcRendererEvent) => listener()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('akv', api)

export type AkvApi = typeof api

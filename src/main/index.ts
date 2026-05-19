import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { readFile, writeFile, stat } from 'node:fs/promises'
import Store from 'electron-store'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface RecentFile {
  path: string
  name: string
  openedAt: number
}

interface StoreSchema {
  recentFiles: RecentFile[]
  windowBounds: { width: number; height: number; x?: number; y?: number }
}

const store = new Store<StoreSchema>({
  defaults: {
    recentFiles: [],
    windowBounds: { width: 1280, height: 860 }
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const bounds = store.get('windowBounds')

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Acrobat Clone',
    backgroundColor: '#1f1f23',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', () => {
    if (!mainWindow) return
    const b = mainWindow.getBounds()
    store.set('windowBounds', b)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open')
        },
        {
          label: 'Combine PDFs…',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => mainWindow?.webContents.send('menu:merge')
        },
        {
          label: 'Split PDF…',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => mainWindow?.webContents.send('menu:split')
        },
        {
          label: 'Recognize Text (OCR)…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:ocr')
        },
        {
          label: 'Compare PDFs…',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => mainWindow?.webContents.send('menu:compare')
        },
        {
          label: 'Sanitize PDF…',
          accelerator: 'CmdOrCtrl+Shift+X',
          click: () => mainWindow?.webContents.send('menu:sanitize')
        },
        {
          label: 'Organize Pages…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('menu:organize')
        },
        {
          label: 'Save Copy…',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save-copy')
        },
        { type: 'separator' },
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('menu:print')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('menu:redo')
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:find')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow?.webContents.send('menu:zoom-in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow?.webContents.send('menu:zoom-out')
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow?.webContents.send('menu:zoom-reset')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Sign',
      submenu: [
        {
          label: 'Add Signature…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:sign')
        },
        {
          label: 'Toggle Redact Mode',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.send('menu:redact')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Acrobat Clone',
          click: () => mainWindow?.webContents.send('menu:about')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function pushRecent(filePath: string): RecentFile[] {
  const list = store.get('recentFiles')
  const filtered = list.filter((f) => f.path !== filePath)
  const next: RecentFile[] = [
    { path: filePath, name: basename(filePath), openedAt: Date.now() },
    ...filtered
  ].slice(0, 12)
  store.set('recentFiles', next)
  return next
}

ipcMain.handle('dialog:open-pdf', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const data = await readFile(filePath)
  const info = await stat(filePath)
  pushRecent(filePath)
  return {
    path: filePath,
    name: basename(filePath),
    size: info.size,
    bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
})

ipcMain.handle('dialog:open-pdfs', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add PDFs to combine',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const files = []
  for (const filePath of result.filePaths) {
    const data = await readFile(filePath)
    files.push({
      path: filePath,
      name: basename(filePath),
      size: data.byteLength,
      bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    })
  }
  return files
})

ipcMain.handle('file:open-path', async (_e, filePath: string) => {
  try {
    const data = await readFile(filePath)
    const info = await stat(filePath)
    pushRecent(filePath)
    return {
      path: filePath,
      name: basename(filePath),
      size: info.size,
      bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    }
  } catch (err) {
    return { error: (err as Error).message }
  }
})

ipcMain.handle('dialog:save-pdf', async (_e, bytes: ArrayBuffer, suggestedName: string) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF Copy',
    defaultPath: suggestedName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, Buffer.from(bytes))
  return { path: result.filePath }
})

ipcMain.handle(
  'dialog:save-many',
  async (_e, files: Array<{ name: string; bytes: ArrayBuffer }>) => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for the split files',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const dir = result.filePaths[0]
    const written: string[] = []
    for (const f of files) {
      const safeName = f.name.replace(/[\\/:*?"<>|]/g, '_')
      const target = join(dir, safeName)
      await writeFile(target, Buffer.from(f.bytes))
      written.push(target)
    }
    return { dir, paths: written }
  }
)

ipcMain.handle('recent:list', () => store.get('recentFiles'))

ipcMain.handle('recent:clear', () => {
  store.set('recentFiles', [])
  return []
})

ipcMain.handle('app:print', () => {
  if (!mainWindow) return
  mainWindow.webContents.print({ silent: false, printBackground: true })
})

app.whenReady().then(() => {
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

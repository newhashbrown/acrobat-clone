// Copies pre-built vendor files into src/renderer/public/ so the renderer can
// load them as same-origin URLs in dev and from disk in the packaged build.
// Runs from postinstall, so anyone who clones + `npm install` gets a working
// dev environment without extra steps.

const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'src', 'renderer', 'public')

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  console.log('  copied', path.relative(projectRoot, dst))
}

// --- pdf.js worker ---
copy(
  require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),
  path.join(publicDir, 'pdf.worker.min.mjs')
)

// --- tesseract.js: worker script + WASM cores ---
copy(
  require.resolve('tesseract.js/dist/worker.min.js'),
  path.join(publicDir, 'tesseract', 'worker.min.js')
)

const coreDir = path.dirname(require.resolve('tesseract.js-core/package.json'))
const coreCandidates = [
  'tesseract-core.wasm.js',
  'tesseract-core.wasm',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-simd.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm'
]
for (const name of coreCandidates) {
  const src = path.join(coreDir, name)
  if (fs.existsSync(src)) copy(src, path.join(publicDir, 'tesseract', name))
}

console.log('vendor assets ready')

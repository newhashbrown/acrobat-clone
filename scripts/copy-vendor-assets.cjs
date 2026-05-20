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
// tesseract.js v7's worker probes the host for SIMD + relaxed-SIMD at runtime
// and importScripts() whichever core variant matches. Missing a variant the
// runtime picks is fatal — the importScripts 404s silently inside the Web
// Worker and createWorker() hangs forever (this exact bug shipped before
// the relaxed-SIMD builds were added). Rather than hardcode the list and
// re-break every time tesseract.js-core adds a variant, glob the package's
// shipped wasm{,.js} pairs and copy them all. Pattern: tesseract-core*.wasm
// and tesseract-core*.wasm.js at the top level of tesseract.js-core.
const corePattern = /^tesseract-core.*\.wasm(\.js)?$/
const coreFiles = fs.readdirSync(coreDir).filter((name) => corePattern.test(name))
if (coreFiles.length === 0) {
  console.error(
    '  ! no tesseract-core*.wasm files found in ' + coreDir +
      ' — OCR will be broken at runtime. Check that tesseract.js-core is installed correctly.'
  )
  process.exit(1)
}
for (const name of coreFiles) {
  copy(path.join(coreDir, name), path.join(publicDir, 'tesseract', name))
}
console.log(`  ${coreFiles.length} tesseract-core variants copied`)

console.log('vendor assets ready')

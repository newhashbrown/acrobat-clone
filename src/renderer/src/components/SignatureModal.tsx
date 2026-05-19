import { useEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'

interface SignatureResult {
  dataUrl: string
  // Aspect ratio (width / height) of the source image; used to size the placed signature.
  aspectRatio: number
}

interface Props {
  open: boolean
  onCancel: () => void
  onConfirm: (sig: SignatureResult) => void
}

export function SignatureModal({ open, onCancel, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const [drawEmpty, setDrawEmpty] = useState(true)
  const [typed, setTyped] = useState('')
  const [uploaded, setUploaded] = useState<{ dataUrl: string; aspect: number } | null>(null)

  useEffect(() => {
    if (!open) {
      padRef.current?.off()
      padRef.current = null
      setDrawEmpty(true)
      setTyped('')
      setUploaded(null)
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    // Size canvas to its CSS box (HiDPI-aware)
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d')!.scale(ratio, ratio)
    const pad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255,255,255,0)',
      penColor: '#111'
    })
    pad.addEventListener('endStroke', () => setDrawEmpty(pad.isEmpty()))
    padRef.current = pad
    return () => {
      pad.off()
    }
  }, [open])

  if (!open) return null

  const clearDrawn = () => {
    padRef.current?.clear()
    setDrawEmpty(true)
  }

  const useDrawn = () => {
    const pad = padRef.current
    const canvas = canvasRef.current
    if (!pad || pad.isEmpty() || !canvas) return
    const trimmed = trimTransparent(canvas)
    onConfirm({ dataUrl: trimmed.dataUrl, aspectRatio: trimmed.width / trimmed.height })
  }

  const useTyped = () => {
    if (!typed.trim()) return
    const { dataUrl, aspectRatio } = renderTypedSignature(typed)
    onConfirm({ dataUrl, aspectRatio })
  }

  const useUploaded = () => {
    if (!uploaded) return
    onConfirm({ dataUrl: uploaded.dataUrl, aspectRatio: uploaded.aspect })
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => setUploaded({ dataUrl, aspect: img.width / img.height })
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal sig-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Signature</h2>
        <div className="sig-body">
          <section className="sig-section">
            <header className="sig-section-head">
              <h3>Draw</h3>
              <button onClick={clearDrawn} disabled={drawEmpty}>
                Clear
              </button>
            </header>
            <div className="sig-canvas-wrap">
              <canvas ref={canvasRef} />
              {drawEmpty && <div className="hint">Draw your signature here</div>}
            </div>
            <button className="primary block" disabled={drawEmpty} onClick={useDrawn}>
              Use drawn signature
            </button>
          </section>

          <section className="sig-section">
            <header className="sig-section-head">
              <h3>Type</h3>
            </header>
            <input
              type="text"
              className="sig-type-input"
              placeholder="Type your name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') useTyped()
              }}
            />
            {typed.trim() && (
              <div className="sig-preview-line">{typed}</div>
            )}
            <button className="primary block" disabled={!typed.trim()} onClick={useTyped}>
              Use typed signature
            </button>
          </section>

          <section className="sig-section">
            <header className="sig-section-head">
              <h3>Upload image</h3>
            </header>
            <label className="sig-upload-zone">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleUpload}
                hidden
              />
              {uploaded ? (
                <img src={uploaded.dataUrl} alt="Uploaded signature" />
              ) : (
                <span>PNG or JPG with transparent background — click to choose…</span>
              )}
            </label>
            <button className="primary block" disabled={!uploaded} onClick={useUploaded}>
              Use uploaded image
            </button>
          </section>
        </div>

        <div className="actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// Render typed text into a transparent canvas with a cursive font.
function renderTypedSignature(text: string): SignatureResult {
  const fontSize = 64
  const padding = 20
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `italic ${fontSize}px "Brush Script MT", "Lucida Handwriting", cursive`
  const w = Math.ceil(measure.measureText(text).width) + padding * 2
  const h = fontSize + padding * 2
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.font = measure.font
  ctx.fillStyle = '#111'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, padding, h / 2)
  return { dataUrl: canvas.toDataURL('image/png'), aspectRatio: w / h }
}

// Trim transparent edges from a drawn canvas so the placed signature isn't a huge box.
function trimTransparent(source: HTMLCanvasElement): {
  dataUrl: string
  width: number
  height: number
} {
  const w = source.width
  const h = source.height
  const ctx = source.getContext('2d')!
  const data = ctx.getImageData(0, 0, w, h).data
  let top = h
  let bottom = 0
  let left = w
  let right = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3]
      if (alpha > 8) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (right <= left || bottom <= top) {
    return { dataUrl: source.toDataURL('image/png'), width: w, height: h }
  }
  const pad = 4
  const tx = Math.max(0, left - pad)
  const ty = Math.max(0, top - pad)
  const tw = Math.min(w, right - tx + pad * 2)
  const th = Math.min(h, bottom - ty + pad * 2)
  const out = document.createElement('canvas')
  out.width = tw
  out.height = th
  out.getContext('2d')!.drawImage(source, tx, ty, tw, th, 0, 0, tw, th)
  return { dataUrl: out.toDataURL('image/png'), width: tw, height: th }
}

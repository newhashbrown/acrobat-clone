import type { PDFPageProxy } from 'pdfjs-dist'

// PDF.js doesn't ship a clean TypeScript shape for annotation objects —
// `getAnnotations()` returns `Promise<any[]>` in the published .d.ts. The
// fields below are the ones we actually consume off widget annotations.
interface RawWidgetAnnotation {
  annotationType?: number
  subtype?: string
  fieldType?: 'Tx' | 'Btn' | 'Ch' | 'Sig' | string
  fieldName?: string
  fieldValue?: string | string[]
  defaultFieldValue?: string
  rect?: [number, number, number, number]
  id?: string
  readOnly?: boolean
  hidden?: boolean
  // Tx
  multiLine?: boolean
  maxLen?: number
  // Btn
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  buttonValue?: string
  exportValue?: string
  // Ch
  combo?: boolean
  options?: Array<{ exportValue: string; displayValue: string }>
}

export type FormFieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown'

interface BaseField {
  id: string
  name: string
  cssLeft: number
  cssTop: number
  cssWidth: number
  cssHeight: number
  readOnly: boolean
}

export interface TextFormField extends BaseField {
  kind: 'text'
  multiline: boolean
  maxLength?: number
  defaultValue: string
}

export interface CheckboxFormField extends BaseField {
  kind: 'checkbox'
  exportValue: string
  defaultChecked: boolean
}

export interface RadioFormField extends BaseField {
  kind: 'radio'
  exportValue: string
  defaultChecked: boolean
}

export interface DropdownFormField extends BaseField {
  kind: 'dropdown'
  options: Array<{ exportValue: string; displayValue: string }>
  combo: boolean
  defaultValue: string
}

export type FormField =
  | TextFormField
  | CheckboxFormField
  | RadioFormField
  | DropdownFormField

// Pull widget annotations off a page and convert them into render-ready
// field descriptors with CSS-pixel rects. Push-button widgets and signature
// fields are filtered out (the former has no value to capture, the latter
// is the existing signature flow's job).
export async function extractFormFields(
  page: PDFPageProxy,
  scale: number
): Promise<FormField[]> {
  // intent: 'forms' nudges PDF.js to skip pure-display annotations and only
  // hand back interactive widget data. Older PDF.js builds ignore the option
  // and return everything; we filter again below to be safe.
  const annotations = (await page.getAnnotations({
    intent: 'forms'
  })) as RawWidgetAnnotation[]

  const viewport = page.getViewport({ scale })
  const out: FormField[] = []

  for (const a of annotations) {
    if (a.subtype !== 'Widget' || !a.fieldName || !a.rect) continue
    if (a.hidden) continue
    // Push buttons have no value; signature widgets are out of scope here.
    if (a.fieldType === 'Sig') continue
    if (a.fieldType === 'Btn' && a.pushButton) continue

    const rect = viewport.convertToViewportRectangle(a.rect)
    const cssLeft = Math.min(rect[0], rect[2])
    const cssTop = Math.min(rect[1], rect[3])
    const cssWidth = Math.abs(rect[2] - rect[0])
    const cssHeight = Math.abs(rect[3] - rect[1])
    if (cssWidth < 2 || cssHeight < 2) continue

    const id = a.id ?? `${a.fieldName}-${out.length}`
    const base = {
      id,
      name: a.fieldName,
      cssLeft,
      cssTop,
      cssWidth,
      cssHeight,
      readOnly: !!a.readOnly
    }

    if (a.fieldType === 'Tx') {
      out.push({
        ...base,
        kind: 'text',
        multiline: !!a.multiLine,
        maxLength: typeof a.maxLen === 'number' && a.maxLen > 0 ? a.maxLen : undefined,
        defaultValue: stringifyValue(a.fieldValue ?? a.defaultFieldValue)
      })
    } else if (a.fieldType === 'Btn' && a.checkBox) {
      out.push({
        ...base,
        kind: 'checkbox',
        exportValue: a.exportValue || a.buttonValue || 'Yes',
        defaultChecked: isTruthyFieldValue(a.fieldValue, a.exportValue || a.buttonValue)
      })
    } else if (a.fieldType === 'Btn' && a.radioButton) {
      out.push({
        ...base,
        kind: 'radio',
        exportValue: a.buttonValue || a.exportValue || '',
        defaultChecked:
          stringifyValue(a.fieldValue) === (a.buttonValue || a.exportValue || '')
      })
    } else if (a.fieldType === 'Ch') {
      out.push({
        ...base,
        kind: 'dropdown',
        options: a.options ?? [],
        combo: !!a.combo,
        defaultValue: stringifyValue(a.fieldValue ?? a.defaultFieldValue)
      })
    }
  }

  return out
}

// Lightweight pass over a page's annotations to count fillable widgets,
// without the viewport-rectangle math extractFormFields does. Used on doc
// load to decide whether to surface the "fillable fields" toast.
export async function countFormFields(page: PDFPageProxy): Promise<number> {
  const annotations = (await page.getAnnotations({
    intent: 'forms'
  })) as RawWidgetAnnotation[]
  let n = 0
  for (const a of annotations) {
    if (a.subtype !== 'Widget' || !a.fieldName) continue
    if (a.hidden) continue
    if (a.fieldType === 'Sig') continue
    if (a.fieldType === 'Btn' && a.pushButton) continue
    n++
  }
  return n
}

function stringifyValue(v: string | string[] | undefined): string {
  if (v == null) return ''
  return Array.isArray(v) ? (v[0] ?? '') : v
}

// AcroForm checkbox "on" values vary per widget — some use 'Yes', others
// 'On', others use the export value of the widget itself. Treat any non-Off
// matching value as checked.
function isTruthyFieldValue(
  fieldValue: string | string[] | undefined,
  expectedOn: string | undefined
): boolean {
  const v = stringifyValue(fieldValue)
  if (!v || v === 'Off') return false
  if (expectedOn) return v === expectedOn
  return true
}

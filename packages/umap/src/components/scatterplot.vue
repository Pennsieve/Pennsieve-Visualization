<template>
  <div class="scatterplot-container" ref="containerRef">
    <canvas ref="canvasRef"></canvas>
    <div id="tooltip" ref="tooltipRef"></div>
    <div v-show="false" id="debug" ref="debugRef"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as d3 from 'd3'

const emit = defineEmits(['updateColorMap'])

const props = defineProps({
  pointCount: { type: Number, default: 5000 },
  colorMode: { type: String, default: 'random' },
  startColor: { type: String, default: '#ff0000' },
  endColor: { type: String, default: '#0000ff' },
  singleColor: { type: String, default: '#4285f4' },
  forceRegenerate: { type: Boolean, default: false },
  data: { type: Array, default: () => [] },
  metaData: { type: Object, default: () => ({}) },
  colorMap: { type: Map, default: () => new Map() },
  selectedMapEntries: { type: [Array, Map], default: () => [] },
  hoverFields: { type: Array, default: () => [] }
})

// Refs
const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const tooltipRef = ref<HTMLDivElement | null>(null)
const debugRef = ref<HTMLDivElement | null>(null)

// GL state
let gl: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let programInfo: any = null
let data: Array<any> = []
let transform: any = null
let zoom: any = null
let highlightedPoint: any = null
let cssWidth = 0
let cssHeight = 0
let dpr = 1

//------- watch --------
watch(() => props.colorMap, rebuildColorBufferForMode, { deep: true })

// ---------- helpers ----------
function formatLabel(v: any) {
  if (v === null) return '∅'
  if (v === undefined) return '—'
  return String(v)
}

function valueForColorMode(p: any) {
  if (!props.colorMode || props.colorMode === 'random') return undefined

  const schema = ((props.metaData as any)?.schema || []) as Array<{ name?: string }>
  const idx = schema.findIndex(s => s?.name === props.colorMode)

  if (idx >= 0) {
    const key = schema[idx]?.name || ''
    const vFromAttrs = p?.attrs?.[key]
    if (vFromAttrs !== undefined) return vFromAttrs

    if (Array.isArray(p?.rawRow)) return p.rawRow[idx]
  }

  return p?.attrs?.[props.colorMode]
}

function hexToRgb(hex: string): [number, number, number] {
  if (!hex || hex.length < 7) return [1, 0, 0]
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  if ([r, g, b].some(Number.isNaN)) return [1, 0, 0]
  return [r, g, b]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function sizeCanvasForDPR(canvas: HTMLCanvasElement, glCtx: WebGLRenderingContext) {
  const parent = canvas.parentElement
  if (!parent) return
  dpr = window.devicePixelRatio || 1
  cssWidth = parent.clientWidth || 800
  cssHeight = parent.clientHeight || 400

  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`

  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = Math.round(cssHeight * dpr)

  glCtx.viewport(0, 0, canvas.width, canvas.height)
}

function getViewParams(width: number, height: number) {
  const col0 = (props.metaData as any)?.row_groups?.[0]?.columns?.[0]?.meta_data?.statistics
  const col1 = (props.metaData as any)?.row_groups?.[0]?.columns?.[1]?.meta_data?.statistics
  const xMin = Number(col0?.min_value ?? -1), xMax = Number(col0?.max_value ?? 1)
  const yMin = Number(col1?.min_value ?? -1), yMax = Number(col1?.max_value ?? 1)
  const cx = (xMin + xMax) / 2
  const cy = (yMin + yMax) / 2

  const rangeX = Math.max(1e-9, xMax - xMin)
  const rangeY = Math.max(1e-9, yMax - yMin)
  const dataScale = 2 / Math.max(rangeX, rangeY)

  const panX = (2 * transform.x) / width
  const panY = (-2 * transform.y) / height

  const s = transform.k * dataScale
  const tx = panX - s * cx
  const ty = panY - s * cy
  return { s, tx, ty }
}

function screenToData(screenX: number, screenY: number, width: number, height: number) {
  const { s, tx, ty } = getViewParams(width, height)
  const clipX = (screenX / width) * 2 - 1
  const clipY = -((screenY / height) * 2 - 1)
  const x = (clipX - tx) / s
  const y = (clipY - ty) / s
  return { x, y }
}

function findNearestPoint(data: any[], mouseX: number, mouseY: number, width: number, height: number) {
  if (!data.length || !transform) return null
  const dp = screenToData(mouseX, mouseY, width, height)
  let minDist = Infinity
  let nearest = null as any

  for (const p of data) {
    const dx = p.x - dp.x
    const dy = p.y - dp.y
    const dist = Math.hypot(dx, dy)
    const threshold = 3 / (transform.k / 2)
    if (dist < minDist && dist < threshold) {
      minDist = dist
      nearest = p
    }
  }
  return nearest
}

function generateData() {
  const rows = props.data as any[]
  if (rows.length && rows[0] && typeof rows[0] === 'object' && 'x' in rows[0] && 'attrs' in rows[0]) {
    return rows as any[]
  }

  const out: any[] = []
  const schema = ((props.metaData as any)?.schema || []) as Array<{ name?: string }>

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const x = Number(row[0])
    const y = Number(row[1])

    const attrs: Record<string, any> = {}
    for (let c = 0; c < schema.length; c++) {
      const key = schema[c]?.name ?? `col_${c}`
      attrs[key] = row[c]
    }
    out.push({
      x, y,
      rawX: x, rawY: y,
      color: [0.5, 0.5, 0.5],
      id: i,
      attrs,
      rawRow: row
    })
  }
  return out
}

// ---------- WebGL ----------
function createShaderProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string) {
  const vs = gl.createShader(gl.VERTEX_SHADER)!
  gl.shaderSource(vs, vsSource)
  gl.compileShader(vs)
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    console.error('Vertex shader error:', gl.getShaderInfoLog(vs))
    return null
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(fs, fsSource)
  gl.compileShader(fs)
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.error('Fragment shader error:', gl.getShaderInfoLog(fs))
    return null
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog))
    return null
  }
  gl.validateProgram(prog)
  if (!gl.getProgramParameter(prog, gl.VALIDATE_STATUS)) {
    console.error('Program validate error:', gl.getProgramInfoLog(prog))
    return null
  }
  return prog
}

function prepareBuffers(gl: WebGLRenderingContext, program: WebGLProgram, data: any[]) {
  if (!data.length) return null
  const positionBuffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  const positions = new Float32Array(data.flatMap(d => [d.x, d.y]))
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

  const colorBuffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
  const colors = new Float32Array(data.flatMap(d => d.color))
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW)

  const positionAttributeLocation = gl.getAttribLocation(program, 'a_position')
  const colorAttributeLocation = gl.getAttribLocation(program, 'a_color')
  const viewMatrixLocation = gl.getUniformLocation(program, 'u_viewMatrix')
  const pointSizeLocation = gl.getUniformLocation(program, 'u_pointSize')

  return {
    program,
    positionBuffer,
    colorBuffer,
    positionAttributeLocation,
    colorAttributeLocation,
    viewMatrixLocation,
    pointSizeLocation,
    count: data.length
  }
}

function drawScatterplot(gl: WebGLRenderingContext, info: any, pointSize: number, highlight: any = null) {
  if (!gl || !info || !transform) return

  const {
    program,
    positionBuffer,
    colorBuffer,
    positionAttributeLocation,
    colorAttributeLocation,
    viewMatrixLocation,
    pointSizeLocation,
    count
  } = info

  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.useProgram(program)

  gl.enableVertexAttribArray(positionAttributeLocation)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0)

  gl.enableVertexAttribArray(colorAttributeLocation)
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
  gl.vertexAttribPointer(colorAttributeLocation, 3, gl.FLOAT, false, 0, 0)

  const width = gl.canvas.clientWidth
  const height = gl.canvas.clientHeight

  const { s, tx, ty } = getViewParams(width, height)
  const matrix = new Float32Array([
    s, 0, 0, 0,
    0, s, 0, 0,
    0, 0, 1, 0,
    tx, ty, 0, 1
  ])

  gl.uniformMatrix4fv(viewMatrixLocation, false, matrix)
  gl.uniform1f(pointSizeLocation, Math.max(1.5, pointSize * Math.sqrt(transform.k) * dpr))

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.drawArrays(gl.POINTS, 0, count)

  if (highlight) {
    const highlightBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, highlightBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([highlight.x, highlight.y]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0)

    const highlightColorBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, highlightColorBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 1, 0.5]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(colorAttributeLocation, 3, gl.FLOAT, false, 0, 0)

    gl.uniform1f(pointSizeLocation, Math.max(2.5, pointSize * Math.sqrt(transform.k) * 2.5 * dpr))
    gl.drawArrays(gl.POINTS, 0, 1)

    const outlineColorBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, outlineColorBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1.0, 0.8, 0.2]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(colorAttributeLocation, 3, gl.FLOAT, false, 0, 0)

    gl.uniform1f(pointSizeLocation, Math.max(3.0, pointSize * Math.sqrt(transform.k) * 3.0 * dpr))
    gl.drawArrays(gl.POINTS, 0, 1)

    gl.deleteBuffer(highlightBuf)
    gl.deleteBuffer(highlightColorBuf)
    gl.deleteBuffer(outlineColorBuf)
  }
}

// ---------- init / events ----------
function initVisualization() {
  if (!canvasRef.value || !containerRef.value) return

  gl = (canvasRef.value.getContext('webgl', {
    preserveDrawingBuffer: true,
    antialias: true,
    alpha: true
  }) || canvasRef.value.getContext('experimental-webgl')) as WebGLRenderingContext | null
  if (!gl) {
    console.error('WebGL not supported')
    return
  }

  sizeCanvasForDPR(canvasRef.value, gl)

  const vs = `
    attribute vec2 a_position;
    attribute vec3 a_color;
    uniform mat4 u_viewMatrix;
    uniform float u_pointSize;
    varying vec3 v_color;
    void main() {
      v_color = a_color;
      gl_PointSize = u_pointSize;
      gl_Position = u_viewMatrix * vec4(a_position, 0.0, 1.0);
    }
  `
  const fs = `
    precision mediump float;
    varying vec3 v_color;
    void main() {
      float dist = length(gl_PointCoord.xy - vec2(0.5));
      if (dist > 0.5) discard;
      float alpha = 1.0;
      if (dist > 0.4) { alpha = 1.0 - (dist - 0.4) * 2.0; }
      gl_FragColor = vec4(v_color, alpha);
    }
  `
  program = createShaderProgram(gl, vs, fs)
  if (!program) return
  gl.useProgram(program)

  data = generateData()
  programInfo = prepareBuffers(gl, program, data)

  transform = d3.zoomIdentity

  const sel = d3.select(canvasRef.value)
  zoom = d3.zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.1, 100])
    .extent([[0, 0], [cssWidth, cssHeight]])
    .translateExtent([[-1e6, -1e6], [1e6, 1e6]])
    .filter((event: any) => {
      if (event.type === 'wheel') return false
      return true
    })
    .on('zoom', (event: any) => {
      transform = event.transform
      drawScatterplot(gl!, programInfo, 2, highlightedPoint)
    })

  sel.call(zoom as any)

  canvasRef.value.addEventListener('wheel', handleWheelZoom, { passive: false })

  requestAnimationFrame(() => drawScatterplot(gl!, programInfo, 2, null))

  canvasRef.value.addEventListener('mousemove', handleMouseMove)
  canvasRef.value.addEventListener('mouseleave', handleMouseLeave)
}

function handleWheelZoom(e: WheelEvent) {
  if (!canvasRef.value) return
  e.preventDefault()

  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  const width = cssWidth
  const height = cssHeight

  const dp = screenToData(mx, my, width, height)

  const kFactor = Math.pow(2, -e.deltaY * 0.002)
  let kNew = transform.k * kFactor
  kNew = Math.max(0.1, Math.min(100, kNew))

  const col0 = (props.metaData as any)?.row_groups?.[0]?.columns?.[0]?.meta_data?.statistics
  const col1 = (props.metaData as any)?.row_groups?.[0]?.columns?.[1]?.meta_data?.statistics
  const xMin = Number(col0?.min_value ?? -1), xMax = Number(col0?.max_value ?? 1)
  const yMin = Number(col1?.min_value ?? -1), yMax = Number(col1?.max_value ?? 1)
  const cx = (xMin + xMax) / 2
  const cy = (yMin + yMax) / 2

  const rangeX = Math.max(1e-9, xMax - xMin)
  const rangeY = Math.max(1e-9, yMax - yMin)
  const dataScale = 2 / Math.max(rangeX, rangeY)

  const sNew = kNew * dataScale

  const clipX = (mx / width) * 2 - 1
  const clipY = -((my / height) * 2 - 1)

  const panTermX = clipX - sNew * (dp.x - cx)
  const xNew = 0.5 * width * panTermX

  const panTermY = clipY - sNew * (dp.y - cy)
  const yNew = -0.5 * height * panTermY

  const next = d3.zoomIdentity.translate(xNew, yNew).scale(kNew)
  transform = next
  d3.select(canvasRef.value!).call(zoom.transform as any, next)
}

function handleMouseMove(e: MouseEvent) {
  if (!canvasRef.value || !containerRef.value) return
  const rCanvas = canvasRef.value.getBoundingClientRect()
  const rCont = containerRef.value.getBoundingClientRect()

  const mouseX = e.clientX - rCanvas.left
  const mouseY = e.clientY - rCanvas.top
  const p = findNearestPoint(data, mouseX, mouseY, cssWidth, cssHeight)

  const t = tooltipRef.value!
  if (p) {
    const offsetX = 12, offsetY = 16
    t.style.left = `${e.clientX - rCont.left + offsetX}px`
    t.style.top = `${e.clientY - rCont.top + offsetY}px`
    t.style.opacity = '1'

    const colorVal = valueForColorMode(p)

    const schema = ((props.metaData as any)?.schema || []) as Array<{ name?: string }>
    const allNames = schema.map(s => s?.name || '')
    const nonXY = allNames.slice(2)

    const baseList = new Set<string>([
      ...(props.colorMode && props.colorMode !== 'random' ? [props.colorMode] : []),
      ...((props.hoverFields as string[]) || [])
    ])

    let fields: string[] = Array.from(baseList).filter(k => k && nonXY.includes(k))

    if (!fields.length) {
      fields = nonXY.filter(k => p.attrs?.[k] !== undefined && p.attrs?.[k] !== '').slice(0, 5)
    }

    const extras: string[] = []
    for (const k of fields) {
      const v = p.attrs?.[k]
      extras.push(`<div><em>${k}</em>: ${formatLabel(v)}</div>`)
    }

    t.innerHTML = `
      <strong>(${Number(p.rawX).toFixed(2)}, ${Number(p.rawY).toFixed(2)})</strong>
      ${props.colorMode && props.colorMode !== 'random'
        ? `<div><b>${props.colorMode}</b>: ${formatLabel(colorVal)}</div>`
        : ''
      }
      ${extras.join('')}
    `

    highlightedPoint = p
    drawScatterplot(gl!, programInfo, 2, highlightedPoint)
  } else {
    t.style.opacity = '0'
    if (highlightedPoint !== null) {
      highlightedPoint = null
      drawScatterplot(gl!, programInfo, 2, null)
    }
  }
}

function handleMouseLeave() {
  if (tooltipRef.value) tooltipRef.value.style.opacity = '0'
  if (highlightedPoint !== null) {
    highlightedPoint = null
    drawScatterplot(gl!, programInfo, 2, null)
  }
}

function handleResize() {
  if (!canvasRef.value || !gl) return
  sizeCanvasForDPR(canvasRef.value, gl)
  d3.select(canvasRef.value)
    .call((zoom as any).extent([[0, 0], [cssWidth, cssHeight]]))
    .call(zoom.transform as any, transform)
  drawScatterplot(gl, programInfo, 2, highlightedPoint)
}

function rebuildColorBufferForMode() {
  if (!gl || !programInfo || !(props.data as any[]).length) return

  const schema = (props.metaData as any)?.schema || []
  const schemaIdx = schema.findIndex((s: any) => s?.name === props.colorMode)
  const valueIndex = schemaIdx >= 0 ? schemaIdx : -1

  const startRGB = hexToRgb(props.startColor)
  const endRGB = hexToRgb(props.endColor)

  let colorsArr: number[] = []

  if (props.colorMap && props.colorMap.size > 0 && valueIndex >= 0) {
    const name = schema[valueIndex]?.name
    colorsArr = (props.data as any[]).flatMap(d => {
      const v = (d && d.attrs && name) ? d.attrs[name] : d[valueIndex]
      return props.colorMap.get(v) || [0.6, 0.6, 0.6]
    })
  } else if (valueIndex >= 0) {
    const vals = (props.data as any[])
      .map(d => numericValueFor(d, valueIndex, schema, props.colorMode))
      .filter(v => Number.isFinite(v)) as number[]

    const vmin = Math.min(...vals), vmax = Math.max(...vals)
    const denom = (vmax - vmin) || 1

    colorsArr = (props.data as any[]).flatMap(d => {
      const v = numericValueFor(d, valueIndex, schema, props.colorMode)
      const t = Math.max(0, Math.min(1, (v - vmin) / denom))
      return [
        lerp(startRGB[0], endRGB[0], t),
        lerp(startRGB[1], endRGB[1], t),
        lerp(startRGB[2], endRGB[2], t)
      ]
    })
  } else {
    const xs = (props.data as any[]).map(d => Number(d.rawX ?? (Array.isArray(d) ? d[0] : undefined))).filter(Number.isFinite)
    const xmin = Math.min(...xs), xmax = Math.max(...xs), denom = (xmax - xmin) || 1
    colorsArr = (props.data as any[]).flatMap(d => {
      const v = Number(d.rawX ?? (Array.isArray(d) ? d[0] : undefined))
      const t = Math.max(0, Math.min(1, (v - xmin) / denom))
      return [
        lerp(startRGB[0], endRGB[0], t),
        lerp(startRGB[1], endRGB[1], t),
        lerp(startRGB[2], endRGB[2], t)
      ]
    })
  }

  gl.deleteBuffer(programInfo.colorBuffer)
  const colorBuffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colorsArr), gl.STATIC_DRAW)
  programInfo.colorBuffer = colorBuffer
  drawScatterplot(gl, programInfo, 2, highlightedPoint)
}

function numericValueFor(d: any, valueIndex: number, schema: any[], colorMode: string) {
  const name = schema[valueIndex]?.name
  if (!d?.attrs?.[name]) { return Number(d.rawY ?? (Array.isArray(d) ? d[1] : undefined)) }
  if (name && d && d.attrs && d.attrs[name] !== undefined) { return Number(d.attrs[name]) }
  return Number(Array.isArray(d) ? d[valueIndex] : undefined)
}

// ---------- watchers / lifecycle ----------
watch(() => props.forceRegenerate, () => {
  if (!gl || !program) return
  data = generateData()
  if (programInfo) {
    gl.deleteBuffer(programInfo.positionBuffer)
    gl.deleteBuffer(programInfo.colorBuffer)
  }
  programInfo = prepareBuffers(gl, program, data)
  transform = d3.zoomIdentity
  if (canvasRef.value && zoom) d3.select(canvasRef.value).call(zoom.transform, transform)
  rebuildColorBufferForMode()
  drawScatterplot(gl, programInfo, 2, null)
})

watch(() => props.data, () => {
  if (!gl || !program) { initVisualization(); return }
  data = generateData()
  if (programInfo) {
    gl.deleteBuffer(programInfo.positionBuffer)
    gl.deleteBuffer(programInfo.colorBuffer)
  }
  programInfo = prepareBuffers(gl, program, data)
  rebuildColorBufferForMode()
  drawScatterplot(gl!, programInfo, 2, null)
})

watch(() => props.colorMode, rebuildColorBufferForMode)
watch([() => props.startColor, () => props.endColor, () => props.singleColor], rebuildColorBufferForMode)

watch(() => props.pointCount, () => {
  if (!gl || !program) return
  data = generateData()
  if (programInfo) {
    gl.deleteBuffer(programInfo.positionBuffer)
    gl.deleteBuffer(programInfo.colorBuffer)
  }
  programInfo = prepareBuffers(gl, program, data)
  rebuildColorBufferForMode()
  drawScatterplot(gl, programInfo, 2, null)
})

onMounted(() => { window.addEventListener('resize', handleResize) })
onBeforeUnmount(() => {
  if (canvasRef.value) {
    canvasRef.value.removeEventListener('mousemove', handleMouseMove)
    canvasRef.value.removeEventListener('mouseleave', handleMouseLeave)
    canvasRef.value.removeEventListener('wheel', handleWheelZoom)
  }
  window.removeEventListener('resize', handleResize)

  if (gl && programInfo) {
    gl.deleteBuffer(programInfo.positionBuffer)
    gl.deleteBuffer(programInfo.colorBuffer)
    if (program) gl.deleteProgram(program)
  }
})
</script>

<style scoped>
.scatterplot-container {
  width: 100%;
  height: 100%;
  background: #f0f0f0;
}

canvas {
  touch-action: none;
  display: block;
  cursor: crosshair;
  width: 100%;
  height: 100%;
}

#tooltip {
  position: absolute;
  background: rgba(0, 0, 0, .8);
  color: #fff;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  pointer-events: none;
  opacity: 0;
  transition: opacity .2s;
  z-index: 200;
  white-space: nowrap;
}

#debug {
  position: absolute;
  bottom: 20px;
  right: 20px;
  background: rgba(255, 255, 255, .8);
  padding: 10px;
  border-radius: 5px;
  font-family: monospace;
}
</style>

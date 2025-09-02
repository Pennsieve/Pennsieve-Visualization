<!-- ControlPanel.vue -->
<template>
  <div class="control-panel">
    <h3>Color Controls</h3>

    <div class="color-option">
      <label for="colorMode">Color Mode:</label>
      <select id="colorMode" v-model="localColorMode">
        <option value="random">all</option>
        <option
          v-for="k in colorKeys"
          :key="k"
          :value="k"
        >
          {{ k }}
        </option>
      </select>
    </div>

    <!-- Legend only for categorical maps (non-empty) -->
    <div class="color-option" v-if="selectedMapEntries.length">
      <div class="legend">
        <h4>Legend</h4>
        <div
          class="legend-item"
          v-for="([label, rgb], i) in selectedMapEntries"
          :key="`${label}-${i}`"
        >
          <div class="legend-color" :style="{ backgroundColor: rgbToCss(rgb) }" />
          <div class="legend-label">{{ label }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'

const props = defineProps({
  pointCount: { type: Number, default: 5000 },
  colorMode:  { type: String, default: 'random' },
  startColor: { type: String, default: '#ff0000' },
  endColor:   { type: String, default: '#0000ff' },
  singleColor:{ type: String, default: '#4285f4' },
  colorScheme:{ type: Map,   default: () => new Map() }, // not used directly now, but kept for API stability
  colorMapMap:{ type: Map,   default: () => new Map() }
})

const emit = defineEmits([
  'update:pointCount',
  'update:colorMode',
  'update:startColor',
  'update:endColor',
  'update:singleColor',
  'regenerate',
  'updateColorMap'
])

const localPointCount = ref(props.pointCount)
const localColorMode  = ref(props.colorMode)
const localStartColor = ref(props.startColor)
const localEndColor   = ref(props.endColor)
const localSingleColor= ref(props.singleColor)

// All selectable color keys (all columns)
const colorKeys = computed(() =>
  props.colorMapMap instanceof Map ? Array.from(props.colorMapMap.keys()) : []
)

// The selected map for the current column (categorical = entries, numeric = empty)
const selectedMap = computed(() =>
  props.colorMapMap instanceof Map ? (props.colorMapMap.get(localColorMode.value) as Map<any, number[]>) : undefined
)
const selectedMapEntries = computed(() => selectedMap.value ? Array.from(selectedMap.value.entries()) : [])

// Helpers
function rgbToCss(rgbArray?: number[]) {
  if (!rgbArray) return 'rgb(150,150,150)'
  const [r, g, b] = rgbArray
  return `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`
}

function applyColors() {
  // emit the chosen color mode
  emit('update:colorMode', localColorMode.value)
  // and the corresponding map (categorical gets entries; numeric yields empty Map → gradient in plot)
  emit('updateColorMap', [localColorMode.value, selectedMap.value ?? new Map()])
  emit('update:startColor', localStartColor.value)
  emit('update:endColor',   localEndColor.value)
  emit('update:singleColor',localSingleColor.value)
}

// Watches
watch(() => props.pointCount, (v) => (localPointCount.value = v))
watch(() => props.colorMode,  (v) => (localColorMode.value  = v))
watch(() => props.startColor, (v) => (localStartColor.value = v))
watch(() => props.endColor,   (v) => (localEndColor.value   = v))
watch(() => props.singleColor,(v) => (localSingleColor.value= v))

// when user changes the dropdown
watch(localColorMode, applyColors)

// if the map set changes (e.g., new query), ensure the current selection is valid
watch(() => props.colorMapMap, () => {
  if (!(props.colorMapMap instanceof Map)) return
  if (localColorMode.value !== 'random' && !props.colorMapMap.has(localColorMode.value)) {
    // fallback to random (or first key if you prefer)
    localColorMode.value = 'random'
  }
  applyColors()
})
</script>

<style scoped>
.control-panel { position: absolute; top: 20px; left: 20px; background: rgba(255,255,255,0.85); padding: 15px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 100; max-width: 320px; }
.color-option { margin-bottom: 15px; }
.legend-item { display: flex; align-items: center; gap: 10px; margin: 4px 0; }
.legend-color { width: 18px; height: 18px; border-radius: 3px; }
.legend-label { font-size: 14px; }
</style>

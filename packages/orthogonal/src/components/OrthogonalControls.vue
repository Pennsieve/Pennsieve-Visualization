<template>
  <div class="ortho-controls" :class="{ 'ortho-controls--collapsed': collapsed }">
    <!-- Toggle button -->
    <button
      class="ortho-controls__toggle"
      @click="collapsed = !collapsed"
      :title="collapsed ? 'Show controls' : 'Hide controls'"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          v-if="collapsed"
          d="M3 5L7 9L11 5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          v-else
          d="M11 9L7 5L3 9"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span v-if="collapsed">Controls</span>
    </button>

    <!-- Panel content -->
    <template v-if="!collapsed">
      <!-- Layout toggles -->
      <div class="ortho-controls__section">
        <div class="ortho-controls__label">Layout</div>
        <div class="ortho-controls__layout-buttons">
          <button
            v-for="mode in layoutModes"
            :key="mode.value"
            :class="['ortho-controls__btn', { 'ortho-controls__btn--active': layout === mode.value }]"
            @click="$emit('set-layout', mode.value)"
            :title="mode.label"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>

      <!-- Position display -->
      <div class="ortho-controls__section">
        <div class="ortho-controls__label">Position</div>
        <div class="ortho-controls__position">
          <span>X: {{ position[0].toFixed(1) }}</span>
          <span>Y: {{ position[1].toFixed(1) }}</span>
          <span>Z: {{ position[2].toFixed(1) }}</span>
        </div>
      </div>

      <!-- Channel list -->
      <div v-if="channels.length > 0" class="ortho-controls__section">
        <div class="ortho-controls__label">Channels</div>
        <div class="ortho-controls__channels">
          <label
            v-for="(ch, i) in channels"
            :key="i"
            class="ortho-controls__channel"
          >
            <input
              type="checkbox"
              :checked="ch.visible"
              @change="$emit('toggle-channel', i, ($event.target as HTMLInputElement).checked)"
            />
            <span
              class="ortho-controls__swatch"
              :style="{ backgroundColor: ch.color }"
            ></span>
            <span class="ortho-controls__channel-name">{{ ch.name }}</span>
          </label>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ChannelConfig, LayoutMode } from '../types'

defineProps<{
  channels: ChannelConfig[]
  position: [number, number, number]
  layout: LayoutMode
}>()

defineEmits<{
  'toggle-channel': [index: number, visible: boolean]
  'set-layout': [mode: LayoutMode]
}>()

const collapsed = ref(false)

const layoutModes = [
  { value: '4panel' as const, label: '4-Panel' },
  { value: 'xy' as const, label: 'XY' },
  { value: 'xz' as const, label: 'XZ' },
  { value: 'yz' as const, label: 'YZ' },
  { value: '3d' as const, label: '3D' },
]
</script>

<style scoped>
.ortho-controls {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  z-index: 50;
  min-width: 160px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  pointer-events: auto;
}

.ortho-controls--collapsed {
  min-width: auto;
  padding: 0;
  background: none;
  backdrop-filter: none;
}

.ortho-controls__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ortho-controls__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
}

.ortho-controls__layout-buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.ortho-controls__btn {
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: #ccc;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.ortho-controls__btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.ortho-controls__btn--active {
  background: rgba(100, 160, 255, 0.3);
  border-color: rgba(100, 160, 255, 0.5);
  color: #fff;
}

.ortho-controls__position {
  display: flex;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.ortho-controls__channels {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ortho-controls__channel {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.ortho-controls__channel input[type='checkbox'] {
  accent-color: #64a0ff;
  margin: 0;
}

.ortho-controls__swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}

.ortho-controls__channel-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ortho-controls__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #ccc;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.ortho-controls__toggle:hover {
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
}

/* When expanded, toggle inherits panel background so it doesn't need its own */
.ortho-controls:not(.ortho-controls--collapsed) .ortho-controls__toggle {
  background: none;
  backdrop-filter: none;
  border: none;
  padding: 2px 4px;
  align-self: flex-end;
}
</style>

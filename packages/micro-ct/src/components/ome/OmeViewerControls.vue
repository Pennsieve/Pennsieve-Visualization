<script setup lang="ts">
import { ref, computed } from "vue";

interface Props {
  currentZ: number;
  currentT: number;
  maxZ: number;
  maxT: number;
  fluidMode: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:currentZ": [value: number];
  "update:currentT": [value: number];
  "update:fluidMode": [value: boolean];
}>();

const showZSlider = computed(() => props.maxZ > 0);
const showTSlider = computed(() => props.maxT > 0);
const showZMenu = ref(false);

function onZChange(event: Event) {
  const value = parseInt((event.target as HTMLInputElement).value);
  emit("update:currentZ", value);
}

function onTChange(event: Event) {
  const value = parseInt((event.target as HTMLInputElement).value);
  emit("update:currentT", value);
}

function toggleZMenu() {
  showZMenu.value = !showZMenu.value;
}

function onFluidModeChange(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  emit("update:fluidMode", checked);
}

function onZInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  let value = parseInt(input.value);

  // Clamp value to valid range
  if (isNaN(value)) value = 0;
  if (value < 0) value = 0;
  if (value > props.maxZ) value = props.maxZ;

  // Update the input display with clamped value
  input.value = value.toString();

  emit("update:currentZ", value);
}

function onZInputKeydown(event: KeyboardEvent) {
  // Submit on Enter
  if (event.key === "Enter") {
    (event.target as HTMLInputElement).blur();
  }
}

function decrementZ() {
  if (props.currentZ > 0) {
    emit("update:currentZ", props.currentZ - 1);
  }
}

function incrementZ() {
  if (props.currentZ < props.maxZ) {
    emit("update:currentZ", props.currentZ + 1);
  }
}
</script>

<template>
  <div class="ome-viewer-controls">
    <!-- Z-slice slider -->
    <div v-if="showZSlider" class="slider-container z-slider-container">
      <div class="slider-header">
        <label class="slider-label">
          Z: <input
            type="number"
            class="z-input"
            :value="currentZ"
            :min="0"
            :max="maxZ"
            @change="onZInputChange"
            @keydown="onZInputKeydown"
          /> / {{ maxZ }}
        </label>
        <button class="menu-toggle" @click="toggleZMenu" :class="{ active: showZMenu }">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="slider-with-buttons">
        <input
          type="range"
          :value="currentZ"
          :min="0"
          :max="maxZ"
          class="slider"
          @input="onZChange"
        />
        <div class="slider-buttons">
          <button
            class="step-button"
            @click="decrementZ"
            :disabled="currentZ <= 0"
            title="Previous slice"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            class="step-button"
            @click="incrementZ"
            :disabled="currentZ >= maxZ"
            title="Next slice"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 2v6M2 5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <!-- Z-slider dropdown menu -->
      <div v-if="showZMenu" class="slider-menu">
        <label class="menu-checkbox">
          <input
            type="checkbox"
            :checked="fluidMode"
            @change="onFluidModeChange"
          />
          <span>Fluid Mode</span>
        </label>
      </div>
    </div>

    <!-- T-slice slider -->
    <div v-if="showTSlider" class="slider-container t-slider-container">
      <label class="slider-label">
        T: {{ currentT }} / {{ maxT }}
      </label>
      <input
        type="range"
        :value="currentT"
        :min="0"
        :max="maxT"
        class="slider"
        @input="onTChange"
      />
    </div>
  </div>
</template>

<style scoped>
.ome-viewer-controls {
  position: absolute;
  right: 16px;
  top: 16px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slider-container {
  background: rgba(22, 33, 62, 0.9);
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
}

.slider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.slider-label {
  color: #e2e8f0;
  font-size: 0.85rem;
  font-weight: 500;
  font-family: monospace;
  display: flex;
  align-items: center;
  gap: 2px;
}

.z-input {
  width: 50px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #e2e8f0;
  font-size: 0.85rem;
  font-family: monospace;
  font-weight: 500;
  padding: 2px 6px;
  text-align: center;
  -moz-appearance: textfield;
}

.z-input::-webkit-outer-spin-button,
.z-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.z-input:focus {
  outline: none;
  border-color: #60a5fa;
  background: rgba(96, 165, 250, 0.15);
}

.z-input:hover {
  border-color: rgba(255, 255, 255, 0.3);
}

.slider-with-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-buttons {
  display: flex;
  justify-content: space-between;
}

.step-button {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.step-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  color: #e2e8f0;
  border-color: rgba(255, 255, 255, 0.25);
}

.step-button:active:not(:disabled) {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.step-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.menu-toggle {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.menu-toggle:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #e2e8f0;
}

.menu-toggle.active {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.menu-toggle svg {
  transition: transform 0.15s ease;
}

.menu-toggle.active svg {
  transform: rotate(180deg);
}

.slider-menu {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.menu-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #cbd5e1;
  font-size: 0.8rem;
}

.menu-checkbox input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #60a5fa;
  cursor: pointer;
}

.menu-checkbox span {
  user-select: none;
}

.slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #60a5fa;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s ease;
}

.slider::-webkit-slider-thumb:hover {
  background: #3b82f6;
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #60a5fa;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}
</style>

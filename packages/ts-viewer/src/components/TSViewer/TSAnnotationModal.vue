<template>
  <el-dialog
    class="timeseries-annotation-modal"
    ref="annotation-modal"
    :width="readOnly ? '560px' : undefined"
    :modelValue="localVisible"
    @update:modelValue="(value: boolean) => { localVisible = value; if (!value) emit('closeWindow') }"
    @close="close"
    @closed="onClosed">

    <template #header>
      <div class="dialog-header">
        <span class="el-dialog__title">{{ dialogTitle }}</span>
        <span v-if="readOnly" class="read-only-tag">Read only</span>
      </div>
    </template>

    <dl v-if="readOnly" class="annotation-details">
      <div class="detail">
        <dt>Time</dt>
        <dd>{{ timeText }}</dd>
      </div>
      <div class="detail">
        <dt>Duration</dt>
        <dd>{{ durationText }}</dd>
      </div>
      <div class="detail">
        <dt>Layer</dt>
        <dd>{{ layerName }}</dd>
      </div>
      <div class="detail">
        <dt>Type</dt>
        <dd>{{ activeAnnotation.label || '—' }}</dd>
      </div>
      <div class="detail detail--wide">
        <dt>Description</dt>
        <dd :class="{ 'detail-placeholder': !activeAnnotation.description }">{{ descriptionText }}</dd>
      </div>
    </dl>

    <div v-else>
      <div class="select-wrapper">
        <div class="range-type-selector">
          <div class="select-label">
            Range?
          </div>
          <el-switch
            v-model="hasRangeValue"
            active-color="#5039F7"
            inactive-color="#CAC5BF">
          </el-switch>
        </div>

        <el-date-picker
          v-model="selectedRange"
          class = "date-time-picker"
          :type="datePickerType"
          format="YYYY-MM-DD HH:mm:ss"
          value-format="x"
          range-separator="To"
          start-placeholder="Start date/time"
          end-placeholder="End date/time">
        </el-date-picker>
      </div>
      <div class="select-wrapper">
        <div>
          <div class="select-label">
            Annotation Layer
          </div>
          <el-select
            v-model="activeAnnotation.layer_id"
            placeholder="Select" >
            <el-option
              v-for="item in viewerAnnotations"
              :key="item.id"
              :label="item.name"
              :value="item.id">
            </el-option>
          </el-select>
        </div>
        <div>
          <div class="select-label">
            Annotation Type
          </div>
          <el-select
            v-model="activeAnnotation.label"
            placeholder="Select" >
            <el-option
              v-for="item in defaultLabels"
              :key="item.value"
              :label="item.label"
              :value="item.value">
            </el-option>
          </el-select>
        </div>
      </div>

      <div class="description-wrapper">
        <div class="select-label">
          Description
        </div>
        <el-input
          ref="input"
          v-model="activeAnnotation.description"
          placeholder="Please provide additional information..."
          type="textarea"
          :rows="5"
        />

      </div>
    </div>

    <template #footer>
      <div class="button-wrapper">
        <div class="channels-selected">

          <IconSelection
            class="inline-icon"
            :height="16"
            :width="16"/>

          {{ channelSelectionStr }}

        </div>
        <div class="buttons">
          <bf-library-button
            @click="readOnly ? close() : submitForm()"
          > {{ actionButtonText }}
          </bf-library-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent, inject } from 'vue'
import { createViewerStore } from '../../stores/tsviewer'
import { storeToRefs } from 'pinia'
import type { Annotation } from '@/utils/annotationUtils'
import { isBundleLayerId, loadBundleDescription } from '@/composables/useBundleAnnotations'
import IconSelection from "../icons/IconSelection.vue"

// Async component imports
const BfLibraryButton = defineAsyncComponent(() => import('@/components/Shared/bf-library-button/BFLibraryButton.vue'))

// Define props
const props = withDefaults(defineProps<{
  visible?: boolean
}>(), {
  visible: false
})

const localVisible = ref(false)

watch(() => props.visible, (newValue) => {
  localVisible.value = newValue

  if (!newValue) return

  // Convert microseconds to milliseconds for JavaScript Date
  // Assuming annotation times are stored in microseconds
  const startMs = activeAnnotation.value.start! / 1000
  const endMs = activeAnnotation.value.end! / 1000

  initialTimeRange.value = {
    start: activeAnnotation.value.start!,
    end: activeAnnotation.value.end!
  }

  if (activeAnnotation.value.duration == 0) {
    hasRangeValue.value = false
    selectedRange.value = startMs
  } else {
    hasRangeValue.value = true
    selectedRange.value = [startMs, endMs]
  }

  showBundleDescription()
}, { immediate: true })

/** Set when a bundle annotation's description could not be read. */
const descriptionUnavailable = ref(false)

/**
 * Fills in a bundle annotation's description, which its window arrived without.
 *
 * Kept on the annotation itself, so opening it again reads nothing.
 */
const showBundleDescription = async () => {
  descriptionUnavailable.value = false
  const annotation = activeAnnotation.value as Annotation
  if (!isBundleLayerId(annotation.layer_id) || annotation.description !== undefined) {
    return
  }
  try {
    const description = await loadBundleDescription(viewerStore.$id, annotation)
    // The dialog may have moved on to another annotation while the body was read.
    if (activeAnnotation.value.id !== annotation.id) {
      return
    }
    activeAnnotation.value.description = description ?? ''
    const layer = viewerAnnotations.value.find((l) => l.id === annotation.layer_id)
    const stored = layer?.annotations.find((a) => a.id === annotation.id)
    if (stored) {
      stored.description = activeAnnotation.value.description
    }
  } catch (err) {
    console.warn('Could not read the annotation body from the bundle:', err)
    if (activeAnnotation.value.id === annotation.id) {
      descriptionUnavailable.value = true
    }
  }
}


// Define emits
const emit = defineEmits<{
  (e: 'closeWindow'): void
  (e: 'createUpdateAnnotation', annotation: Partial<Annotation>): void
}>()

// Store - inject from parent TSViewer component
// Falls back to default store for backwards compatibility
const viewerStore = inject('viewerStore', () => createViewerStore('default'), true)
// TODO: remove the default store reference in the inject code, this component is always used within the parent component, so default is not needed.
const {
  activeAnnotation,
  viewerChannels,
  viewerAnnotations
} = storeToRefs(viewerStore)

// Template refs
const annotationModal = ref(null)
const input = ref(null)

// Reactive data
const isProcessing = ref(false)
const selectedRange = ref<number | number[] | null>(null)
const initialTimeRange = ref({
  start: 0,
  end: 0
})
const hasRangeValue = ref(true)

const defaultLabels = ref([
  { value: 'Event', label: 'Event' },
  { value: 'Artifact', label: 'Artifact' },
  { value: 'Seizure', label: 'Seizure' },
  { value: 'Mark', label: 'Mark' },
  { value: 'Stim On', label: 'Stim On' },
  { value: 'Stim Off', label: 'Stim Off' },
  { value: 'Start', label: 'Start' },
  { value: 'Stop', label: 'Stop' }
])

/**
 * Annotations read from the data bundle cannot be saved back, so they open for viewing
 * only. Annotations from the Pennsieve API keep the editable form.
 */
const readOnly = computed(() => isBundleLayerId(activeAnnotation.value.layer_id))

// Computed properties
const dialogTitle = computed(() => {
  if (readOnly.value) {
    return "Annotation Details"
  }
  return activeAnnotation.value.id ? "Edit Annotation" : "Create Annotation"
})

const actionButtonText = computed(() => {
  if (readOnly.value) {
    return "Close"
  }
  return activeAnnotation.value.id ? "Update" : "Create"
})

/**
 * A time in microseconds as UTC, matching the plot axis. Milliseconds appear only when
 * the time has them.
 */
const formatUtc = (us: number) => {
  const iso = new Date(us / 1000).toISOString()
  const millis = iso.slice(19, 23)
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${millis === '.000' ? '' : millis}`
}

const timeText = computed(() => {
  const { start, end, duration } = activeAnnotation.value
  if (start === undefined) {
    return '—'
  }
  const startText = formatUtc(start)
  if (!duration || end === undefined) {
    return `${startText} UTC`
  }
  const endText = formatUtc(end)
  // A range within one day names the date once.
  const sameDay = startText.slice(0, 10) === endText.slice(0, 10)
  return `${startText} → ${sameDay ? endText.slice(11) : endText} UTC`
})

const durationText = computed(() => {
  const durationUs = activeAnnotation.value.duration ?? 0
  if (durationUs <= 0) {
    return 'Single point'
  }
  const ms = durationUs / 1000
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${Number(seconds.toFixed(1))} s`
  }
  const totalSeconds = Math.round(seconds)
  const parts = [
    [Math.floor(totalSeconds / 3600), 'h'],
    [Math.floor((totalSeconds % 3600) / 60), 'min'],
    [totalSeconds % 60, 's']
  ] as const
  return parts.filter(([value]) => value > 0).map(([value, unit]) => `${value} ${unit}`).join(' ')
})

const layerName = computed(() => {
  const layerId = activeAnnotation.value.layer_id
  return viewerAnnotations.value.find((layer) => layer.id === layerId)?.name ?? '—'
})

const descriptionText = computed(() => {
  const description = activeAnnotation.value.description
  if (description) {
    return description
  }
  if (description === undefined && !descriptionUnavailable.value) {
    return 'Loading…'
  }
  return descriptionUnavailable.value ? 'Description unavailable' : 'No description'
})

const datePickerType = computed(() => {
  return hasRangeValue.value ? 'datetimerange' : 'datetime'
})

const channelSelectionStr = computed(() => {
  // A read-only annotation already exists, so the footer says where it applies rather
  // than where it is being added.
  const verb = readOnly.value ? "Applies to" : "Adding to"
  const channelCount = (activeAnnotation.value?.channelIds ?? []).length
  if (activeAnnotation.value.allChannels) {
    return `${verb} all channels`
  }
  if (channelCount == 1) {
    return readOnly.value ? `${verb} 1 channel` : `${verb} single channel`
  }
  return `${verb} ${channelCount} channels`
})

// Watchers
watch(hasRangeValue, (value) => {
  // Convert microseconds to milliseconds for the date picker
  const startMs = activeAnnotation.value.start! / 1000
  const endMs = activeAnnotation.value.end! / 1000

  if (value) {
    // Range mode: set array of start and end times
    selectedRange.value = [startMs, endMs]
  } else {
    // Single point mode: set duration to 0 and use start time
    activeAnnotation.value.duration = 0
    selectedRange.value = startMs
  }
})

// Methods
const submitForm = () => {
  // Validate inputs before proceeding
  if (!activeAnnotation.value.layer_id) {
    console.error('No layer selected for annotation')
    return
  }

  if (!selectedRange.value) {
    console.error('No time range selected for annotation')
    return
  }

  // Update active annotation object
  if (hasRangeValue.value) {
    // Convert milliseconds back to microseconds
    // selectedRange is [startMs, endMs] in range mode
    if (Array.isArray(selectedRange.value) && selectedRange.value.length >= 2) {
      activeAnnotation.value.start = selectedRange.value[0] * 1000
      activeAnnotation.value.end = selectedRange.value[1] * 1000
      activeAnnotation.value.duration = activeAnnotation.value.end! - activeAnnotation.value.start!
    } else {
      console.error('Invalid range value for range mode:', selectedRange.value)
      return
    }
  } else {
    // Convert milliseconds back to microseconds
    // selectedRange is a single timestamp in single point mode
    if (typeof selectedRange.value === 'number') {
      activeAnnotation.value.start = selectedRange.value * 1000
      activeAnnotation.value.end = selectedRange.value * 1000
      activeAnnotation.value.duration = 0
    } else {
      console.error('Invalid range value for point mode:', selectedRange.value)
      return
    }
  }

  // Use Pinia store instead of Vuex dispatch
  viewerStore.setActiveAnnotation(activeAnnotation.value as Annotation)
  emit('createUpdateAnnotation', activeAnnotation.value)

  // Close the modal
  close()
}

const close = () => {
  localVisible.value = false
  emit('closeWindow')
}

const onClosed = () => {
  isProcessing.value = false
}
</script>

<style lang="scss" scoped>
@import '../../assets/tsviewerVariables.scss';

.timeseries-annotation-modal {
  display: block;
  box-sizing: border-box;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.read-only-tag {
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 10px;
  color: $white;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.annotation-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px 24px;
  margin: 0;
}

.detail {
  min-width: 0;

  &--wide {
    grid-column: 1 / -1;
  }

  dt {
    margin-bottom: 4px;
    color: $gray_4;
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  dd {
    margin: 0;
    color: $gray_6;
    font-size: 14px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .detail-placeholder {
    color: $gray_4;
    font-style: italic;
  }
}

.select-wrapper {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: 16px;
  align-items: center;

}

.description-wrapper {
}

.button-wrapper {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.channels-selected {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.date-time-picker {
  width:100%
}

.select-label {
  font-weight: 500;
  margin-bottom: 5px;
}

.inline-icon {
  margin-right: 8px;
}

.range-type-selector {
  margin-right: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;

}

.mb-16 {
  color: $red_1
}

.layerSelect {

}
</style>
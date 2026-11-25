<template>
  <div class="timeseries-viewer-toolbar">
    <div id="left-controls">

      <el-input-number
        v-model="durationInSeconds"
        :precision="durationPrecision"
        :step="durationStep"
        :min="0.01"
        :max="maxDurationInSeconds"
        controls-position="right">

        <template #suffix>
          seconds
        </template>

      </el-input-number>


        <el-input-number
          v-model="zoomMult"
          :precision="2"
          :step="0.5"
          :min="0.01"
          controls-position="right">

          <template #suffix>
            uV/mm
          </template>
        </el-input-number>

    </div>

    <div id="center-controls">
      <el-tooltip
        placement="top-end"
        content="Page Back">
        <button
          class="btn-icon"
          @click="pageBack()">
          <IconPreviousPage
            :height="12"
            :width="12"/>
        </button>
      </el-tooltip>
      <el-tooltip
        placement="top-end"
        content="Previous Annotation">
        <button
          class="btn-icon"
          @click="previousAnnotation()">
          <IconNextAnnotationLeftFacing
            :height="18"
            :width="24"/>
        </button>
      </el-tooltip>
      <el-tooltip
        placement="top-end"
        content="Automatic Forward">
        <button
          class="btn-icon btn-play"
          :class="{ 'is-paused': !isPlaying }"
          name="playback-toggle"
          @click="togglePlayback()">
          <component :is="iconPlay" :height="14"
                     :width="12"/>
        </button>
      </el-tooltip>
      <el-tooltip
        placement="top-end"
        content="Next Annotation">
        <button
          class="btn-icon"
          @click="nextAnnotation()">
          <IconNextAnnotationRightFacing
            name="next-annotation-right-facing"
            :height="18"
            :width="21"/>
        </button>
      </el-tooltip>
      <el-tooltip
        placement="top-end"
        content="Next Page">
        <button
          class="btn-icon"
          @click="pageForward()">
          <IconNextPage
            name="icon-next-page"
            :height="12"
            :width="12"/>
        </button>
      </el-tooltip>
    </div>
    <div id="right-controls">
      <IconStopwatch
        class="playback-speed-icon"
        :height="20"
        :width="22"/>

      <el-select
        v-model="selectedPlaySpeed"
        class="playSelect">
        <el-option
          v-for="item in playSpeedOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value">
        </el-option>
      </el-select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import IconPreviousPage from "../icons/IconPreviousPage.vue"
import IconNextAnnotationLeftFacing from "../icons/IconNextAnnotationLeftFacing.vue"
import IconNextAnnotationRightFacing from "@/components/icons/IconNextAnnotationRightFacing.vue"
import IconNextPage from "../icons/IconNextPage.vue"
import IconStopwatch from "../icons/IconStopwatch.vue"
import IconControllerPlay from "@/components/icons/IconControllerPlay.vue"
import IconControllerPause from "@/components/icons/IconControllerPause.vue"
import { durationStepFor, durationPrecisionFor } from '@/utils/durationStep'
import { playbackPeriodFor, playbackStepFor } from '@/utils/playbackStep'

// Props
const props = defineProps<{
  maxDuration: number
  duration: number
  start: number
  globalZoomMult: number
  tsEnd: number | null
}>()

const zoomMult = computed({
  get() {
    return  (96 * window.devicePixelRatio) / (props.globalZoomMult * 25.4)
  },
  set(newValue: number) {
    emit('update:globalZoomMult', (96 * window.devicePixelRatio) / (newValue * 25.4))
  },
});

// Emits
const emit = defineEmits<{
  (e: 'pageBack'): void
  (e: 'pageForward'): void
  (e: 'incrementZoom'): void
  (e: 'decrementZoom'): void
  (e: 'updateDuration', duration: number): void
  (e: 'nextAnnotation'): void
  (e: 'previousAnnotation'): void
  (e: 'setStart', start: number): void
  (e: 'update:globalZoomMult', value: number): void
}>()


// Reactive data
const isPlaying = ref(false)
const selectedPlaySpeed = ref(1)
const intervalTimer = ref<ReturnType<typeof setTimeout> | null>(null)

const playSpeedOptions = [
  {
    value: 0.5,
    label: '0.5x'
  }, {
    value: 1,
    label: '1x'
  }, {
    value: 2,
    label: '2x'
  }, {
    value: 5,
    label: '5x'
  }, {
    value: 10,
    label: '10x'
  }
]

// Computed properties
const iconPlay = computed(() => {
  if (isPlaying.value === true) {
    return IconControllerPause
  } else {
    return IconControllerPlay
  }
})

// A typed length is passed through as entered. Only the spinner arrows move on the decade
// ladder, by way of the step below.
const durationInSeconds = computed({
  get() {
    return props.duration / 1e6
  },
  set(newValue: number | undefined) {
    // Clearing the field reports an empty value. Hold the current window rather than
    // sending NaN to the renderer.
    if (!Number.isFinite(newValue)) {
      return
    }
    emit('updateDuration', Math.max(0.01, newValue!))
  }
})

// The prop arrives in microseconds, like `duration`. The input works in seconds.
const maxDurationInSeconds = computed(() => props.maxDuration / 1e6)

const durationStep = computed(() => durationStepFor(durationInSeconds.value))

const durationPrecision = computed(() => durationPrecisionFor(durationInSeconds.value))


const togglePlayback = () => {
  if (isPlaying.value === false) {
    startPlay()
  } else {
    stopPlay()
  }
}

const pageBack = () => {
  emit('pageBack')
}

const pageForward = () => {
  emit('pageForward')
}

const nextAnnotation = () => {
  emit('nextAnnotation')
}

const previousAnnotation = () => {
  emit('previousAnnotation')
}

/** Last start the viewport can hold without running past the end of the recording. */
const lastStart = computed(() => {
  if (props.tsEnd === null || !Number.isFinite(props.tsEnd)) {
    return null
  }
  return Math.max(0, props.tsEnd - props.duration)
})

const startPlay = () => {
  isPlaying.value = true
  const tick = () => {
    const next = props.start + playbackStepFor(props.duration)
    const limit = lastStart.value
    if (limit !== null && next >= limit) {
      emit('setStart', limit)
      stopPlay()
      return
    }
    emit('setStart', next)
    // Read per tick, so a zoom or a speed change during playback takes effect on the
    // next one rather than when playback restarts.
    intervalTimer.value = setTimeout(tick, playbackPeriodFor(selectedPlaySpeed.value))
  }
  intervalTimer.value = setTimeout(tick, playbackPeriodFor(selectedPlaySpeed.value))
}

const stopPlay = () => {
  isPlaying.value = false
  if (intervalTimer.value !== null) {
    clearTimeout(intervalTimer.value)
    intervalTimer.value = null
  }
}

// A timer outliving the toolbar keeps moving the viewport of a viewer that is gone.
onBeforeUnmount(() => {
  stopPlay()
})
</script>

<style lang="scss" scoped>
@import '../../assets/tsviewerVariables.scss';

.el-input-number {
  width: 200px;
}

// Equal side columns keep the transport buttons centred whatever the side widths are.
.timeseries-viewer-toolbar {
  border-top: 1px solid #DADADA;
  background: #F7F7F7;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 8px;
  width: 100%;
  box-sizing: border-box;
}

#left-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-self: start;
}

#center-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: $gray_2;
  color: $gray_5;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
  &.selected, &:hover {
    background: $purple_tint;
    color: $app-primary-color;
  }
  &:focus-visible {
    outline: 2px solid $purple_1;
    outline-offset: 2px;
  }
  &[disabled] {
    background: $gray_1;
    color: $gray_3;
    cursor: not-allowed;
  }
}

// Play is the main action, so it is filled.
.btn-play {
  background: $app-primary-color;
  color: $white;
  &:hover {
    background: $purple_2;
    color: $white;
  }
  // A triangle centred by its box looks left-heavy; nudge it to the optical centre.
  &.is-paused svg {
    margin-left: 2px;
  }
}

.playback-speed-icon {
  color: $gray_4;
}

.playSelect {
  width: 80px;
}

#right-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-self: end;
  height: 42px;
}
</style>

<style lang="scss">
// Match the 40px height the host app gives the number inputs.
.playSelect .el-select__wrapper {
  min-height: 40px;
}

.timeseries-viewer-toolbar .el-input-number.is-controls-right {
  // Host apps can make the input taller than Element Plus assumes, so split the
  // height instead of a fixed size that leaves a gap between the arrows.
  .el-input-number__decrease, .el-input-number__increase {
    height: calc(50% - 1px);
    line-height: normal;
  }
  .el-input__wrapper {
    padding-left: 12px;
  }
  // Centred text clips long values like "1636.52" against the suffix.
  .el-input__inner {
    text-align: left;
  }
}
</style>
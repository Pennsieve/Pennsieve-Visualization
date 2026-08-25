<template>
  <div
    id="channelLabels"
    ref="channelLabels"
    :style="columnStyle"
  >
    <div
      v-for="(item, index) in channels"
      :key="item.displayName"
      class="chLabelWrap"
      :style="rowStyle"
      :data-id="item.id"
      @tap="onTap"
    >
      <template v-if="labelShown(index)">
        <div :class="[item.selected? 'labelDiv selected': 'labelDiv' ]" >
          {{ item.displayName }}
        </div>
        <div
          v-if="!hideLabelInfo"
          class="chLabelIndWrap"
          :class="[ item.selected? 'selected': '']"
        >
          <div class="chLabelInd">
            {{ _computeLabelInfo(item, globalZoomMult, item.rowScale) }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ViewerChannel } from '../../stores/tsviewer'

/** Keys of the viewer constants object the label column reads. */
interface ChannelLabelsConstants {
  DEFAULTDPI: number
}

interface Props {
  /** Channels to label, in row order. */
  channels: (ViewerChannel & { displayName: string })[]
  /** Vertical scale multiplier applied to every row. */
  globalZoomMult: number
  /** Height of the plot area in CSS pixels. */
  cHeight: number
  constants: ChannelLabelsConstants
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'labelTap', event: Event): void
}>()

// Template refs
const channelLabels = ref<HTMLDivElement | null>(null)

/**
 * Shortest row, in CSS pixels, that holds a channel name without touching its
 * neighbors. A denser column labels one row in every `labelStride`.
 */
const MIN_LABEL_ROW_HEIGHT = 14

/**
 * Height of one channel row, in CSS pixels. Matches the spacing the plot canvas
 * gives a row, so a name sits on its own trace. Not finite until the plot area
 * has been measured.
 */
const rowHeight = computed(() => props.cHeight / props.channels.length)

const rowsAreMeasured = computed(() => Number.isFinite(rowHeight.value) && rowHeight.value > 0)

/**
 * Pins the column to the plot height. Without it the column is as tall as its own
 * rows, which passes the bottom of the plot once the channel count is high.
 */
const columnStyle = computed(() => {
  if (!rowsAreMeasured.value) {
    return {}
  }
  return { height: `${props.cHeight}px` }
})

const rowStyle = computed(() => {
  if (!rowsAreMeasured.value) {
    return {}
  }
  return { height: `${rowHeight.value}px` }
})

/** Distance between labeled rows, in rows. */
const labelStride = computed(() => {
  if (!rowsAreMeasured.value) {
    return 1
  }
  return Math.max(1, Math.ceil(MIN_LABEL_ROW_HEIGHT / rowHeight.value))
})

/** Whether the row at this index carries a name. */
const labelShown = (index: number) => index % labelStride.value === 0

const hideLabelInfo = computed(() => {
  let hide = false
  if (rowHeight.value < 30) {
    hide = true
  }
  return hide
})

/** Sensitivity of one row, in channel units per millimeter of screen. */
const _computeLabelInfo = (item: ViewerChannel, globalZoomMult: number, rowscale: number | undefined) => {
  const n = (((props.constants.DEFAULTDPI * window.devicePixelRatio) / (globalZoomMult * rowscale!)) / 25.4).toFixed(1)
  return n + ' ' + item.unit + '/mm'
}

// `tap` is a Polymer gesture event. Vue 3 does not dispatch it, so this handler
// does not run and the label column has no working click target.
const onTap = (event: Event) => {
  emit('labelTap', event)
}

// The parent sizes the plot canvas from the rendered width of this column, so it
// needs the root element rather than a width this component measures on its own.
defineExpose({
  el: channelLabels
})
</script>

<style lang="scss" scoped>
@import '../../assets/tsviewerVariables.scss';

#channelLabels {
  display: flex;
  flex-direction: column;
  line-height: normal;
  min-width: 75px;
}

.chLabelWrap {
  display: flex;
  flex: none;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
}

.chLabelIndWrap {
  position: relative;
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  width: 100%;
  color: #3c54a4;
}

.chLabelInd {
  font-size: 0.6em;
  min-width: 70px;
  color: rgb(150,150,150);
  text-align: right;
  white-space: nowrap;
}

.labelDiv {
  align-self: flex-end;
  white-space: nowrap;
  color: var(--neuron);

  &.selected {
    color: $orange_1 !important; /* Red color for selected channel labels */
    font-weight: 600; /* Make selected labels slightly bolder */
  }
}

.chLabelIndWrap[selected]{
  color:$purple_2;
}

.labelDiv {
  align-self: flex-end;
  white-space: nowrap;
  color: var(--neuron);
}
</style>

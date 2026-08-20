<template>
  <div
    id="channelLabels"
    ref="channelLabels"
  >
    <div
      v-for="item in channels"
      :key="item.displayName"
      class="chLabelWrap"
      :data-id="item.id"
      @tap="onTap"
    >
      <div :class="[item.selected? 'labelDiv selected': 'labelDiv' ]" >
        {{ item.displayName }}
      </div>
      <div
        class="chLabelIndWrap"
        :hidden="hideLabelInfo"
        :class="[ item.selected? 'selected': '']"
      >
        <div
          class="chLabelInd"
          :hidden="hideLabelInfo"
        >
          {{ _computeLabelInfo(item, globalZoomMult, item.rowScale) }}
        </div>
      </div>
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

const hideLabelInfo = computed(() => {
  let hide = false
  if (props.cHeight / props.channels.length < 30) {
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
  justify-content: space-around;
  line-height: normal;
  margin-bottom: 32px;
  min-width: 75px;
}

.chLabelWrap {
  display: flex;
  flex-direction: column;
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

import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { pathOr, propOr } from 'ramda'
import EventBus from '../utils/event-bus'

export function useGlobalMessageHandler() {
  const onToast = (evt) => {
    const detailMsg = pathOr('', ['detail', 'msg'], evt)
    const message = propOr(detailMsg, 'msg', evt)
    const type = pathOr('info', ['detail', 'type'], evt).toLowerCase()
    const showClose = pathOr(false, ['detail', 'showClose'], evt)
    const duration = pathOr(3000, ['detail', 'duration'], evt)

    if (!message) {
      return
    }

    ElMessage({
      message,
      type,
      center: true,
      duration,
      showClose,
      dangerouslyUseHTMLString: true
    })
  }

  onMounted(() => {
    EventBus.$on('toast', onToast)
    EventBus.$on('ajaxError', onToast)
  })

  onBeforeUnmount(() => {
    EventBus.$off('toast', onToast)
    EventBus.$off('ajaxError', onToast)
  })
}

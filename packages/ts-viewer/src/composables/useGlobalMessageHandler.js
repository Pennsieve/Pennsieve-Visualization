import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import EventBus from '../utils/event-bus'

export function useGlobalMessageHandler() {
  const onToast = (evt) => {
    const detailMsg = evt?.detail?.msg ?? ''
    const message = evt?.msg ?? detailMsg
    const type = (evt?.detail?.type ?? 'info').toLowerCase()
    const showClose = evt?.detail?.showClose ?? false
    const duration = evt?.detail?.duration ?? 3000

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

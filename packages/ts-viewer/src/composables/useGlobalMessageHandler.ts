import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import type { MessageOptions, messageType } from 'element-plus'
import EventBus from '../utils/event-bus'

interface ToastEvent {
  msg?: string
  detail?: {
    msg?: string
    type?: string
    showClose?: boolean
    duration?: number
  }
}

export function useGlobalMessageHandler() {
  const onToast = (evt?: ToastEvent) => {
    const detailMsg = evt?.detail?.msg ?? ''
    const message = evt?.msg ?? detailMsg
    const type = (evt?.detail?.type ?? 'info').toLowerCase() as messageType
    const showClose = evt?.detail?.showClose ?? false
    const duration = evt?.detail?.duration ?? 3000

    if (!message) {
      return
    }

    // The center option is not in this element-plus version's MessageOptions; the runtime ignores it.
    ElMessage({
      message,
      type,
      center: true,
      duration,
      showClose,
      dangerouslyUseHTMLString: true
    } as MessageOptions)
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

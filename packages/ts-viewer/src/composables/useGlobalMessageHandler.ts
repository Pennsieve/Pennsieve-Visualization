import { onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import type { MessageOptions, messageType } from 'element-plus'
import { unscopedViewerEmitter } from '@/events/emitter'
import type { ViewerEmitter, ViewerMessage } from '@/events/emitter'

/**
 * Renders the messages of one viewer.
 *
 * The emitter is passed in rather than injected: the viewer that provides it is
 * the viewer that listens, and Vue resolves `inject` against the parent.
 */
export function useGlobalMessageHandler(emitter: ViewerEmitter) {
  const onToast = (evt?: ViewerMessage) => {
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

  // Two sources: this viewer's own messages, and the messages of callers that
  // no viewer could be resolved for. The two are the same object when no
  // TSViewer provided an emitter, and one subscription covers that case.
  const sources = emitter === unscopedViewerEmitter ? [emitter] : [emitter, unscopedViewerEmitter]
  let unsubscribes: Array<() => void> = []

  onMounted(() => {
    unsubscribes = sources.flatMap((source) => [
      source.on('toast', onToast),
      source.on('ajaxError', onToast)
    ])
  })

  onBeforeUnmount(() => {
    unsubscribes.forEach((unsubscribe) => unsubscribe())
    unsubscribes = []
  })
}

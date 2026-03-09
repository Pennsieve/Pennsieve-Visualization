import { computed, type CSSProperties } from 'vue'

/**
 * CSS custom-property overrides for Pennsieve viewer components.
 *
 * Every key is a CSS variable name (with the `--ps-` prefix), and the value is
 * any valid CSS value. For example:
 *
 * ```ts
 * const overrides: ViewerStyleOverrides = {
 *   '--ps-color-primary': '#ff6600',
 *   '--ps-font-family': '"Inter", sans-serif',
 *   '--ps-radius': '8px',
 * }
 * ```
 */
export type ViewerStyleOverrides = Record<string, string>

/**
 * Composable that merges caller-supplied CSS-variable overrides into a
 * reactive style object that should be bound to the root `.ps-viewer` element.
 *
 * @example
 * ```vue
 * <template>
 *   <div class="ps-viewer" :style="rootStyle"> ... </div>
 * </template>
 *
 * <script setup>
 * const props = defineProps<{ customStyle?: ViewerStyleOverrides }>()
 * const { rootStyle } = useViewerStyle(() => props.customStyle)
 * </script>
 * ```
 */
export function useViewerStyle(
  overrides: () => ViewerStyleOverrides | undefined,
) {
  const rootStyle = computed<CSSProperties>(() => {
    const o = overrides()
    if (!o || Object.keys(o).length === 0) return {}
    // CSSProperties accepts custom properties via [key: string]: string
    return { ...o } as CSSProperties
  })

  return { rootStyle }
}

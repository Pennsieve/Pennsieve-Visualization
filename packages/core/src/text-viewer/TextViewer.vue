<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useViewerStyle, type ViewerStyleOverrides } from "../composables/useViewerStyle";

const props = defineProps<{
  src?: string | null
  content?: string | null
  fileType?: string
  maxHeight?: string
  showLineNumbers?: boolean
  wrapText?: boolean
  customStyle?: ViewerStyleOverrides
}>();

const { rootStyle } = useViewerStyle(() => props.customStyle);

const text = ref("");
const loading = ref(false);
const error = ref<string | null>(null);

const localFileType = computed(() => props.fileType ?? "text");
const localMaxHeight = computed(() => props.maxHeight ?? "600px");
const localShowLineNumbers = computed(() => props.showLineNumbers ?? true);
const localWrapText = computed(() => props.wrapText ?? false);

const formattedContent = computed(() => {
  if (localFileType.value === "json") {
    try {
      const parsed = JSON.parse(text.value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text.value;
    }
  }
  return text.value;
});

const lines = computed(() => {
  return formattedContent.value.split("\n");
});

const languageClass = computed(() => {
  const languageMap: Record<string, string> = {
    json: "language-json",
    csv: "language-csv",
    xml: "language-xml",
    yaml: "language-yaml",
    yml: "language-yaml",
    log: "language-log",
    text: "language-text",
  };
  return languageMap[localFileType.value] || "language-text";
});

const fileStats = computed(() => {
  return {
    type: localFileType.value.toUpperCase(),
    lines: lines.value.length,
    characters: formattedContent.value.length,
  };
});

async function fetchContent() {
  if (!props.src) return;
  loading.value = true;
  error.value = null;
  try {
    const response = await fetch(props.src);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    text.value = await response.text();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function copyToClipboard() {
  navigator.clipboard.writeText(formattedContent.value);
}

watch(
  () => props.src,
  (newSrc) => {
    if (newSrc && !props.content) {
      fetchContent();
    }
  },
  { immediate: true }
);

watch(
  () => props.content,
  (newContent) => {
    if (newContent) {
      text.value = newContent;
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="ps-viewer text-viewer" :style="rootStyle">
    <div v-if="loading" class="text-viewer__loading">Loading content...</div>

    <div v-else-if="error" class="text-viewer__error">
      <strong>Error loading file:</strong> {{ error }}
    </div>

    <div v-else-if="!text" class="text-viewer__empty">No content available</div>

    <template v-else>
      <div
        class="text-viewer__content"
        :style="{
          maxHeight: localMaxHeight,
          whiteSpace: localWrapText ? 'pre-wrap' : 'pre',
        }"
      >
        <div class="text-viewer__code-wrapper">
          <div v-if="localShowLineNumbers" class="text-viewer__line-numbers">
            <div
              v-for="(_, index) in lines"
              :key="index"
              class="text-viewer__line-number"
            >
              {{ index + 1 }}
            </div>
          </div>
          <pre
            class="text-viewer__code-block"
            :class="languageClass"
          ><code>{{ formattedContent }}</code></pre>
        </div>
      </div>

      <div class="text-viewer__footer">
        <span class="text-viewer__file-info">
          {{ fileStats.type }} | {{ fileStats.lines }} lines |
          {{ fileStats.characters }} characters
        </span>
        <button @click="copyToClipboard" class="text-viewer__copy-button">
          Copy to Clipboard
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/viewer-theme" as vt;

.text-viewer {
  @include vt.viewer-base;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ps-color-border);
  border-radius: var(--ps-radius-lg);
  background-color: var(--ps-color-bg);
  overflow: hidden;
}

.text-viewer__content {
  overflow: auto;
  background-color: var(--ps-color-bg-secondary);
  padding: var(--ps-space-lg) 0;
}

.text-viewer__code-wrapper {
  display: flex;
  min-width: fit-content;
}

.text-viewer__line-numbers {
  user-select: none;
  text-align: right;
  padding-right: var(--ps-space-lg);
  padding-left: var(--ps-space-lg);
  color: var(--ps-color-text-secondary);
  font-size: var(--ps-font-size-sm);
  line-height: 20px;
  font-family: var(--ps-font-family-mono);
  border-right: 1px solid var(--ps-color-border);
}

.text-viewer__line-number {
  min-height: 20px;
}

.text-viewer__code-block {
  margin: 0;
  padding: 0 var(--ps-space-lg);
  font-size: var(--ps-font-size-sm);
  line-height: 20px;
  font-family: var(--ps-font-family-mono);
  color: var(--ps-color-text-dark);
  background-color: transparent;
  overflow: visible;
}

.text-viewer__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ps-space-sm) var(--ps-space-lg);
  background-color: var(--ps-color-bg);
  border-top: 1px solid var(--ps-color-border);
  font-size: var(--ps-font-size-sm);
}

.text-viewer__file-info {
  color: var(--ps-color-text-secondary);
}

.text-viewer__copy-button {
  @include vt.ps-btn-secondary;
  padding: var(--ps-space-xs) var(--ps-space-md);
  font-size: var(--ps-font-size-sm);
}

.text-viewer__loading,
.text-viewer__error,
.text-viewer__empty {
  padding: var(--ps-space-2xl);
  text-align: center;
}

.text-viewer__loading,
.text-viewer__empty {
  color: var(--ps-color-text-secondary);
}

.text-viewer__error {
  color: var(--ps-color-error-dark);
  background-color: var(--ps-color-error-tint);
}
</style>

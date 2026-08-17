<script setup>
import { ref, computed, watch, onMounted } from "vue";

/**
 * TextViewer - Display text-based files with syntax highlighting
 * Supports: .txt, .csv, .json, .xml, .log, .yml, .yaml, etc.
 */
const props = defineProps({
  src: {
    type: String,
    default: null,
  },
  content: {
    type: String,
    default: null,
  },
  fileType: {
    type: String,
    default: "text",
    validator: (value) =>
      ["text", "json", "csv", "xml", "yaml", "yml", "log"].includes(value),
  },
  maxHeight: {
    type: String,
    default: "600px",
  },
  showLineNumbers: {
    type: Boolean,
    default: true,
  },
  wrapText: {
    type: Boolean,
    default: false,
  },
});

const text = ref("");
const loading = ref(false);
const error = ref(null);

const formattedContent = computed(() => {
  if (props.fileType === "json") {
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
  const languageMap = {
    json: "language-json",
    csv: "language-csv",
    xml: "language-xml",
    yaml: "language-yaml",
    yml: "language-yaml",
    log: "language-log",
    text: "language-text",
  };
  return languageMap[props.fileType] || "language-text";
});

const fileStats = computed(() => {
  return {
    type: props.fileType.toUpperCase(),
    lines: lines.value.length,
    characters: formattedContent.value.length,
  };
});

async function fetchContent() {
  loading.value = true;
  error.value = null;
  try {
    const response = await fetch(props.src);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    text.value = await response.text();
  } catch (err) {
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
  <div class="text-viewer">
    <div v-if="loading" class="text-viewer__loading">Loading content...</div>

    <div v-else-if="error" class="text-viewer__error">
      <strong>Error loading file:</strong> {{ error }}
    </div>

    <div v-else-if="!text" class="text-viewer__empty">No content available</div>

    <template v-else>
      <div
        class="text-viewer__content"
        :style="{
          maxHeight: maxHeight,
          whiteSpace: wrapText ? 'pre-wrap' : 'pre',
        }"
      >
        <div class="text-viewer__code-wrapper">
          <div v-if="showLineNumbers" class="text-viewer__line-numbers">
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
          {{ fileStats.type }} • {{ fileStats.lines }} lines •
          {{ fileStats.characters }} characters
        </span>
        <button @click="copyToClipboard" class="text-viewer__copy-button">
          Copy to Clipboard
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.text-viewer {
  display: flex;
  flex-direction: column;
  border: 1px solid #e1e4e8;
  border-radius: 6px;
  background-color: #ffffff;
  font-family: system-ui, -apple-system, sans-serif;
  overflow: hidden;
}

.text-viewer__content {
  overflow: auto;
  background-color: #f6f8fa;
  padding: 16px 0;
}

.text-viewer__code-wrapper {
  display: flex;
  min-width: fit-content;
}

.text-viewer__line-numbers {
  user-select: none;
  text-align: right;
  padding-right: 16px;
  padding-left: 16px;
  color: #6e7781;
  font-size: 12px;
  line-height: 20px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  border-right: 1px solid #d0d7de;
}

.text-viewer__line-number {
  min-height: 20px;
}

.text-viewer__code-block {
  margin: 0;
  padding: 0 16px;
  font-size: 12px;
  line-height: 20px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  color: #24292f;
  background-color: transparent;
  overflow: visible;
}

.text-viewer__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background-color: #ffffff;
  border-top: 1px solid #e1e4e8;
  font-size: 12px;
}

.text-viewer__file-info {
  color: #6e7781;
}

.text-viewer__copy-button {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #24292f;
  background-color: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.text-viewer__copy-button:hover {
  background-color: #eaeef2;
}

.text-viewer__copy-button:active {
  background-color: #dde2e8;
}

.text-viewer__loading,
.text-viewer__error,
.text-viewer__empty {
  padding: 48px;
  text-align: center;
}

.text-viewer__loading,
.text-viewer__empty {
  color: #6e7781;
}

.text-viewer__error {
  color: #cf222e;
  background-color: #ffebe9;
}
</style>

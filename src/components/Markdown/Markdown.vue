<template>
  <div class="markdown-widget-wrap" v-bind="$attrs">
    <div class="markdown-header">
      <div class="markdown-title">Markdown Viewer</div>
      <EditIcon
        class="edit-icon"
        @click="toggleMode"
        :width="20"
        :height="20"
      />
    </div>
    <!-- Edit mode -->
    <textarea
      v-if="isEditMode"
      v-model="localText"
      @input="emitInput"
      class="markdown-input"
      placeholder="Write markdown here…"
    />

    <!-- Preview mode -->
    <div v-else class="markdown-output">
      <div v-if="!localText" class="markdown-placeholder">
        <div class="placeholder-title">Markdown Editor</div>
        <div class="placeholder-text">
          Click the pencil icon above to start editing
        </div>
      </div>
      <div v-else v-html="renderedHtml" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, shallowRef } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import EditIcon from "../icons/EditIcon.vue";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** Markdown input */
  markdownText?: string;
  /** Force mode from parent if desired */
  mode?: "edit" | "preview";
  /** If false, skips sanitization*/
  sanitize?: boolean;
  /** MD OR HTML to pass through props */
  inputFormat?: "markdown" | "html";
}>();

const emit = defineEmits<{
  (e: "update:markdownText", value: string): void;
  (e: "changeMode", value: "edit" | "preview"): void;
}>();

// Marked config (tweak to taste)
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Local editable copy + prop sync
const localText = ref(props.markdownText ?? "");
watch(
  () => props.markdownText,
  (v) => {
    if (v !== undefined && v !== localText.value) localText.value = v;
  }
);

// Edit/preview mode (controlled or uncontrolled)
const isEditMode = ref(props.mode ? props.mode === "edit" : false);
watch(
  () => props.mode,
  (m) => {
    if (m) isEditMode.value = m === "edit";
  }
);

const renderedHtml = computed(() => {
  const raw =
    props.inputFormat === "html"
      ? localText.value ?? ""
      : marked.parse(localText.value ?? "");

  return props.sanitize === false ? raw : DOMPurify.sanitize(raw);
});

function emitInput() {
  emit("update:markdownText", localText.value);
}

function toggleMode() {
  isEditMode.value = !isEditMode.value;
  emit("changeMode", isEditMode.value ? "edit" : "preview");
}
</script>

<style scoped>
.markdown-widget-wrap {
  max-width: none;
  width: 100%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border: 1px solid #e0e0e0;
  border-radius: 0.5rem;
  background-color: #ffffff;
  overflow: hidden;
}

.markdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background-color: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.markdown-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #333;
}

.edit-icon {
  cursor: pointer;
  flex-shrink: 0;
}

.markdown-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  border: 2px dashed #d0d0d0;
  border-radius: 0.5rem;
  background-color: #fafafa;
  min-height: 150px;
  margin: 1rem;
}

.placeholder-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #333;
  margin-bottom: 0.5rem;
}

.placeholder-text {
  color: #666;
  font-size: 0.9rem;
}

.markdown-input,
.markdown-output {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

.markdown-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.95rem;
  line-height: 1.5;
  padding: 1rem;
  border: none;
  resize: none;
  outline: none;
}

.markdown-output {
  overflow: auto;
  padding: 1rem;
}

.markdown-output :deep(pre),
.markdown-output :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
}
.markdown-output :deep(h1) {
  font-size: 1.75rem;
  margin: 1rem 0 0.5rem;
}
.markdown-output :deep(h2) {
  font-size: 1.5rem;
  margin: 1rem 0 0.5rem;
}
.markdown-output :deep(p) {
  margin: 0.5rem 0;
}
</style>

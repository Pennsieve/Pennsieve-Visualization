<template>
  <div class="markdown-widget-wrap" v-bind="$attrs">
    <div class="markdown-header">
      <EditIcon
        v-if="!disabled"
        class="edit-icon"
        @click="toggleMode"
        :width="20"
        :height="20"
      />
    </div>
    <!-- Edit mode -->
    <textarea
      v-if="isEditMode && !disabled"
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
          {{
            disabled
              ? "No content available"
              : "Click the pencil icon above to start editing"
          }}
        </div>
      </div>
      <div v-else v-html="renderedHtml" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
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
  /** If true, disables editing and hides edit button */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:markdownText", value: string): void;
  (e: "changeMode", value: "edit" | "preview"): void;
}>();

// Marked config
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
const isEditMode = ref(
  props.disabled ? false : props.mode ? props.mode === "edit" : false
);
watch(
  () => props.mode,
  (m) => {
    if (m && !props.disabled) isEditMode.value = m === "edit";
  }
);

// Watch disabled prop to force preview mode
watch(
  () => props.disabled,
  (isDisabled) => {
    if (isDisabled) isEditMode.value = false;
  }
);

const renderedHtml = computed(() => {
  const raw =
    props.inputFormat === "html"
      ? localText.value ?? ""
      : marked.parse(localText.value ?? "");

  return props.sanitize === false ? raw : DOMPurify.sanitize(raw as string);
});

function emitInput() {
  emit("update:markdownText", localText.value);
}

function toggleMode() {
  if (props.disabled) return;
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

/* Typography and spacing */
.markdown-output :deep(*) {
  line-height: 1.6;
}

/* Headings */
.markdown-output :deep(h1) {
  font-size: 2rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
  line-height: 1.25;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.5rem;
}

.markdown-output :deep(h1:first-child) {
  margin-top: 0;
}

.markdown-output :deep(h2) {
  font-size: 1.5rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  line-height: 1.25;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.5rem;
}

.markdown-output :deep(h3) {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  line-height: 1.25;
}

.markdown-output :deep(h4) {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  line-height: 1.25;
}

.markdown-output :deep(h5) {
  font-size: 1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  line-height: 1.25;
}

.markdown-output :deep(h6) {
  font-size: 0.9rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  line-height: 1.25;
  color: #666;
}

/* Paragraphs */
.markdown-output :deep(p) {
  margin-top: 0;
  margin-bottom: 1rem;
}

/* Lists */
.markdown-output :deep(ul),
.markdown-output :deep(ol) {
  margin-top: 0;
  margin-bottom: 1rem;
  padding-left: 2rem;
}

.markdown-output :deep(li) {
  margin-bottom: 0.25rem;
}

.markdown-output :deep(li > p) {
  margin-bottom: 0.5rem;
}

.markdown-output :deep(ul ul),
.markdown-output :deep(ul ol),
.markdown-output :deep(ol ul),
.markdown-output :deep(ol ol) {
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
}

/* Links */
.markdown-output :deep(a) {
  color: #0969da;
  text-decoration: none;
}

.markdown-output :deep(a:hover) {
  text-decoration: underline;
}

/* Code */
.markdown-output :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.85em;
  background-color: rgba(175, 184, 193, 0.2);
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

.markdown-output :deep(pre) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.85rem;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 6px;
  padding: 1rem;
  overflow: auto;
  margin-top: 0;
  margin-bottom: 1rem;
}

.markdown-output :deep(pre code) {
  background-color: transparent;
  padding: 0;
  font-size: inherit;
  border-radius: 0;
}

/* Blockquotes */
.markdown-output :deep(blockquote) {
  margin: 0 0 1rem 0;
  padding: 0 1rem;
  border-left: 0.25rem solid #d0d7de;
  color: #57606a;
}

.markdown-output :deep(blockquote > :first-child) {
  margin-top: 0;
}

.markdown-output :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

/* Horizontal rule */
.markdown-output :deep(hr) {
  height: 0.25rem;
  padding: 0;
  margin: 1.5rem 0;
  background-color: #d0d7de;
  border: 0;
}

/* Tables */
.markdown-output :deep(table) {
  border-spacing: 0;
  border-collapse: collapse;
  margin-top: 0;
  margin-bottom: 1rem;
  width: 100%;
  overflow: auto;
}

.markdown-output :deep(table th),
.markdown-output :deep(table td) {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d0d7de;
}

.markdown-output :deep(table th) {
  font-weight: 600;
  background-color: #f6f8fa;
}

.markdown-output :deep(table tr) {
  background-color: #ffffff;
  border-top: 1px solid #d0d7de;
}

.markdown-output :deep(table tr:nth-child(2n)) {
  background-color: #f6f8fa;
}

/* Images */
.markdown-output :deep(img) {
  max-width: 100%;
  height: auto;
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

/* Strong and emphasis */
.markdown-output :deep(strong) {
  font-weight: 600;
}

.markdown-output :deep(em) {
  font-style: italic;
}

/* Task lists */
.markdown-output :deep(input[type="checkbox"]) {
  margin-right: 0.5rem;
}

/* Remove top margin from first element */
.markdown-output :deep(> *:first-child) {
  margin-top: 0 !important;
}

/* Remove bottom margin from last element */
.markdown-output :deep(> *:last-child) {
  margin-bottom: 0 !important;
}
</style>

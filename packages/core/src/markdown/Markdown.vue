<template>
  <div class="ps-viewer markdown-widget-wrap" :style="rootStyle" v-bind="$attrs">
    <div class="markdown-header">
      <EditIcon
        v-if="!disabled"
        class="edit-icon"
        @click="toggleMode"
        :width="20"
        :height="20"
      />
    </div>
    <textarea
      v-if="isEditMode && !disabled"
      v-model="localText"
      @input="emitInput"
      class="markdown-input"
      placeholder="Write markdown here..."
    />
    <div v-else class="markdown-output">
      <div v-if="!localText" class="markdown-placeholder">
        <div class="placeholder-title">Markdown Editor</div>
        <div class="placeholder-text">
          {{ disabled ? "No content available" : "Click the pencil icon above to start editing" }}
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
import { useViewerStyle, type ViewerStyleOverrides } from "../composables/useViewerStyle";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  markdownText?: string;
  mode?: "edit" | "preview";
  sanitize?: boolean;
  inputFormat?: "markdown" | "html";
  disabled?: boolean;
  customStyle?: ViewerStyleOverrides;
}>();

const { rootStyle } = useViewerStyle(() => props.customStyle);

const emit = defineEmits<{
  (e: "update:markdownText", value: string): void;
  (e: "changeMode", value: "edit" | "preview"): void;
}>();

marked.setOptions({ gfm: true, breaks: true });

const localText = ref(props.markdownText ?? "");
watch(() => props.markdownText, (v) => {
  if (v !== undefined && v !== localText.value) localText.value = v;
});

const isEditMode = ref(props.disabled ? false : props.mode ? props.mode === "edit" : false);
watch(() => props.mode, (m) => { if (m && !props.disabled) isEditMode.value = m === "edit"; });
watch(() => props.disabled, (isDisabled) => { if (isDisabled) isEditMode.value = false; });

const renderedHtml = computed(() => {
  const raw = props.inputFormat === "html"
    ? localText.value ?? ""
    : marked.parse(localText.value ?? "");
  return props.sanitize === false ? raw : DOMPurify.sanitize(raw as string);
});

function emitInput() { emit("update:markdownText", localText.value); }
function toggleMode() {
  if (props.disabled) return;
  isEditMode.value = !isEditMode.value;
  emit("changeMode", isEditMode.value ? "edit" : "preview");
}
</script>

<style scoped lang="scss">
@use "../styles/viewer-theme" as vt;

.markdown-widget-wrap {
  @include vt.viewer-base;
  max-width: none;
  width: 100%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ps-color-border);
  border-radius: var(--ps-radius-lg);
  background-color: var(--ps-color-bg);
  overflow: hidden;
}

.markdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ps-space-md) var(--ps-space-lg);
  background-color: var(--ps-color-bg-secondary);
  border-bottom: 1px solid var(--ps-color-border);
}

.edit-icon { cursor: pointer; flex-shrink: 0; }

.markdown-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--ps-space-2xl);
  border: 2px dashed var(--ps-color-border-dark);
  border-radius: var(--ps-radius-lg);
  background-color: var(--ps-color-bg-tertiary);
  min-height: 150px;
  margin: var(--ps-space-lg);
}

.placeholder-title {
  font-size: var(--ps-font-size-lg);
  font-weight: 600;
  color: var(--ps-color-text-dark);
  margin-bottom: var(--ps-space-sm);
}

.placeholder-text {
  color: var(--ps-color-text-secondary);
  font-size: var(--ps-font-size-md);
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
  font-family: var(--ps-font-family-mono);
  font-size: var(--ps-font-size-md);
  line-height: 1.5;
  padding: var(--ps-space-lg);
  border: none;
  resize: none;
  outline: none;
  color: var(--ps-color-text);
}

.markdown-output {
  overflow: auto;
  padding: var(--ps-space-lg);
  color: var(--ps-color-text);
}

.markdown-output :deep(*) { line-height: 1.6; }
.markdown-output :deep(h1) { font-size: 2rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 1rem; line-height: 1.25; border-bottom: 1px solid var(--ps-color-border); padding-bottom: 0.5rem; }
.markdown-output :deep(h1:first-child) { margin-top: 0; }
.markdown-output :deep(h2) { font-size: 1.5rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; line-height: 1.25; border-bottom: 1px solid var(--ps-color-border); padding-bottom: 0.5rem; }
.markdown-output :deep(h3) { font-size: 1.25rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; }
.markdown-output :deep(h4) { font-size: 1.1rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; }
.markdown-output :deep(h5) { font-size: 1rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; }
.markdown-output :deep(h6) { font-size: 0.9rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; color: var(--ps-color-text-secondary); }
.markdown-output :deep(p) { margin-top: 0; margin-bottom: 1rem; }
.markdown-output :deep(ul), .markdown-output :deep(ol) { margin-top: 0; margin-bottom: 1rem; padding-left: 2rem; }
.markdown-output :deep(li) { margin-bottom: 0.25rem; }
.markdown-output :deep(a) { color: var(--ps-color-primary); text-decoration: none; }
.markdown-output :deep(a:hover) { text-decoration: underline; }
.markdown-output :deep(code) { font-family: var(--ps-font-family-mono); font-size: 0.85em; background-color: var(--ps-color-bg-tertiary); padding: 0.2em 0.4em; border-radius: var(--ps-radius-sm); }
.markdown-output :deep(pre) { font-family: var(--ps-font-family-mono); font-size: 0.85rem; line-height: 1.45; background-color: var(--ps-color-bg-secondary); border-radius: var(--ps-radius-lg); padding: var(--ps-space-lg); overflow: auto; margin-top: 0; margin-bottom: 1rem; }
.markdown-output :deep(pre code) { background-color: transparent; padding: 0; font-size: inherit; border-radius: 0; }
.markdown-output :deep(blockquote) { margin: 0 0 1rem 0; padding: 0 1rem; border-left: 0.25rem solid var(--ps-color-border-dark); color: var(--ps-color-text-secondary); }
.markdown-output :deep(hr) { height: 0.25rem; padding: 0; margin: 1.5rem 0; background-color: var(--ps-color-border-dark); border: 0; }
.markdown-output :deep(table) { border-spacing: 0; border-collapse: collapse; margin-bottom: 1rem; width: 100%; }
.markdown-output :deep(table th), .markdown-output :deep(table td) { padding: 0.5rem 0.75rem; border: 1px solid var(--ps-color-border-dark); }
.markdown-output :deep(table th) { font-weight: 600; background-color: var(--ps-color-bg-secondary); }
.markdown-output :deep(table tr:nth-child(2n)) { background-color: var(--ps-color-bg-secondary); }
.markdown-output :deep(img) { max-width: 100%; height: auto; }
.markdown-output :deep(> *:first-child) { margin-top: 0 !important; }
.markdown-output :deep(> *:last-child) { margin-bottom: 0 !important; }
</style>

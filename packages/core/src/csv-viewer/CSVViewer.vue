<!-- CSVViewer.vue - Simple CSV/Tabular data viewer with client-side pagination -->
<template>
  <div class="ps-viewer csv-viewer" :style="rootStyle">
    <!-- Loading State -->
    <div v-if="isLoading" class="ps-loading">
      <div class="ps-spinner"></div>
      <p>Loading data...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="ps-error">
      <h3>Error</h3>
      <p>{{ error }}</p>
      <button @click="retryLoad" class="ps-btn-danger">Retry</button>
    </div>

    <!-- Data View -->
    <div v-else-if="rows.length > 0" class="csv-viewer-data">
      <!-- Info Bar -->
      <div class="ps-info-bar">
        <span class="ps-info-bar-label">
          {{ paginatedRows.length }} of {{ rows.length }} rows
        </span>
        <div class="ps-info-bar-controls">
          <el-pagination
            v-model:current-page="currentPage"
            :page-size="pageSize"
            :total="rows.length"
            layout="prev, pager, next"
            hide-on-single-page
          />
        </div>
      </div>

      <!-- Data Table -->
      <div class="ps-table-container">
        <table class="ps-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in paginatedRows" :key="index">
              <td v-for="column in columns" :key="column">
                {{ formatCellValue(row[column]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useViewerStyle, type ViewerStyleOverrides } from "../composables/useViewerStyle";

const props = defineProps<{
  url: string
  rowsPerPage?: number
  autoLoad?: boolean
  customStyle?: ViewerStyleOverrides
}>();

const { rootStyle } = useViewerStyle(() => props.customStyle);

const isLoading = ref(false);
const error = ref("");
const columns = ref<string[]>([]);
const rows = ref<Record<string, string>[]>([]);
const currentPage = ref(1);
const pageSize = ref(props.rowsPerPage ?? 25);

const paginatedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return rows.value.slice(start, start + pageSize.value);
});

function parseCSV(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { columns: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]);
  const parsed: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    parsed.push(row);
  }

  return { columns: headers, rows: parsed };
}

const loadCSVFile = async () => {
  if (!props.url) {
    error.value = "No URL provided";
    return;
  }

  try {
    isLoading.value = true;
    error.value = "";

    const response = await fetch(props.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const parsed = parseCSV(text);

    columns.value = parsed.columns;
    rows.value = parsed.rows;
    currentPage.value = 1;
  } catch (err: any) {
    error.value = `Failed to load file: ${err.message}`;
  } finally {
    isLoading.value = false;
  }
};

const formatCellValue = (value: any) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string" && value.length > 100) {
    return value.substring(0, 100) + "...";
  }
  return String(value);
};

const retryLoad = async () => {
  await loadCSVFile();
};

watch(
  () => props.url,
  async (newUrl) => {
    if (newUrl) {
      currentPage.value = 1;
      await loadCSVFile();
    }
  }
);

onMounted(async () => {
  if ((props.autoLoad ?? true) && props.url) {
    await loadCSVFile();
  }
});
</script>

<style scoped lang="scss">
@use "../styles/viewer-theme" as vt;

.csv-viewer {
  @include vt.viewer-base;
  max-width: 100%;
}

.ps-loading { @include vt.ps-loading; }
.ps-spinner { @include vt.ps-spinner; }
.ps-error { @include vt.ps-error-panel; }
.ps-btn-danger { @include vt.ps-btn-danger; }
.ps-info-bar { @include vt.ps-info-bar; }

.ps-info-bar-label {
  font-weight: 500;
}

.ps-info-bar-controls {
  display: flex;
  align-items: center;
}

.csv-viewer-data {
  background: var(--ps-color-bg);
  border: 1px solid var(--ps-color-border);
  border-radius: var(--ps-radius);
  overflow: hidden;
}

.ps-table-container {
  overflow-x: auto;
  max-height: 600px;
}

.ps-table { @include vt.ps-data-table; }
</style>

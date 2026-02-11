<template>
  <div class="ps-viewer data-explorer" :style="rootStyle">
    <div class="data-explorer-content">
      <!-- Query Panel -->
      <div class="data-explorer-query-panel" v-if="isConnected">
        <h3>SQL Query</h3>
        <div class="data-explorer-query-examples">
          <span>Quick queries:</span>
          <button
            v-for="example in queryExamples"
            :key="example.name"
            @click="setQuery(example.query)"
            class="ps-btn-secondary ps-btn--sm"
          >
            {{ example.name }}
          </button>
        </div>
        <textarea
          v-model="sqlQuery"
          placeholder="SELECT * FROM data;"
          class="data-explorer-query-textarea"
          rows="4"
        ></textarea>
        <button
          class="ps-btn-primary"
          @click="executeQuery"
          :disabled="isQueryRunning || !sqlQuery"
        >
          {{ isQueryRunning ? "Running..." : "Execute Query" }}
        </button>
      </div>

      <!-- Results Panel -->
      <div class="data-explorer-results-panel" v-if="queryResults">
        <h3>Results ({{ queryResults.length }} rows)</h3>
        <div class="data-explorer-results-controls">
          <div class="data-explorer-left-controls">
            <button class="ps-btn-secondary" @click="exportToCsv">
              Export to CSV
            </button>
          </div>
          <div class="data-explorer-right-controls">
            <div v-if="totalPages > 1" class="data-explorer-pagination">
              <button
                class="ps-btn-secondary ps-btn--sm"
                :disabled="currentPage <= 1"
                @click="handlePageChange(currentPage - 1)"
              >
                Prev
              </button>
              <span class="data-explorer-page-info"
                >{{ currentPage }} / {{ totalPages }}</span
              >
              <button
                class="ps-btn-secondary ps-btn--sm"
                :disabled="currentPage >= totalPages"
                @click="handlePageChange(currentPage + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <!-- Table View -->
        <div v-if="displayMode === 'table'" class="ps-table-container">
          <table class="ps-table">
            <thead>
              <tr>
                <th v-for="column in tableColumns" :key="column">
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in paginatedResults" :key="index">
                <td v-for="column in tableColumns" :key="column">
                  {{ formatCellValue(row[column]) }}
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Bottom Pagination -->
          <div v-if="totalPages > 1" class="data-explorer-bottom-pagination">
            <button
              class="ps-btn-secondary ps-btn--sm"
              :disabled="currentPage <= 1"
              @click="handlePageChange(currentPage - 1)"
            >
              Prev
            </button>
            <span class="data-explorer-page-info">{{ currentPage }} / {{ totalPages }}</span>
            <button
              class="ps-btn-secondary ps-btn--sm"
              :disabled="currentPage >= totalPages"
              @click="handlePageChange(currentPage + 1)"
            >
              Next
            </button>
          </div>
        </div>

        <!-- JSON View -->
        <div v-else class="data-explorer-json-container">
          <pre>{{ JSON.stringify(queryResults.slice(0, 100), null, 2) }}</pre>
        </div>
      </div>

      <!-- Error Display -->
      <div v-if="error" class="ps-error">
        <h3>Error</h3>
        <p>{{ error }}</p>
        <button @click="clearError" class="ps-btn-danger">Clear</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useDuckDBStore } from "../duckdb";
import { useViewerStyle, type ViewerStyleOverrides } from "../composables/useViewerStyle";

const props = defineProps<{
  url?: string
  fileType?: string
  viewerId?: string
  fileId?: string | null
  customStyle?: ViewerStyleOverrides
}>();

const { rootStyle } = useViewerStyle(() => props.customStyle);

const emit = defineEmits(["query-results"]);

const duckDBStore = useDuckDBStore();

const csvOptions = ref({
  header: true,
  dynamicTyping: true,
  delimiter: ",",
});

const isLoading = ref(false);
const isQueryRunning = ref(false);
const s3Url = ref(props.url ?? "");
const tableName = ref<string | null>(null);
const sqlQuery = ref("");
const queryResults = ref<any[] | null>(null);
const error = ref("");
const displayMode = ref("table");
const currentPage = ref(1);
const itemsPerPage = ref(50);
const connectionId = ref<string | null>(null);
const isFileLoading = ref(false);
const localViewerId = props.viewerId ?? `viewer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const localFileType = computed(() => props.fileType ?? "parquet");

watch(
  () => props.url,
  async (newValue) => {
    s3Url.value = newValue ?? "";
    if (newValue) {
      try {
        await ensureConnection();
        await loadFile();
      } catch (e) {
        console.error("file can not be loaded:", e);
      }
    }
  },
  { immediate: true }
);

const isConnected = computed(() => {
  return duckDBStore.isReady && connectionId.value && !isLoading.value;
});
const stableId = computed(() => duckDBStore.formatIdFromUrl(props.url ?? ""));

const tableColumns = computed(() => {
  if (!queryResults.value || !Array.isArray(queryResults.value) || queryResults.value.length === 0)
    return [];
  return Object.keys(queryResults.value[0] || {});
});

const totalPages = computed(() => {
  if (!queryResults.value || !Array.isArray(queryResults.value)) return 0;
  return Math.ceil(queryResults.value.length / itemsPerPage.value);
});

const paginatedResults = computed(() => {
  if (!queryResults.value || !Array.isArray(queryResults.value)) return [];
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return queryResults.value.slice(start, end);
});

const queryExamples = computed(() => {
  return [
    { name: "Show All", query: `SELECT * FROM data;` },
    { name: "Count Rows", query: `SELECT COUNT(*) as row_count FROM data;` },
    {
      name: "Group By",
      query: `SELECT
                                    column1, column2,
                                    COUNT(*) as count
                                  FROM data
                                  GROUP BY column1, column2
                                  ORDER BY column1, column2
                                  LIMIT 20;`,
    },
    { name: "Describe", query: `DESCRIBE data;` },
    { name: "Sample", query: `SELECT * FROM data USING SAMPLE 10;` },
    { name: "Columns", query: `PRAGMA table_info(data);` },
  ];
});

async function ensureConnection() {
  if (connectionId.value) return;
  const { connectionId: cid } = await duckDBStore.createConnection(localViewerId);
  connectionId.value = cid;
}

const loadFile = async () => {
  if (!s3Url.value) {
    error.value = "Please provide a valid S3 URL";
    return;
  }

  if (isFileLoading.value) return;

  isFileLoading.value = true;
  isLoading.value = true;
  error.value = "";
  tableName.value = null;

  try {
    const tableId = props.fileId ? `file_${props.fileId}` : `data_${Date.now()}`;

    const loadedTableName = await duckDBStore.loadFile(
      s3Url.value,
      localFileType.value as "csv" | "parquet",
      tableId,
      csvOptions.value,
      localViewerId,
      stableId.value
    );

    tableName.value = loadedTableName;
    setQuery(`SELECT * FROM data;`);
  } catch (err: any) {
    console.error("Failed to load file:", err);
    error.value = `Failed to load file: ${err.message}`;
    tableName.value = null;
  } finally {
    isLoading.value = false;
    isFileLoading.value = false;
  }
};

const interceptQuery = (query: string) => {
  if (!tableName.value || !query) return query;
  return query
    .replace(/\bFROM\s+data\b/gi, `FROM ${tableName.value}`)
    .replace(/\bJOIN\s+data\b/gi, `JOIN ${tableName.value}`)
    .replace(/\bUPDATE\s+data\b/gi, `UPDATE ${tableName.value}`)
    .replace(/\bINSERT\s+INTO\s+data\b/gi, `INSERT INTO ${tableName.value}`)
    .replace(/\bINTO\s+data\b/gi, `INTO ${tableName.value}`)
    .replace(/\btable_info\(\s*data\s*\)/gi, `table_info(${tableName.value})`)
    .replace(/\bDESCRIBE\s+data\b/gi, `DESCRIBE ${tableName.value}`)
    .replace(/\bPRAGMA\s+table_info\(\s*data\s*\)/gi, `PRAGMA table_info(${tableName.value})`);
};

const executeQuery = async () => {
  if (!sqlQuery.value || !connectionId.value) {
    error.value = "Please provide a valid SQL query";
    return;
  }
  if (!tableName.value) {
    error.value = "No data table loaded";
    return;
  }

  isQueryRunning.value = true;
  error.value = "";
  currentPage.value = 1;

  try {
    const transformedQuery = interceptQuery(sqlQuery.value.trim());
    queryResults.value = await duckDBStore.executeQuery(transformedQuery, connectionId.value);
    await duckDBStore.publishViewFromQuery("umap_result", transformedQuery, connectionId.value);
    emit("query-results", { results: queryResults.value, query: transformedQuery });
  } catch (err: any) {
    console.error("Query execution failed:", err);
    error.value = `Query execution failed: ${err.message}`;
    queryResults.value = null;
  } finally {
    isQueryRunning.value = false;
  }
};

const handlePageChange = (page: number) => { currentPage.value = page; };
const setQuery = (query: string) => { sqlQuery.value = query; };

const formatCellValue = (value: any) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  if (typeof value === "string" && value.length > 100) return value.substring(0, 100) + "...";
  return value.toString();
};

const exportToCsv = () => {
  if (!queryResults.value || queryResults.value.length === 0) return;
  const headers = Object.keys(queryResults.value[0]);
  const csvContent = [
    headers.join(","),
    ...queryResults.value.map((row) =>
      headers.map((header) => {
        const value = row[header];
        const stringValue = value === null || value === undefined ? "" : value.toString();
        return stringValue.includes(",") ? `"${stringValue}"` : stringValue;
      }).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "query-results.csv";
  link.click();
  URL.revokeObjectURL(url);
};

const clearError = () => { error.value = ""; };

onMounted(async () => { await ensureConnection(); });
onUnmounted(async () => {
  if (connectionId.value) await duckDBStore.closeConnection(connectionId.value);
});
</script>

<style scoped lang="scss">
@use "../styles/viewer-theme" as vt;

.data-explorer {
  @include vt.viewer-base;
  display: flex;
  flex-direction: column;
  padding: var(--ps-space-xl);
}

.data-explorer-content {
  display: grid;
  gap: var(--ps-space-2xl);
}

.data-explorer-query-panel,
.data-explorer-results-panel {
  background: var(--ps-color-bg);
  border: 1px solid var(--ps-color-border);
  border-radius: var(--ps-radius);
  padding: var(--ps-space-xl);
  overflow: auto;
}

.data-explorer-query-panel h3,
.data-explorer-results-panel h3 {
  margin-top: 0;
  color: var(--ps-color-text-dark);
  border-bottom: 1px solid var(--ps-color-border-light);
  padding-bottom: var(--ps-space-sm);
  font-size: var(--ps-font-size-lg);
}

.data-explorer-query-examples {
  margin-bottom: var(--ps-space-lg);
  display: flex;
  gap: var(--ps-space-sm);
  flex-wrap: wrap;
  align-items: center;

  span {
    font-weight: 500;
    color: var(--ps-color-text-secondary);
  }
}

.data-explorer-query-textarea {
  @include vt.ps-input;
  font-family: var(--ps-font-family-mono);
  resize: vertical;
  min-height: 100px;
  margin: var(--ps-space-sm) 0;
}

.ps-btn-primary { @include vt.ps-btn-primary; }
.ps-btn-secondary { @include vt.ps-btn-secondary; }
.ps-btn-danger { @include vt.ps-btn-danger; }
.ps-btn--sm {
  padding: var(--ps-space-xs) var(--ps-space-md);
  font-size: var(--ps-font-size-sm);
}
.ps-error { @include vt.ps-error-panel; }

.data-explorer-results-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--ps-space-lg);
}

.data-explorer-left-controls,
.data-explorer-right-controls {
  display: flex;
  align-items: center;
  gap: var(--ps-space-lg);
}

.data-explorer-pagination {
  display: flex;
  align-items: center;
  gap: var(--ps-space-sm);
}

.ps-table-container { overflow-x: auto; }
.ps-table { @include vt.ps-data-table; }

.data-explorer-bottom-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--ps-space-xl) 0;
  margin-top: var(--ps-space-xl);
  border-top: 1px solid var(--ps-color-border);
  gap: var(--ps-space-sm);
}

.data-explorer-page-info {
  font-weight: 500;
  color: var(--ps-color-text-secondary);
}

.data-explorer-json-container {
  background: var(--ps-color-bg-secondary);
  border: 1px solid var(--ps-color-border);
  border-radius: var(--ps-radius);
  padding: var(--ps-space-lg);
  max-height: 400px;
  overflow: auto;

  pre {
    margin: 0;
    font-size: var(--ps-font-size-sm);
    font-family: var(--ps-font-family-mono);
    white-space: pre-wrap;
  }
}
</style>

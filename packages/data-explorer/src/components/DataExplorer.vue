<template>
  <div class="dashboard-container">
    <div class="dashboard-content">
      <!-- Query Panel -->
      <div class="query-panel" v-if="isConnected">
        <h3>SQL Query</h3>
        <div class="query-examples">
          <span>Quick queries:</span>
          <button
            v-for="example in queryExamples"
            :key="example.name"
            @click="setQuery(example.query)"
            class="example-btn"
          >
            {{ example.name }}
          </button>
        </div>
        <textarea
          v-model="sqlQuery"
          placeholder="SELECT * FROM data;"
          class="query-textarea"
          rows="4"
        ></textarea>
        <button
          class="execute-query-button"
          @click="executeQuery"
          :disabled="isQueryRunning || !sqlQuery"
        >
          {{ isQueryRunning ? "Running..." : "Execute Query" }}
        </button>
      </div>

      <!-- Results Panel -->
      <div class="results-panel" v-if="queryResults">
        <h3>Results ({{ queryResults.length }} rows)</h3>
        <div class="results-controls">
          <div class="left-controls">
            <button class="secondary-btn" @click="exportToCsv">
              Export to CSV
            </button>
          </div>
          <div class="right-controls">
            <div v-if="totalPages > 1" class="pagination">
              <button
                class="page-btn"
                :disabled="currentPage <= 1"
                @click="handlePageChange(currentPage - 1)"
              >
                Prev
              </button>
              <span class="page-info"
                >{{ currentPage }} / {{ totalPages }}</span
              >
              <button
                class="page-btn"
                :disabled="currentPage >= totalPages"
                @click="handlePageChange(currentPage + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </div>
        <div class="pagination-wrapper"></div>

        <!-- Table View -->
        <div v-if="displayMode === 'table'" class="table-container">
          <table class="results-table">
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

          <!-- Bottom Pagination for large datasets -->
          <div v-if="totalPages > 1" class="bottom-pagination">
            <button
              class="page-btn"
              :disabled="currentPage <= 1"
              @click="handlePageChange(currentPage - 1)"
            >
              Prev
            </button>
            <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
            <button
              class="page-btn"
              :disabled="currentPage >= totalPages"
              @click="handlePageChange(currentPage + 1)"
            >
              Next
            </button>
          </div>
        </div>

        <!-- JSON View -->
        <div v-else class="json-container">
          <pre>{{ JSON.stringify(queryResults.slice(0, 100), null, 2) }}</pre>
        </div>
      </div>

      <!-- Error Display -->
      <div v-if="error" class="error-panel">
        <h3>Error</h3>
        <p>{{ error }}</p>
        <button @click="clearError" class="clear-error-btn">Clear</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useDuckDBStore } from "@pennsieve-viz/duckdb";

const props = defineProps({
  url: {
    type: String,
    default: "",
  },
  fileType: {
    type: String,
    default: "parquet",
    validator: (value: string) => ["parquet", "csv"].includes(value),
  },
  viewerId: {
    type: String,
    default: () =>
      `viewer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  },
  fileId: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(["query-results"]);

// Use DuckDB store
const duckDBStore = useDuckDBStore();

// CSV-specific state
const csvOptions = ref({
  header: true,
  dynamicTyping: true,
  delimiter: ",",
});

// Reactive state
const isLoading = ref(false);
const isQueryRunning = ref(false);
const s3Url = ref(props.url);
const tableName = ref<string | null>(null);
const sqlQuery = ref("");
const queryResults = ref<any[] | null>(null);
const error = ref("");
const displayMode = ref("table");
const currentPage = ref(1);
const itemsPerPage = ref(50);
const connectionId = ref<string | null>(null);
const isFileLoading = ref(false);

// Watch for URL changes
watch(
  () => props.url,
  async (newValue) => {
    s3Url.value = newValue;
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

// Computed properties
const isConnected = computed(() => {
  return duckDBStore.isReady && connectionId.value && !isLoading.value;
});
const stableId = computed(() => duckDBStore.formatIdFromUrl(props.url));

const tableColumns = computed(() => {
  if (
    !queryResults.value ||
    !Array.isArray(queryResults.value) ||
    queryResults.value.length === 0
  )
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
  const { connectionId: cid } = await duckDBStore.createConnection(
    props.viewerId
  );
  connectionId.value = cid;
}

// Initialize connection and load file
const initialize = async () => {
  try {
    if (!connectionId.value) await ensureConnection();

    // Load file if URL is provided
    if (s3Url.value) {
      await loadFile();
    }
  } catch (err: any) {
    console.error("Failed to initialize viewer:", err);
    error.value = `Failed to initialize: ${err.message}`;
  }
};

// Load file using the store
const loadFile = async () => {
  if (!s3Url.value) {
    error.value = "Please provide a valid S3 URL";
    return;
  }

  // Prevent double-loading
  if (isFileLoading.value) {
    console.log("File is already loading, skipping duplicate call");
    return;
  }

  isFileLoading.value = true;
  isLoading.value = true;
  error.value = "";
  tableName.value = null; // Reset table name before loading

  try {
    // Generate table name using stable ID if available
    const tableId = props.fileId
      ? `file_${props.fileId}`
      : `data_${Date.now()}`;

    // Use store to load file (will be shared across all viewers with same fileId)
    const loadedTableName = await duckDBStore.loadFile(
      s3Url.value,
      props.fileType as "csv" | "parquet",
      tableId,
      csvOptions.value,
      props.viewerId,
      stableId.value
    );

    tableName.value = loadedTableName;

    // Auto-execute a sample query using "data"
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

// Query interceptor to replace "data" with actual table name
const interceptQuery = (query: string) => {
  if (!tableName.value || !query) return query;

  const interceptedQuery = query
    .replace(/\bFROM\s+data\b/gi, `FROM ${tableName.value}`)
    .replace(/\bJOIN\s+data\b/gi, `JOIN ${tableName.value}`)
    .replace(/\bUPDATE\s+data\b/gi, `UPDATE ${tableName.value}`)
    .replace(/\bINSERT\s+INTO\s+data\b/gi, `INSERT INTO ${tableName.value}`)
    .replace(/\bINTO\s+data\b/gi, `INTO ${tableName.value}`)
    .replace(/\btable_info\(\s*data\s*\)/gi, `table_info(${tableName.value})`)
    .replace(/\bDESCRIBE\s+data\b/gi, `DESCRIBE ${tableName.value}`)
    .replace(
      /\bPRAGMA\s+table_info\(\s*data\s*\)/gi,
      `PRAGMA table_info(${tableName.value})`
    );

  return interceptedQuery;
};

// Execute SQL query using store
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
    // Intercept and transform the query
    const transformedQuery = interceptQuery(sqlQuery.value.trim());

    queryResults.value = await duckDBStore.executeQuery(
      transformedQuery,
      connectionId.value
    );
    await duckDBStore.publishViewFromQuery(
      "umap_result",
      transformedQuery,
      connectionId.value
    );

    emit("query-results", {
      results: queryResults.value,
      query: transformedQuery,
    });
  } catch (err: any) {
    console.error("Query execution failed:", err);
    error.value = `Query execution failed: ${err.message}`;
    queryResults.value = null;
  } finally {
    isQueryRunning.value = false;
  }
};

// Pagination event handlers
const handlePageChange = (page: number) => {
  currentPage.value = page;
};

// Set predefined query
const setQuery = (query: string) => {
  sqlQuery.value = query;
};

// Format cell values for display
const formatCellValue = (value: any) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  }
  if (typeof value === "string" && value.length > 100) {
    return value.substring(0, 100) + "...";
  }
  return value.toString();
};

// Export results to CSV
const exportToCsv = () => {
  if (!queryResults.value || queryResults.value.length === 0) return;

  const headers = Object.keys(queryResults.value[0]);
  const csvContent = [
    headers.join(","),
    ...queryResults.value.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          const stringValue =
            value === null || value === undefined ? "" : value.toString();
          return stringValue.includes(",") ? `"${stringValue}"` : stringValue;
        })
        .join(",")
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

// Clear error
const clearError = () => {
  error.value = "";
};

// Lifecycle hooks
onMounted(async () => {
  await ensureConnection();
});

onUnmounted(async () => {
  if (connectionId.value) {
    await duckDBStore.closeConnection(connectionId.value);
  }
});
</script>

<style scoped lang="scss">
@use "@pennsieve-viz/core/styles/theme" as theme;

.dashboard-container {
  display: flex;
  flex-direction: column;
  margin: 0 auto;
  padding: 20px;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 15px;
  border-bottom: 2px solid #e0e0e0;
}

.dashboard-header h1 {
  margin: 0;
  color: #333;
}

.status-indicator {
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: 500;
  color: white;
  background-color: #666;
}

.status-indicator.loading {
  background-color: #ff9800;
}

.status-indicator.connected {
  background-color: theme.$green_2;
}

.dashboard-content {
  display: grid;
  gap: 25px;
}

.config-panel,
.query-panel,
.results-panel,
.error-panel {
  background: white;
  width: inherit;
  border: 1px solid #ddd;
  padding: 20px;
  overflow: scroll;
}

.config-panel h3,
.query-panel h3,
.results-panel h3,
.error-panel h3 {
  margin-top: 0;
  color: #333;
  border-bottom: 1px solid #eee;
  padding-bottom: 10px;
}

.query-info {
  background: #e8f4fd;
  border: 1px solid #bee5eb;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 15px;
}

.query-info .info-text {
  color: #0c5460;
  font-size: 14px;
  font-weight: 500;
}

.pagination-wrapper {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
}

.query-info .info-text code {
  background: #d1ecf1;
  color: #0c5460;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "Courier New", monospace;
  font-weight: 600;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
  color: #555;
}

.url-input,
.table-input,
.query-textarea,
.display-mode {
  width: calc(100% - 16px);
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  margin: 8px 0;
}

.query-textarea {
  font-family: "Courier New", monospace;
  resize: vertical;
  min-height: 100px;
}

.url-input:focus,
.table-input:focus,
.query-textarea:focus {
  outline: none;
  border-color: #2196f3;
}

.load-btn,
.execute-btn,
.example-btn,
.export-btn,
.clear-error-btn,
.page-btn {
  background: #2196f3;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.load-btn:hover,
.execute-btn:hover,
.export-btn:hover,
.clear-error-btn:hover,
.page-btn:hover {
  background: #1976d2;
}

.load-btn:disabled,
.execute-btn:disabled,
.page-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.query-examples {
  margin-bottom: 15px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.query-examples span {
  font-weight: 500;
  color: #666;
}

.example-btn {
  background: #f5f5f5;
  color: #333;
  padding: 6px 12px;
  font-size: 12px;
}

.example-btn:hover {
  background: #e0e0e0;
}

.results-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.left-controls {
  display: flex;
  align-items: center;
}

.right-controls {
  display: flex;
  align-items: center;
  gap: 15px;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 10px;
}

.table-container {
  overflow-x: auto;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.results-table th,
.results-table td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}

.results-table th {
  background: #f8f9fa;
  font-weight: 600;
  position: sticky;
  top: 0;
}

.results-table tbody tr:hover {
  background: #f5f5f5;
}

.bottom-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px 0;
  margin-top: 20px;
  border-top: 1px solid #e9ecef;
  gap: 10px;
}

.page-info {
  font-weight: 500;
  color: #666;
}

.json-container {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  padding: 15px;
  max-height: 400px;
  overflow: auto;
}

.json-container pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
}

.error-panel {
  border-color: #f44336;
  background: #ffebee;
}

.error-panel h3 {
  color: #d32f2f;
}

.error-panel p {
  color: #c62828;
  margin: 10px 0;
}

.clear-error-btn {
  background: #f44336;
}

.clear-error-btn:hover {
  background: #d32f2f;
}

.execute-query-button {
  cursor: pointer;
  background: #f5f5f5;
  color: #333;
  padding: 6px 12px;
  border: solid 1px #cbcbcb;
}

.secondary-btn {
  background: #f5f5f5;
  color: #333;
  padding: 6px 12px;
  border: solid 1px #cbcbcb;
  border-radius: 4px;
  cursor: pointer;
}

.secondary-btn:hover {
  background: #e0e0e0;
}
</style>

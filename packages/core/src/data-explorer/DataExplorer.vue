<template>
  <div class="ps-viewer data-explorer" :style="rootStyle">
    <div class="data-explorer-content">
      <!-- Query Panel -->

      <div class="query-panel" v-if="store.isConnected">
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
          v-model="store.sqlQuery"
          placeholder="SELECT * FROM data;"
          class="data-explorer-query-textarea"
          rows="4"
        ></textarea>
        <button
          class="ps-btn-primary"
          @click="executeQuery"
          :disabled="store.isQueryRunning || !store.sqlQuery"
        >
          {{ store.isQueryRunning ? "Running..." : "Execute Query" }}
        </button>
      </div>

      <!-- Results Panel -->
      <div class="results-panel" v-if="store.queryResults">
        <h3>Results ({{ store.rowCount }} rows)</h3>
        <div class="results-controls">
          <div class="left-controls">
            <button class="secondary-btn" @click="exportToCsv">
              Export to CSV
            </button>
          </div>
          <div class="right-controls">
            <div v-if="store.totalPages > 1" class="pagination">
              <button
                class="page-btn"
                :disabled="store.currentPage <= 1"
                @click="store.prevPage()"
              >
                Prev
              </button>
              <span class="page-info"
                >{{ store.currentPage }} / {{ store.totalPages }}</span
              >
              <button
                class="page-btn"
                :disabled="store.currentPage >= store.totalPages"
                @click="store.nextPage()"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <!-- Table View -->
        <div v-if="store.displayMode === 'table'" class="table-container">
          <table class="results-table">
            <thead>
              <tr>
                <th v-for="column in store.tableColumns" :key="column">
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in store.paginatedResults" :key="index">
                <td v-for="column in store.tableColumns" :key="column">
                  {{ formatCellValue(row[column]) }}
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Bottom Pagination for large datasets -->
          <div v-if="store.totalPages > 1" class="bottom-pagination">
            <button
              class="page-btn"
              :disabled="store.currentPage <= 1"
              @click="store.prevPage()"
            >
              Prev
            </button>
            <span class="page-info">{{ store.currentPage }} / {{ store.totalPages }}</span>
            <button
              class="page-btn"
              :disabled="store.currentPage >= store.totalPages"
              @click="store.nextPage()"
            >
              Next
            </button>
          </div>
        </div>

        <!-- JSON View -->
        <div v-else class="json-container">
          <pre>{{ JSON.stringify(store.queryResults.slice(0, 100), null, 2) }}</pre>
        </div>
      </div>

      <!-- Error Display -->
      <div v-if="store.error" class="error-panel">
        <h3>Error</h3>
        <p>{{ store.error }}</p>
        <button @click="store.clearError()" class="clear-error-btn">Clear</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">

import { computed, onMounted, onUnmounted, watch, provide, inject } from "vue";
import type { DuckDBStoreInterface } from "../duckdb";
import { createDataExplorerStore, clearDataExplorerStore } from "./dataExplorerStore";

const props = defineProps({
  instanceId: {
    type: String,
    default: 'default',
  },
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

// Create instance-specific store
const effectiveInstanceId = computed(() => props.instanceId || 'default')
const store = createDataExplorerStore(effectiveInstanceId.value)

// Provide store to child components (for future use)
provide('dataExplorerStore', store)
provide('dataExplorerInstanceId', effectiveInstanceId.value)

// Use DuckDB store (provided by host app via provide/inject)
const _injectedDuckDB = inject<DuckDBStoreInterface>('duckdb')
if (!_injectedDuckDB) {
  throw new Error(
    '[@pennsieve-viz/core] DuckDB store not provided. ' +
    'Please provide a DuckDB store via app.provide("duckdb", store)'
  )
}
const duckDBStore: DuckDBStoreInterface = _injectedDuckDB

// Initialize source info from props
store.setSourceInfo({
  url: props.url,
  fileType: props.fileType as 'csv' | 'parquet',
  fileId: props.fileId,
  viewerId: props.viewerId,
})

// Computed for stable ID
const stableId = computed(() => duckDBStore.formatIdFromUrl(props.url));

watch(
  () => props.url,
  async (newValue) => {
    store.setSourceInfo({ url: newValue })
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
    { name: "Sample", query: `SELECT * FROM data USING SAMPLE 10;` },
  ];
});

async function ensureConnection() {
  if (store.connectionId) return;
  const { connectionId: cid } = await duckDBStore.createConnection(
    `dataExplorer_${effectiveInstanceId.value}_${props.viewerId}`
  );
  store.setConnectionId(cid);
}

// Initialize connection and load file
const initialize = async () => {
  try {
    if (!store.connectionId) await ensureConnection();

    // Load file if URL is provided
    if (store.sourceInfo.url) {
      await loadFile();
    }
  } catch (err: any) {
    console.error("Failed to initialize viewer:", err);
    store.setError(`Failed to initialize: ${err.message}`);
  }
};

// Load file using the store
const loadFile = async () => {
  if (!store.sourceInfo.url) {
    store.setError("Please provide a valid S3 URL");
    return;
  }


  // Prevent double-loading
  if (store.isFileLoading) {
    return;
  }

  store.setFileLoading(true);
  store.setLoading(true);
  store.clearError();
  store.setTableName(null); // Reset table name before loading

  try {
    const tableId = props.fileId ? `file_${props.fileId}` : `data_${Date.now()}`;

    const loadedTableName = await duckDBStore.loadFile(
      store.sourceInfo.url,
      props.fileType as "csv" | "parquet",
      tableId,
      store.csvOptions,
      props.viewerId,
      stableId.value
    );

    store.setTableName(loadedTableName);

    // Auto-execute a sample query using "data"
    setQuery(`SELECT * FROM data;`);
  } catch (err: any) {
    console.error("Failed to load file:", err);
    store.setError(`Failed to load file: ${err.message}`);
    store.setTableName(null);
  } finally {
    store.setLoading(false);
    store.setFileLoading(false);
  }
};


// Execute SQL query using store

const executeQuery = async () => {
  if (!store.sqlQuery || !store.connectionId) {
    store.setError("Please provide a valid SQL query");
    return;
  }

  if (!store.tableName) {
    store.setError("No data table loaded");
    return;
  }

  store.setQueryRunning(true);
  store.clearError();
  store.setCurrentPage(1);

  try {
    // Intercept and transform the query
    const transformedQuery = store.interceptQuery(store.sqlQuery.trim());

    const results = await duckDBStore.executeQuery(
      transformedQuery,
      store.connectionId
    );
    store.setQueryResults(results);
    store.addToQueryHistory(store.sqlQuery);

    await duckDBStore.publishViewFromQuery(
      "umap_result",
      transformedQuery,
      store.connectionId
    );

    emit("query-results", {
      results: store.queryResults,
      query: transformedQuery,
    });
  } catch (err: any) {
    console.error("Query execution failed:", err);
    store.setError(`Query execution failed: ${err.message}`);
    store.setQueryResults(null);
  } finally {
    store.setQueryRunning(false);
  }
};

// Set predefined query
const setQuery = (query: string) => {
  store.setQuery(query);
};

// Format cell values for display
const formatCellValue = (value: any) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  if (typeof value === "string" && value.length > 100) return value.substring(0, 100) + "...";
  return value.toString();
};

const exportToCsv = () => {
  if (!store.queryResults || store.queryResults.length === 0) return;

  const headers = Object.keys(store.queryResults[0]);
  const csvContent = [
    headers.join(","),
    ...store.queryResults.map((row) =>
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


// Lifecycle hooks
onMounted(async () => {
  await ensureConnection();
});

onMounted(async () => { await ensureConnection(); });
onUnmounted(async () => {

  // Close DuckDB connection
  if (store.connectionId) {
    await duckDBStore.closeConnection(store.connectionId);
  }
  // Clear store instance
  clearDataExplorerStore(effectiveInstanceId.value);

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

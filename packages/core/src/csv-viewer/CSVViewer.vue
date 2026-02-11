<!-- CSVViewer.vue - Simple CSV/Tabular data viewer with DuckDB-powered pagination -->
<template>
  <div class="csv-viewer-container">
    <!-- Loading State -->
    <div v-if="isLoading" class="csv-viewer-loading">
      <div class="csv-viewer-spinner"></div>
      <p>Loading data...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="csv-viewer-error">
      <h3>Error</h3>
      <p>{{ error }}</p>
      <button @click="retryLoad" class="csv-viewer-retry-btn">Retry</button>
    </div>

    <!-- Data View -->
    <div v-else-if="isConnected && queryResults" class="csv-viewer-data">
      <!-- Info Bar -->
      <div class="csv-viewer-info-bar">
        <span class="csv-viewer-row-count">
          {{ paginatedResults.length }} of {{ totalRowsDisplay }} rows
        </span>
        <div class="csv-viewer-info-controls">
          <el-pagination
            v-model:current-page="currentPage"
            :page-size="pageSize"
            :total="totalRowsDisplay"
            layout="prev, pager, next"
            @current-change="handlePageChange"
            hide-on-single-page
          />
        </div>
      </div>

      <!-- Data Table -->
      <div class="csv-viewer-table-container">
        <table class="csv-viewer-table">
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useDuckDBStore } from "../duckdb";

const props = defineProps({
  url: {
    type: String,
    required: true,
  },
  fileType: {
    type: String,
    default: "csv",
    validator: (value: string) => ["csv", "parquet"].includes(value),
  },
  rowsPerPage: {
    type: Number,
    default: 25,
  },
  autoLoad: {
    type: Boolean,
    default: true,
  },
  fileId: {
    type: String,
    default: null,
  },
});

const duckDBStore = useDuckDBStore();

const isLoading = ref(false);
const error = ref("");
const connectionId = ref<string | null>(null);
const tableName = ref("");
const queryResults = ref<any[] | null>(null);
const totalRows = ref<number | bigint>(0);
const currentPage = ref(1);
const pageSize = ref(props.rowsPerPage);
const viewerId = `csv_viewer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const csvOptions = ref({
  header: true,
  delimiter: ",",
});

const isConnected = computed(() => {
  return duckDBStore.isReady && connectionId.value && !isLoading.value && !error.value;
});

const totalRowsDisplay = computed(() => {
  return typeof totalRows.value === "bigint"
    ? Number(totalRows.value)
    : totalRows.value;
});

const tableColumns = computed(() => {
  if (!queryResults.value || !Array.isArray(queryResults.value) || queryResults.value.length === 0) {
    return [];
  }
  return Object.keys(queryResults.value[0] || {});
});

const paginatedResults = computed(() => {
  if (!queryResults.value || !Array.isArray(queryResults.value)) {
    return [];
  }
  return queryResults.value;
});

const initialize = async () => {
  try {
    isLoading.value = true;
    error.value = "";

    if (!duckDBStore.isReady) {
      await duckDBStore.initDuckDB();
    }

    const { connectionId: connId } = await duckDBStore.createConnection(viewerId);
    connectionId.value = connId;

    if (props.autoLoad && props.url) {
      await loadCSVFile();
    } else {
      isLoading.value = false;
    }
  } catch (err: any) {
    error.value = `Failed to initialize: ${err.message}`;
    isLoading.value = false;
  }
};

const loadCSVFile = async () => {
  if (!props.url) {
    error.value = "No URL provided";
    isLoading.value = false;
    return;
  }

  try {
    const stableKey = props.fileId || props.url;
    const existingFile = duckDBStore.getLoadedFile(stableKey);
    if (existingFile && !existingFile.isLoading && !existingFile.error) {
      tableName.value = existingFile.tableName;
      await getTotalRowCount();
      await loadPage(1);
      isLoading.value = false;
      return;
    }

    const tableId = props.fileId ? `file_${props.fileId}` : `csv_data_${Date.now()}`;

    tableName.value = await duckDBStore.loadFile(
      props.url,
      props.fileType as "csv" | "parquet",
      tableId,
      csvOptions.value,
      viewerId,
      props.fileId
    );

    await getTotalRowCount();
    await loadPage(1);
  } catch (err: any) {
    error.value = `Failed to load file: ${err.message}`;
  } finally {
    isLoading.value = false;
  }
};

const getTotalRowCount = async () => {
  try {
    const countQuery = `SELECT COUNT(*) as total_count FROM ${tableName.value}`;
    const result = await duckDBStore.executeQuery(countQuery, connectionId.value!);
    const count = result[0]?.total_count || 0;
    totalRows.value = typeof count === "bigint" ? Number(count) : count;
  } catch (err: any) {
    totalRows.value = 0;
    throw err;
  }
};

const loadPage = async (page: number) => {
  if (!tableName.value || !connectionId.value) return;

  try {
    const offset = (page - 1) * pageSize.value;
    const query = `SELECT * FROM ${tableName.value} LIMIT ${pageSize.value} OFFSET ${offset}`;
    queryResults.value = await duckDBStore.executeQuery(query, connectionId.value);
    currentPage.value = page;
  } catch (err: any) {
    error.value = `Failed to load page: ${err.message}`;
    throw err;
  }
};

const handlePageChange = async (page: number) => {
  await loadPage(page);
};

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

const retryLoad = async () => {
  error.value = "";
  isLoading.value = true;
  await loadCSVFile();
};

watch(
  () => props.url,
  async (newUrl) => {
    if (newUrl && connectionId.value) {
      isLoading.value = true;
      error.value = "";
      currentPage.value = 1;
      await loadCSVFile();
    }
  }
);

onMounted(async () => {
  await initialize();
});

onUnmounted(async () => {
  if (connectionId.value) {
    await duckDBStore.closeConnection(connectionId.value);
  }
});
</script>

<style scoped lang="scss">
@use "../styles/theme" as theme;

.csv-viewer-container {
  max-width: 100%;
  margin: 0 auto;
}

.csv-viewer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px;
  color: theme.$gray_4;

  p {
    margin-top: 16px;
    font-size: 14px;
  }
}

.csv-viewer-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid theme.$gray_2;
  border-top: 3px solid theme.$purple_3;
  border-radius: 50%;
  animation: csv-viewer-spin 0.8s linear infinite;
}

@keyframes csv-viewer-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.csv-viewer-error {
  background: theme.$red_tint;
  border: 1px solid theme.$red_1;
  padding: 20px;
  margin: 20px 0;

  h3 {
    color: theme.$red_2;
    margin-top: 0;
  }

  p {
    color: theme.$red_2;
    margin: 10px 0;
  }
}

.csv-viewer-retry-btn {
  background: theme.$red_1;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;

  &:hover {
    background: theme.$red_2;
  }
}

.csv-viewer-data {
  background: white;
  border: 1px solid theme.$gray_2;
  overflow: hidden;
}

.csv-viewer-info-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: theme.$purple_tint;
}

.csv-viewer-row-count {
  font-weight: 500;
  font-size: 13px;
  color: theme.$gray_5;
}

.csv-viewer-info-controls {
  display: flex;
  align-items: center;
}

.csv-viewer-table-container {
  overflow-x: auto;
  max-height: 600px;
}

.csv-viewer-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th,
  td {
    border: 1px solid theme.$gray_2;
    padding: 8px 10px;
    text-align: left;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    border-left: 0;
  }

  th:last-child,
  td:last-child {
    border-right: 0;
  }

  th {
    background: theme.$gray_1;
    font-weight: 600;
    color: theme.$gray_6;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  tbody tr:hover {
    background: theme.$gray_0;
  }

  tbody tr:nth-child(even) {
    background: #fafafa;
  }
}
</style>

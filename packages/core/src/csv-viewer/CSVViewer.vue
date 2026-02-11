<!-- CSVViewer.vue - Simple CSV/Tabular data viewer with DuckDB-powered pagination -->
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
    <div v-else-if="isConnected && queryResults" class="csv-viewer-data">
      <!-- Info Bar -->
      <div class="ps-info-bar">
        <span class="ps-info-bar-label">
          {{ paginatedResults.length }} of {{ totalRowsDisplay }} rows
        </span>
        <div class="ps-info-bar-controls">
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
      <div class="ps-table-container">
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useDuckDBStore } from "../duckdb";
import { useViewerStyle, type ViewerStyleOverrides } from "../composables/useViewerStyle";

const props = defineProps<{
  url: string
  fileType?: string
  rowsPerPage?: number
  autoLoad?: boolean
  fileId?: string | null
  customStyle?: ViewerStyleOverrides
}>();

const { rootStyle } = useViewerStyle(() => props.customStyle);

const duckDBStore = useDuckDBStore();

const isLoading = ref(false);
const error = ref("");
const connectionId = ref<string | null>(null);
const tableName = ref("");
const queryResults = ref<any[] | null>(null);
const totalRows = ref<number | bigint>(0);
const currentPage = ref(1);
const pageSize = ref(props.rowsPerPage ?? 25);
const viewerId = `csv_viewer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const fileType = computed(() => props.fileType ?? "csv");

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

    if ((props.autoLoad ?? true) && props.url) {
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
      fileType.value as "csv" | "parquet",
      tableId,
      csvOptions.value,
      viewerId,
      props.fileId ?? null
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

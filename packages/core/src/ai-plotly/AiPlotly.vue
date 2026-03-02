<script setup>
import { ref, onMounted, watch } from "vue";
import { ElMessage } from "element-plus";
import Plotly from "plotly.js-dist";
import { GeneralDataManager } from "./generalizedDataManager";

// Props
const props = defineProps({
  claudeApiKey: {
    type: String,
    required: false,
    default: "",
  },
});

// Emits
const emit = defineEmits(["save-config", "plot-generated"]);

// Reactive state
const dataUrl = ref(
  "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2"
);
const userPrompt = ref("");
const dataLoaded = ref(false);
const loading = ref(false);
const plotlyDiv = ref(null);
const currentSchema = ref([]);
const currentPlotConfig = ref(null);
const dataManager = ref(null);
const isDataManagerReady = ref(false);
const catalogInfo = ref(null);
const conversationHistory = ref([]);
const lastExecutedSQL = ref("");
const cachedQueryResult = ref(null);

// Initialize data manager
async function initializeDataManager() {
  try {
    const manager = new GeneralDataManager();
    await manager.initialize();
    dataManager.value = manager;
    isDataManagerReady.value = true;
  } catch (error) {
    console.error("Failed to initialize data manager:", error);
    ElMessage.error("Failed to initialize data manager");
    isDataManagerReady.value = false;
  }
}

async function loadData() {
  if (!dataUrl.value) {
    ElMessage.warning("Please provide a data URL");
    return;
  }

  if (!isDataManagerReady.value) {
    await initializeDataManager();
  }

  if (!dataManager.value) {
    ElMessage.error("Data manager not available");
    return;
  }

  loading.value = true;
  try {
    // Check if single file or folder
    if (dataUrl.value.endsWith(".parquet")) {
      // SINGLE FILE MODE
      console.log("Single file mode");
      const schemaSql = `SELECT * FROM parquet_scan('${dataUrl.value}') LIMIT 10`;
      const sample = await dataManager.value.executeQuery(schemaSql);

      if (sample && sample.length > 0) {
        currentSchema.value = Object.keys(sample[0]);
        dataLoaded.value = true;
        ElMessage.success("Data loaded successfully");
      } else {
        ElMessage.error("No data found");
      }
    } else {
      // FOLDER MODE - look for manifest
      // console.log("Folder mode - looking for manifest.json");
      // const manifestUrl = `${dataUrl.value}/manifest.json`;
      // const manifestResponse = await fetch(manifestUrl);

      // if (!manifestResponse.ok) {
      //   throw new Error(
      //     `No manifest.json found. Please provide either:\n` +
      //       `1. A direct .parquet file URL, or\n` +
      //       `2. A folder URL with manifest.json`
      //   );
      // }

      // const manifest = await manifestResponse.json();
      const manifest = {
        files: [
          "umap.parquet",
          "tsne.parquet",
          "gene_locations.parquet",
          "gene_stats.parquet",
          "cells.parquet",
          "genes.parquet",
          "metadata.parquet",
        ],
      };
      if (!manifest.files || manifest.files.length === 0) {
        throw new Error("manifest.json is empty or has no files listed");
      }

      // Catalog all files from manifest
      const catalog = await dataManager.value.catalogFolder(
        dataUrl.value,
        manifest.files
      );
      catalogInfo.value = catalog;
      // Show all columns across all files
      const allColumns = new Set();
      catalog.files.forEach((file) => {
        file.columns.forEach((col) => allColumns.add(col.name));
      });
      currentSchema.value = Array.from(allColumns);

      dataLoaded.value = true;
      ElMessage.success(
        `Cataloged ${catalog.files.length} files from manifest`
      );
    }
  } catch (error) {
    console.error("Error loading data:", error);
    ElMessage.error(`Failed to load data: ${error.message}`);
    dataLoaded.value = false;
  } finally {
    loading.value = false;
  }
}

function generateSystemPrompt(schema, currentConfig = null) {
  let catalogDescription = "";

  if (catalogInfo.value && dataManager.value.catalog) {
    catalogDescription = `
DATA CATALOG:
${dataManager.value.getCatalogDescription()}

IMPORTANT: When generating queries:
1. Analyze which file(s) contain the needed columns
2. Use the full file URL from the catalog in parquet_scan()
3. You can JOIN multiple files if needed using common keys like cell_id
4. Always include LIMIT clause (max 50000)
`;
  }

  const basePrompt = `You are a data visualization assistant that helps users iteratively build and refine plots.

${catalogDescription}

Available columns: ${schema.join(", ")}

${
  currentConfig
    ? `
CURRENT PLOT STATE:
- Plot type: ${currentConfig.config?.plotType || "none"}
- Columns used: x=${currentConfig.mappedColumns?.xColumn}, y=${
        currentConfig.mappedColumns?.yColumn
      }
- Current SQL: ${lastExecutedSQL.value}
`
    : ""
}

You must determine if the user's request requires:
A) DATA CHANGE - New SQL query needed (different columns, filtering, aggregation)
B) VISUAL CHANGE - Only Plotly config updates (colors, sizes, hover, titles, legend)

CRITICAL Security Rules:
1. MUST include a LIMIT clause in every query (maximum 50000, recommended 1000-10000)
2. Only use SELECT statements
3. Only reference columns that exist in the schema
4. Only use parquet_scan() with the full URLs from the catalog
5. Keep queries simple - maximum 2 levels of subqueries

For DATA CHANGES, return JSON:
{
  "changeType": "data",
  "sql": "SELECT ... LIMIT 1000",
  "plotType": "scatter|bar|line|pie|histogram|box|violin",
  "xAxis": "column_name",
  "yAxis": "column_name",
  "title": "Plot Title",
  "description": "Brief description",
  "groupBy": "optional_grouping_column_for_violin"
}

For VISUAL CHANGES, return JSON:
{
  "changeType": "visual",
  "updates": {
    "marker.size": 12,
    "marker.color": "blue",
    "marker.opacity": 0.8,
    "hovertemplate": "Custom: %{x}<br>Value: %{y}",
    "layout.title.text": "New Title",
    "layout.xaxis.title.text": "X Label",
    "layout.yaxis.title.text": "Y Label",
    "layout.showlegend": true
  },
  "description": "What changed"
}

PLOTLY CONFIG REFERENCE for visual changes:
- marker.size: number (point size)
- marker.color: string or array (color name, hex, or RGB)
- marker.opacity: number 0-1 (transparency)
- marker.line.width: number (point border width)
- marker.line.color: string (point border color)
- hovertemplate: string (custom hover text, use %{x}, %{y}, %{text})
- layout.title.text: string (main title)
- layout.xaxis.title.text: string (x-axis label)
- layout.yaxis.title.text: string (y-axis label)
- layout.showlegend: boolean
- line.width: number (for line plots)
- line.color: string (for line plots)
- fillcolor: string (for violin/box plots)

Plot Type Guide:
- scatter: Compare two continuous variables with points
- line: Show trends over time or ordered data
- bar: Compare values across categories
- pie: Show proportions of a whole
- histogram: Show distribution of a single variable
- box: Show distribution summary (quartiles, outliers)
- violin: Show full distribution shape, ideal for comparing distributions across groups

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation outside the JSON.`;

  return basePrompt;
}

async function generateQuery() {
  if (!userPrompt.value.trim()) {
    ElMessage.warning("Please enter a description for your plot");
    return;
  }

  loading.value = true;
  try {
    // Ensure schema is loaded
    if (currentSchema.value.length === 0) {
      await loadData();
    }

    const apiKey = props.claudeApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      ElMessage.error("API key not configured");
      return;
    }

    // Build conversation history for context
    const messages = [
      ...conversationHistory.value,
      {
        role: "user",
        content: userPrompt.value,
      },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: generateSystemPrompt(
          currentSchema.value,
          currentPlotConfig.value
        ),
        messages: messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const claudeOutput = JSON.parse(data.content[0].text);

    // Add to conversation history
    conversationHistory.value.push(
      { role: "user", content: userPrompt.value },
      { role: "assistant", content: data.content[0].text }
    );

    // Handle based on change type
    if (claudeOutput.changeType === "data") {
      // Validate and execute new query
      const validation = await dataManager.value.isValidQuery(claudeOutput.sql);
      if (!validation.valid) {
        ElMessage.error({
          message: `Security validation failed: ${validation.error}`,
          duration: 5000,
          showClose: true,
        });
        console.error("Query validation failed:", validation.error);
        console.error("Generated SQL:", claudeOutput.sql);
        return;
      }

      if (!dataManager.value) {
        ElMessage.error("Data manager not available");
        return;
      }

      const result = await dataManager.value.executeQuery(claudeOutput.sql);
      lastExecutedSQL.value = claudeOutput.sql;
      cachedQueryResult.value = result;

      generatePlotlyConfig(result, claudeOutput);

      emit("plot-generated", { config: claudeOutput, data: result });
    } else if (claudeOutput.changeType === "visual") {
      // Apply visual updates to existing plot
      if (!currentPlotConfig.value) {
        ElMessage.warning("No plot to update. Please create a plot first.");
        return;
      }

      applyVisualUpdates(claudeOutput.updates, claudeOutput.description);
    } else {
      ElMessage.error("Unknown change type from AI");
    }

    // Clear prompt for next iteration
    userPrompt.value = "";
  } catch (error) {
    console.error("Error generating plot:", error);
    ElMessage.error(`Failed to generate plot: ${error.message}`);
  } finally {
    loading.value = false;
  }
}

// Helper function to find matching column in actual data
function findMatchingColumn(actualColumns, targetColumn) {
  if (!targetColumn) return null;

  // Direct match (case-insensitive)
  const directMatch = actualColumns.find(
    (col) => col.toLowerCase() === targetColumn.toLowerCase()
  );
  if (directMatch) return directMatch;

  // Handle common aggregation patterns
  // e.g., "sales" might map to "avg(sales)", "sum(sales)", "count_sales", etc.
  const normalized = targetColumn.toLowerCase().replace(/[_\s]/g, "");

  for (const col of actualColumns) {
    const normalizedCol = col.toLowerCase().replace(/[_\s\(\)\*]/g, "");

    // Check if the column contains the target name
    if (
      normalizedCol.includes(normalized) ||
      normalized.includes(normalizedCol)
    ) {
      return col;
    }

    // Check for common aggregation patterns
    const aggPatterns = [
      `count${normalized}`,
      `avg${normalized}`,
      `sum${normalized}`,
      `min${normalized}`,
      `max${normalized}`,
      `${normalized}count`,
      `${normalized}avg`,
      `${normalized}sum`,
    ];

    if (aggPatterns.some((pattern) => normalizedCol === pattern)) {
      return col;
    }
  }

  return null;
}

// Helper function to determine if a column contains numeric data
function isNumericColumn(data, columnName) {
  if (!data || data.length === 0) return false;

  // Sample first few non-null values
  const samples = data
    .slice(0, 10)
    .map((row) => row[columnName])
    .filter((val) => val != null);

  if (samples.length === 0) return false;

  return samples.every((val) => typeof val === "number" || !isNaN(Number(val)));
}

// Smart column mapping based on actual query results
function mapColumns(data, config) {
  const actualColumns = Object.keys(data[0]);

  console.log("Actual columns from query:", actualColumns);
  console.log("Config columns:", { xAxis: config.xAxis, yAxis: config.yAxis });

  let xColumn = null;
  let yColumn = null;

  // Try to find matching columns
  if (config.xAxis) {
    xColumn = findMatchingColumn(actualColumns, config.xAxis);
  }
  if (config.yAxis) {
    yColumn = findMatchingColumn(actualColumns, config.yAxis);
  }

  // Fallback strategy if no matches found
  if (!xColumn && actualColumns.length > 0) {
    // Use first column as x-axis
    xColumn = actualColumns[0];
  }

  if (!yColumn && actualColumns.length > 1) {
    // Try to find first numeric column for y-axis
    const numericCol = actualColumns
      .slice(1)
      .find((col) => isNumericColumn(data, col));
    yColumn = numericCol || actualColumns[1];
  } else if (!yColumn && actualColumns.length === 1) {
    // Single column case (for histogram, box plot)
    yColumn = actualColumns[0];
  }

  // For single-column plots like histogram or box, ensure we have a numeric column
  const plotType = config.plotType?.toLowerCase();
  if ((plotType === "histogram" || plotType === "box") && !xColumn) {
    const numericCol = actualColumns.find((col) => isNumericColumn(data, col));
    xColumn = numericCol || actualColumns[0];
  }

  // For violin plots, optimize column selection
  if (plotType === "violin") {
    // Violin plots need: yColumn = numeric values, xColumn = categorical groups
    if (!yColumn || !isNumericColumn(data, yColumn)) {
      // Find a numeric column for y-axis
      const numericCol = actualColumns.find((col) =>
        isNumericColumn(data, col)
      );
      if (numericCol) {
        yColumn = numericCol;
        // Set xColumn to a non-numeric column for grouping
        const categoricalCol = actualColumns.find(
          (col) => col !== numericCol && !isNumericColumn(data, col)
        );
        if (categoricalCol) {
          xColumn = categoricalCol;
        }
      }
    }
  }

  console.log("Mapped columns:", { xColumn, yColumn });

  return { xColumn, yColumn, actualColumns };
}

// Create Plotly visualization
function generatePlotlyConfig(data, config) {
  if (!plotlyDiv.value || !data || data.length === 0) {
    ElMessage.error("No data to plot");
    return;
  }

  try {
    // Inspect actual columns and map to config
    const { xColumn, yColumn, actualColumns } = mapColumns(data, config);

    if (!xColumn && !yColumn) {
      ElMessage.error("Could not determine columns to plot");
      return;
    }

    const traces = [];
    const plotType = config.plotType?.toLowerCase() || "scatter";

    switch (plotType) {
      case "scatter":
        if (!xColumn || !yColumn) {
          ElMessage.error("Scatter plot requires both x and y columns");
          return;
        }
        traces.push({
          x: data.map((row) => row[xColumn]),
          y: data.map((row) => row[yColumn]),
          mode: "markers",
          type: "scatter",
          marker: { size: 8, opacity: 0.7 },
          text: data.map(
            (row) =>
              `${xColumn}: ${row[xColumn]}<br>${yColumn}: ${row[yColumn]}`
          ),
          hovertemplate: "%{text}<extra></extra>",
        });
        break;

      case "line":
        if (!xColumn || !yColumn) {
          ElMessage.error("Line plot requires both x and y columns");
          return;
        }
        traces.push({
          x: data.map((row) => row[xColumn]),
          y: data.map((row) => row[yColumn]),
          mode: "lines+markers",
          type: "scatter",
          text: data.map(
            (row) =>
              `${xColumn}: ${row[xColumn]}<br>${yColumn}: ${row[yColumn]}`
          ),
          hovertemplate: "%{text}<extra></extra>",
        });
        break;

      case "bar":
        if (!xColumn || !yColumn) {
          ElMessage.error("Bar chart requires both x and y columns");
          return;
        }
        traces.push({
          x: data.map((row) => row[xColumn]),
          y: data.map((row) => row[yColumn]),
          type: "bar",
          text: data.map((row) => row[yColumn]),
          textposition: "auto",
          hovertemplate: `${xColumn}: %{x}<br>${yColumn}: %{y}<extra></extra>`,
        });
        break;

      case "pie":
        if (!xColumn || !yColumn) {
          ElMessage.error("Pie chart requires both label and value columns");
          return;
        }
        traces.push({
          labels: data.map((row) => row[xColumn]),
          values: data.map((row) => row[yColumn]),
          type: "pie",
          textinfo: "label+percent",
          hovertemplate: "%{label}<br>%{value}<br>%{percent}<extra></extra>",
        });
        break;

      case "histogram":
        const histColumn = xColumn || yColumn;
        if (!histColumn) {
          ElMessage.error("Histogram requires at least one column");
          return;
        }
        traces.push({
          x: data.map((row) => row[histColumn]),
          type: "histogram",
          name: histColumn,
          hovertemplate: "Range: %{x}<br>Count: %{y}<extra></extra>",
        });
        break;

      case "box":
        const boxColumn = yColumn || xColumn;
        if (!boxColumn) {
          ElMessage.error("Box plot requires at least one column");
          return;
        }
        traces.push({
          y: data.map((row) => row[boxColumn]),
          type: "box",
          name: boxColumn,
          boxmean: "sd",
          hovertemplate: "%{y}<extra></extra>",
        });
        break;

      case "violin":
        // Violin plots require:
        // - yColumn: numeric values to plot (e.g., expression levels)
        // - xColumn (optional): categorical grouping variable (e.g., cell_type, gene)
        // If no grouping, create a single violin

        const violinValueColumn = yColumn || xColumn;
        if (!violinValueColumn) {
          ElMessage.error("Violin plot requires at least one numeric column");
          return;
        }

        // Check if we have a grouping column
        const violinGroupColumn = config.groupBy
          ? findMatchingColumn(actualColumns, config.groupBy)
          : xColumn !== violinValueColumn
          ? xColumn
          : null;

        if (violinGroupColumn) {
          // Grouped violin plot - create one violin per group
          const groups = [
            ...new Set(data.map((row) => row[violinGroupColumn])),
          ];

          groups.forEach((group) => {
            const groupData = data.filter(
              (row) => row[violinGroupColumn] === group
            );
            traces.push({
              y: groupData.map((row) => row[violinValueColumn]),
              type: "violin",
              name: String(group),
              box: { visible: true },
              meanline: { visible: true },
              points: "outliers",
              hovertemplate:
                `${violinGroupColumn}: ${group}<br>` +
                `${violinValueColumn}: %{y}<extra></extra>`,
              scalemode: "width",
              width: 0.5,
            });
          });
        } else {
          // Single violin plot
          traces.push({
            y: data.map((row) => row[violinValueColumn]),
            type: "violin",
            name: violinValueColumn,
            box: { visible: true },
            meanline: { visible: true },
            points: "outliers",
            hovertemplate: `${violinValueColumn}: %{y}<extra></extra>`,
            fillcolor: "#8dd3c7",
            opacity: 0.6,
            x0: violinValueColumn,
          });
        }
        break;

      default:
        // Default to scatter if unknown type
        if (!xColumn || !yColumn) {
          ElMessage.error("Unknown plot type or insufficient columns");
          return;
        }
        traces.push({
          x: data.map((row) => row[xColumn]),
          y: data.map((row) => row[yColumn]),
          type: "scatter",
          mode: "markers",
          marker: { size: 8, opacity: 0.7 },
        });
    }

    // Create human-readable axis titles
    const formatColumnName = (col) => {
      if (!col) return "";
      // Convert snake_case or camelCase to Title Case
      return col
        .replace(/([A-Z])/g, " $1")
        .replace(/[_\-]/g, " ")
        .split(" ")
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(" ")
        .trim();
    };

    const layout = {
      title: config.title || "Generated Plot",
      xaxis: {
        title: formatColumnName(xColumn) || "",
        automargin: true,
      },
      yaxis: {
        title: formatColumnName(yColumn) || "",
        automargin: true,
      },
      hovermode: "closest",
      showlegend: traces.length > 1,
      margin: { l: 60, r: 30, t: 60, b: 60 },
    };

    // Special handling for pie charts
    if (plotType === "pie") {
      layout.xaxis = undefined;
      layout.yaxis = undefined;
    }

    // Special handling for violin plots
    if (plotType === "violin") {
      layout.violinmode = "group";
      layout.violingap = 0.3;
      layout.violingroupgap = 0.3;
      layout.yaxis.zeroline = false;
      layout.showlegend = traces.length > 1;

      // If we have categorical x-axis, format it properly
      const violinGroupColumn = config.groupBy
        ? findMatchingColumn(actualColumns, config.groupBy)
        : xColumn !== (yColumn || xColumn)
        ? xColumn
        : null;

      if (violinGroupColumn) {
        layout.xaxis.title = formatColumnName(violinGroupColumn);
        layout.xaxis.type = "category";
      } else {
        layout.xaxis.showticklabels = false;
      }
    }

    Plotly.newPlot(plotlyDiv.value, traces, layout, {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    });

    currentPlotConfig.value = {
      traces,
      layout,
      config,
      mappedColumns: { xColumn, yColumn, actualColumns },
    };
    ElMessage.success(
      `Plot generated successfully using columns: ${xColumn}${
        yColumn ? ", " + yColumn : ""
      }`
    );
  } catch (error) {
    console.error("Error creating plot:", error);
    ElMessage.error(`Failed to create plot: ${error.message}`);
  }
}
// Apply visual updates to existing plot
function applyVisualUpdates(updates, description) {
  if (!plotlyDiv.value || !currentPlotConfig.value) {
    ElMessage.error("No plot to update");
    return;
  }

  try {
    // Deep clone current config
    const updatedTraces = JSON.parse(
      JSON.stringify(currentPlotConfig.value.traces)
    );
    const updatedLayout = JSON.parse(
      JSON.stringify(currentPlotConfig.value.layout)
    );

    // Apply updates using dot notation paths
    Object.entries(updates).forEach(([path, value]) => {
      if (path.startsWith("layout.")) {
        // Layout update
        const layoutPath = path.substring(7); // Remove 'layout.'
        setNestedValue(updatedLayout, layoutPath, value);
      } else {
        // Trace update - apply to all traces
        updatedTraces.forEach((trace) => {
          setNestedValue(trace, path, value);
        });
      }
    });

    // Use Plotly.react for efficient updates
    Plotly.react(plotlyDiv.value, updatedTraces, updatedLayout, {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ["lasso2d", "select2d"],
    });

    // Update stored config
    currentPlotConfig.value.traces = updatedTraces;
    currentPlotConfig.value.layout = updatedLayout;

    ElMessage.success(description || "Plot updated successfully");
  } catch (error) {
    console.error("Error applying visual updates:", error);
    ElMessage.error(`Failed to update plot: ${error.message}`);
  }
}

// Helper to set nested object values using dot notation
function setNestedValue(obj, path, value) {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}
// Generate plot handler
async function generatePlot() {
  await generateQuery();
}

// Save configuration
function saveConfig() {
  if (!currentPlotConfig.value) {
    ElMessage.warning("No plot to save");
    return;
  }

  const config = {
    id: `plot_${Date.now()}`,
    name: conversationHistory.value[0]?.content.slice(0, 50) || "Saved Plot",
    dataUrl: dataUrl.value,
    sql: lastExecutedSQL.value,
    plotConfig: currentPlotConfig.value.config,
    plotlyTraces: currentPlotConfig.value.traces,
    plotlyLayout: currentPlotConfig.value.layout,
    conversationHistory: conversationHistory.value,
    timestamp: new Date().toISOString(),
  };

  emit("save-config", config);
  ElMessage.success("Configuration saved");
}
// Load a saved configuration
async function loadSavedConfig(savedConfig) {
  try {
    loading.value = true;

    // Restore data URL
    dataUrl.value = savedConfig.dataUrl;

    // Re-execute SQL to get fresh data
    if (savedConfig.sql) {
      await loadData(); // Ensure schema is loaded

      const freshData = await dataManager.value.executeQuery(savedConfig.sql);
      cachedQueryResult.value = freshData;
      lastExecutedSQL.value = savedConfig.sql;

      // Restore plot with saved config
      if (savedConfig.plotlyTraces && savedConfig.plotlyLayout) {
        Plotly.newPlot(
          plotlyDiv.value,
          savedConfig.plotlyTraces,
          savedConfig.plotlyLayout,
          {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
          }
        );

        currentPlotConfig.value = {
          traces: savedConfig.plotlyTraces,
          layout: savedConfig.plotlyLayout,
          config: savedConfig.plotConfig,
        };
      }

      // Restore conversation history for further edits
      conversationHistory.value = savedConfig.conversationHistory || [];

      ElMessage.success("Configuration loaded successfully");
    }
  } catch (error) {
    console.error("Error loading saved config:", error);
    ElMessage.error(`Failed to load configuration: ${error.message}`);
  } finally {
    loading.value = false;
  }
}

// Expose this function so parent can call it
defineExpose({ loadSavedConfig });
// Clear plot
function clearPlot() {
  if (plotlyDiv.value) {
    Plotly.purge(plotlyDiv.value);
  }
  currentPlotConfig.value = null;
  conversationHistory.value = [];
  lastExecutedSQL.value = "";
  cachedQueryResult.value = null;
  userPrompt.value = "";
  ElMessage.info("Plot cleared");
}

// Initialize on mount
onMounted(async () => {
  await initializeDataManager();
  if (dataUrl.value) {
    loadData();
  }
});
</script>
<template>
  <div class="ai-plot-widget">
    <!-- Header section -->
    <div class="widget-header">
      <h3 class="widget-title">AI-Driven Plotly Widget</h3>
      <span v-if="dataLoaded" class="status-badge success">Data Loaded</span>
      <span v-else class="status-badge">No Data</span>
    </div>

    <!-- Data source input section -->
    <div class="input-section">
      <label class="input-label">Data Source URL</label>
      <div class="input-group">
        <el-input
          v-model="dataUrl"
          placeholder="Enter S3 Parquet URL or data source..."
          :disabled="loading"
          class="data-input"
          @blur="loadData"
        >
          <template #prefix>
            <i class="el-icon-link"></i>
          </template>
        </el-input>
        <el-button
          :loading="loading"
          :disabled="!dataUrl"
          type="primary"
          @click="loadData"
        >
          Load Data
        </el-button>
      </div>
    </div>

    <!-- Schema preview -->
    <div v-if="currentSchema.length > 0" class="schema-section">
      <label class="input-label">Available Columns</label>
      <div class="schema-tags">
        <el-tag
          v-for="column in currentSchema"
          :key="column"
          size="small"
          class="schema-tag"
        >
          {{ column }}
        </el-tag>
      </div>
    </div>
    <!-- Catalog info (folder mode only) -->
    <div v-if="catalogInfo && catalogInfo.files" class="catalog-section">
      <label class="input-label"
        >Data Catalog ({{ catalogInfo.files.length }} files)</label
      >
      <el-collapse accordion>
        <el-collapse-item
          v-for="file in catalogInfo.files"
          :key="file.name"
          :title="`${file.name} (${file.columns.length} columns)`"
        >
          <div class="file-columns">
            <el-tag
              v-for="col in file.columns"
              :key="col.name"
              size="small"
              type="info"
            >
              {{ col.name }}: {{ col.type }}
            </el-tag>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
    <!-- AI prompt input (only shows after data loaded) -->
    <div v-if="dataLoaded" class="prompt-section">
      <label class="input-label">Describe Your Visualization</label>
      <el-input
        v-model="userPrompt"
        type="textarea"
        :rows="3"
        :maxlength="280"
        show-word-limit
        placeholder="E.g., 'Show me a bar chart of sales by region' or 'Create a scatter plot of price vs quantity'"
        :disabled="loading"
        @keyup.enter.ctrl="generatePlot"
      />
      <div class="prompt-actions">
        <el-button
          :loading="loading"
          :disabled="!userPrompt.trim()"
          type="primary"
          @click="generatePlot"
        >
          Generate Plot
        </el-button>
        <span class="hint-text">Press Ctrl+Enter to generate</span>
      </div>
    </div>
    <!-- Conversation history (optional - shows previous prompts) -->
    <div v-if="conversationHistory.length > 0" class="history-section">
      <label class="input-label">Conversation History</label>
      <div class="history-list">
        <div
          v-for="(msg, idx) in conversationHistory.filter(
            (m) => m.role === 'user'
          )"
          :key="idx"
          class="history-item"
        >
          <i class="el-icon-chat-dot-round"></i>
          <span>{{ msg.content }}</span>
        </div>
      </div>
    </div>

    <!-- Loading indicator -->
    <div v-if="loading" class="loading-overlay">
      <el-icon class="loading-icon">
        <i class="el-icon-loading"></i>
      </el-icon>
      <p class="loading-text">
        {{ dataLoaded ? "Generating visualization..." : "Loading data..." }}
      </p>
    </div>

    <!-- Plotly container -->
    <div class="plot-section">
      <div ref="plotlyDiv" class="plot-container"></div>
      <div v-if="!currentPlotConfig && dataLoaded" class="plot-placeholder">
        <i class="el-icon-data-analysis"></i>
        <p>Enter a prompt above to generate your visualization</p>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="currentPlotConfig" class="action-section">
      <el-button @click="saveConfig" type="success">
        <i class="el-icon-document"></i>
        Save Configuration
      </el-button>
      <el-button @click="clearPlot" type="default">
        <i class="el-icon-delete"></i>
        Clear Plot
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.catalog-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: #fff9e6;
  border-radius: 6px;
  border-left: 3px solid #f39c12;
}

.file-columns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem;
}
/* Conversation History Section */
.history-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: #f0f7ff;
  border-radius: 6px;
  border-left: 3px solid #409eff;
  max-height: 200px;
  overflow-y: auto;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: white;
  border-radius: 4px;
  font-size: 0.875rem;
  color: #666;
}

.history-item i {
  color: #409eff;
  flex-shrink: 0;
}
.ai-plot-widget {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  max-width: 100%;
  min-height: 600px;
}

/* Header Section */
.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 1rem;
  border-bottom: 2px solid #f0f0f0;
}

.widget-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: #2c3e50;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  background: #e0e0e0;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-badge.success {
  background: #e8f5e9;
  color: #2e7d32;
}

/* Input Section */
.input-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.input-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #555;
  margin-bottom: 0.25rem;
}

.input-group {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.data-input {
  flex: 1;
}

/* Schema Section */
.schema-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 3px solid #409eff;
}

.schema-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.schema-tag {
  font-family: "Monaco", "Courier New", monospace;
  font-size: 0.75rem;
}

/* Prompt Section */
.prompt-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.prompt-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.hint-text {
  font-size: 0.75rem;
  color: #999;
  font-style: italic;
}

/* Loading Overlay */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 6px;
  border: 2px dashed #409eff;
}

.loading-icon {
  font-size: 2.5rem;
  color: #409eff;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  margin-top: 1rem;
  font-size: 0.875rem;
  color: #666;
  font-weight: 500;
}

/* Plot Section */
.plot-section {
  position: relative;
  min-height: 400px;
  background: #fafafa;
  border-radius: 6px;
  padding: 1rem;
  border: 1px solid #e0e0e0;
}

.plot-container {
  width: 100%;
  min-height: 400px;
}

.plot-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  color: #999;
  text-align: center;
}

.plot-placeholder i {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.plot-placeholder p {
  font-size: 1rem;
  margin: 0;
}

/* Action Section */
.action-section {
  display: flex;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid #f0f0f0;
}

/* Responsive Design */
@media (max-width: 768px) {
  .ai-plot-widget {
    padding: 1rem;
    gap: 1rem;
  }

  .widget-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .input-group {
    flex-direction: column;
  }

  .data-input {
    width: 100%;
  }

  .plot-section {
    min-height: 300px;
  }

  .plot-container {
    min-height: 300px;
  }

  .action-section {
    flex-direction: column;
  }

  .action-section .el-button {
    width: 100%;
  }
}

/* Dark mode support (optional) */
@media (prefers-color-scheme: dark) {
  .ai-plot-widget {
    background: #1e1e1e;
    color: #e0e0e0;
  }

  .widget-title {
    color: #e0e0e0;
  }

  .input-label {
    color: #b0b0b0;
  }

  .schema-section {
    background: #2a2a2a;
    border-left-color: #409eff;
  }

  .plot-section {
    background: #2a2a2a;
    border-color: #404040;
  }

  .plot-placeholder {
    color: #666;
  }
}

/* Animations */
.input-section,
.schema-section,
.prompt-section,
.plot-section,
.action-section {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

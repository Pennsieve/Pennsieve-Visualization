<template>
  <div class="playground">
    <h1>Pennsieve Visualization Components Playground</h1>

    <!-- Markdown Component -->
    <section class="component-section">
      <h2 class="component-label">Markdown</h2>
      <p class="component-path">@pennsieve-viz/markdown</p>
      <div class="component-container" style="height: 300px;">
        <Markdown
          mode="preview"
          markdownText="# Markdown Preview

This is a **bold** and *italic* text example.

## Features
- Renders markdown to HTML
- Supports code blocks
- XSS safe with DOMPurify

```javascript
const hello = 'world';
```"
        />
      </div>
    </section>

    <!-- TextViewer Component -->
    <section class="component-section">
      <h2 class="component-label">TextViewer</h2>
      <p class="component-path">@pennsieve-viz/text-viewer</p>
      <div class="component-container" style="height: 200px;">
        <TextViewer
          :content="sampleTextContent"
          filename="example.txt"
        />
      </div>
    </section>

    <!-- AiPlotly Component -->
    <section class="component-section">
      <h2 class="component-label">AiPlotly</h2>
      <p class="component-path">@pennsieve-viz/ai-plotly</p>
      <div class="component-container" style="height: 400px;">
        <AiPlotly
          :data="samplePlotlyData"
          :layout="samplePlotlyLayout"
        />
      </div>
    </section>

    <!-- DataExplorer Component -->
    <section class="component-section">
      <h2 class="component-label">DataExplorer</h2>
      <p class="component-path">@pennsieve-viz/data-explorer</p>
      <p class="component-note">Requires: apiUrl, pkg (package info), optional token</p>
      <div class="component-container" style="height: 400px; background: #f5f5f5;">
        <p class="placeholder">DataExplorer - Needs API connection to display tabular data</p>
        <!-- Uncomment when you have valid API data:
        <DataExplorer
          :apiUrl="apiUrl"
          :pkg="samplePackage"
        />
        -->
      </div>
    </section>

    <!-- UMAP Component -->
    <section class="component-section">
      <h2 class="component-label">UMAP</h2>
      <p class="component-path">@pennsieve-viz/umap</p>
      <p class="component-note">Requires: apiUrl, pkg (parquet file), optional token</p>
      <div class="component-container" style="height: 400px; background: #f5f5f5;">
        <p class="placeholder">UMAP - Needs parquet file data for scatter plot visualization</p>
        <!-- Uncomment when you have valid parquet data:
        <UMAP
          :apiUrl="apiUrl"
          :pkg="sampleParquetPackage"
        />
        -->
      </div>
    </section>

    <!-- ProportionPlot Component -->
    <section class="component-section">
      <h2 class="component-label">ProportionPlot</h2>
      <p class="component-path">@pennsieve-viz/proportion-plot</p>
      <p class="component-note">Requires: apiUrl, pkg, xKey, yKey for stacked bar chart</p>
      <div class="component-container" style="height: 400px; background: #f5f5f5;">
        <p class="placeholder">ProportionPlot - Needs data source for proportion visualization</p>
        <!-- Uncomment when you have valid data:
        <ProportionPlot
          :apiUrl="apiUrl"
          :pkg="samplePackage"
          xKey="category"
          yKey="value"
        />
        -->
      </div>
    </section>

    <!-- EditIcon Component -->
    <section class="component-section">
      <h2 class="component-label">EditIcon</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <div class="component-container icon-container">
        <EditIcon />
        <span>Edit Icon (SVG)</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  Markdown,
  TextViewer,
  AiPlotly,
  // DataExplorer,
  // UMAP,
  // ProportionPlot,
  EditIcon
} from './index'

// Sample data for TextViewer
const sampleTextContent = ref(`This is sample text content.
It can display multiple lines.
The TextViewer component handles plain text files.

Line 4
Line 5
Line 6`)

// Sample data for AiPlotly
const samplePlotlyData = ref([
  {
    x: [1, 2, 3, 4, 5],
    y: [10, 15, 13, 17, 22],
    type: 'scatter',
    mode: 'lines+markers',
    name: 'Sample Data',
    marker: { color: 'blue' }
  },
  {
    x: [1, 2, 3, 4, 5],
    y: [12, 9, 15, 12, 18],
    type: 'bar',
    name: 'Bar Data',
    marker: { color: 'orange' }
  }
])

const samplePlotlyLayout = ref({
  title: 'Sample Plotly Chart',
  xaxis: { title: 'X Axis' },
  yaxis: { title: 'Y Axis' }
})

// API configuration (update these for real data)
const apiUrl = ref('https://api.pennsieve.net')

const samplePackage = ref({
  content: {
    id: 'N:package:example-id',
    name: 'example.csv',
    packageType: 'CSV',
    datasetId: 'N:dataset:example-dataset',
    state: 'READY',
    createdAt: new Date().toISOString()
  }
})
</script>

<style lang="scss">
.playground {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;

  h1 {
    text-align: center;
    color: #333;
    margin-bottom: 40px;
    border-bottom: 2px solid #2196F3;
    padding-bottom: 10px;
  }
}

.component-section {
  margin-bottom: 40px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.component-label {
  background: #2196F3;
  color: white;
  margin: 0;
  padding: 12px 20px;
  font-size: 1.2rem;
}

.component-path {
  background: #e3f2fd;
  color: #1565C0;
  margin: 0;
  padding: 8px 20px;
  font-family: monospace;
  font-size: 0.9rem;
}

.component-note {
  background: #fff3e0;
  color: #e65100;
  margin: 0;
  padding: 8px 20px;
  font-size: 0.85rem;
}

.component-container {
  padding: 20px;
  background: white;
  overflow: auto;
}

.icon-container {
  display: flex;
  align-items: center;
  gap: 10px;

  svg {
    width: 24px;
    height: 24px;
  }
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-style: italic;
  background: repeating-linear-gradient(
    45deg,
    #f5f5f5,
    #f5f5f5 10px,
    #eeeeee 10px,
    #eeeeee 20px
  );
  margin: 0;
  border-radius: 4px;
}
</style>

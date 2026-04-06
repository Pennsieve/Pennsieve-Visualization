<template>
  <div class="playground">
    <h1>Pennsieve Visualization Components Playground</h1>

    <!-- Markdown Component -->
    <section class="component-section">
      <h2 class="component-label">Markdown</h2>
      <p class="component-path">@pennsieve-viz/markdown</p>
      <div class="component-container" style="height: 300px">
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
      <div class="component-container" style="height: 200px">
        <TextViewer :content="sampleTextContent" filename="example.txt" />
      </div>
    </section>

    <!-- AiPlotly Component -->
    <!-- <section class="component-section">
      <h2 class="component-label">AiPlotly</h2>
      <p class="component-path">@pennsieve-viz/ai-plotly</p>
      <div class="component-container" style="height: 400px">
        <AiPlotly :data="samplePlotlyData" :layout="samplePlotlyLayout" />
      </div>
    </section> -->

    <!-- CSVViewer Component -->
    <section class="component-section">
      <h2 class="component-label">CSVViewer</h2>
      <p class="component-path">@pennsieve-viz/csv-viewer</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <CSVViewerCore :url="csvBlobUrl" />
      </div>
    </section>

    <!-- DataExplorer Component -->
    <section class="component-section">
      <h2 class="component-label">DataExplorer</h2>
      <p class="component-path">@pennsieve-viz/data-explorer</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <DataExplorer instance-id="playground-explorer" src-url="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2/genes.parquet" />
      </div>
    </section>

    <!-- UMAP Component -->
    <section class="component-section">
      <h2 class="component-label">UMAP</h2>
      <p class="component-path">@pennsieve-viz/umap</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <UMAP instance-id="playground-umap" :src-url="apiUrl" />
      </div>
    </section>

    <!-- ProportionPlot Component -->
    <section class="component-section">
      <h2 class="component-label">ProportionPlot</h2>
      <p class="component-path">@pennsieve-viz/proportion-plot</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <ProportionPlot :src-url="apiUrl" xKey="category" yKey="value" />
      </div>
    </section>

    <!-- TSViewer Component -->
    <section class="component-section">
      <h2 class="component-label">TSViewer</h2>
      <p class="component-path">tsviewer</p>
      <div
        class="component-container bg-tertiary"
        style="height: 500px"
      >
        <TSViewer />
      </div>
    </section>

    <!-- OmeViewer (Micro-CT) Component -->
    <section class="component-section">
      <h2 class="component-label">OmeViewer (Micro-CT)</h2>
      <p class="component-path">@pennsieve-viz/micro-ct</p>
      <div
        class="component-container bg-dark"
        style="height: 600px"
      >
        <OmeViewer :source="omeTiffSource" source-type="ome-tiff" />
      </div>
    </section>

    <!-- TiffViewer Component -->
    <section class="component-section">
      <h2 class="component-label">TiffViewer</h2>
      <p class="component-path">@pennsieve-viz/micro-ct</p>
      <div
        class="component-container bg-dark"
        style="height: 600px"
      >
        <TiffViewer :source="TiffSource" />
      </div>
    </section>

    <!-- OrthogonalViewer Component (iframe-isolated) -->
    <section class="component-section">
      <h2 class="component-label">OrthogonalViewer (Neuroglancer)</h2>
      <p class="component-path">@pennsieve-viz/orthogonal via iframe</p>
      <div
        class="component-container"
        style="height: 700px; background: #000; padding: 0"
      >
        <OrthogonalFrame
          :source="zarrSource"
          :embed-url="orthogonalEmbedUrl"
        />
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
import { ref } from "vue";
import {
  CSVViewerCore,
  Markdown,
  TextViewer,
  DataExplorer,
  UMAP,
  ProportionPlotBeta as ProportionPlot,
  EditIcon,
  TSViewer,
  OmeViewer,
  TiffViewer,
  OrthogonalFrame,
} from "./index";
import "@pennsieve-viz/micro-ct/style.css";
import "@pennsieve-viz/tsviewer/style.css";

// Sample data for TextViewer
const sampleTextContent = ref(`This is sample text content.
It can display multiple lines.
The TextViewer component handles plain text files.

Line 4
Line 5
Line 6`);

// Sample data for AiPlotly
const samplePlotlyData = ref([
  {
    x: [1, 2, 3, 4, 5],
    y: [10, 15, 13, 17, 22],
    type: "scatter",
    mode: "lines+markers",
    name: "Sample Data",
    marker: { color: "blue" },
  },
  {
    x: [1, 2, 3, 4, 5],
    y: [12, 9, 15, 12, 18],
    type: "bar",
    name: "Bar Data",
    marker: { color: "orange" },
  },
]);

const samplePlotlyLayout = ref({
  title: "Sample Plotly Chart",
  xaxis: { title: "X Axis" },
  yaxis: { title: "Y Axis" },
});

// CSV dummy data as blob URL
const csvDummyData = `ID,Name,Age,Email,Department,Salary,Start Date,Status
1,Alice Johnson,32,alice.johnson@example.com,Engineering,95000,2021-03-15,Active
2,Bob Smith,45,bob.smith@example.com,Marketing,78000,2019-07-22,Active
3,Carol Davis,28,carol.davis@example.com,Engineering,88000,2022-01-10,Active
4,David Wilson,38,david.wilson@example.com,Sales,72000,2020-11-03,On Leave
5,Eva Martinez,31,eva.martinez@example.com,Engineering,92000,2021-06-18,Active
6,Frank Brown,52,frank.brown@example.com,HR,85000,2017-02-28,Active
7,Grace Lee,29,grace.lee@example.com,Marketing,71000,2022-09-01,Active
8,Henry Taylor,41,henry.taylor@example.com,Engineering,105000,2018-04-12,Active
9,Iris Chen,35,iris.chen@example.com,Sales,76000,2020-08-25,Active
10,Jack Anderson,27,jack.anderson@example.com,Engineering,82000,2023-01-09,Active
11,Karen White,44,karen.white@example.com,HR,90000,2016-11-30,Active
12,Leo Harris,33,leo.harris@example.com,Marketing,74000,2021-05-14,On Leave
13,Mia Clark,30,mia.clark@example.com,Engineering,91000,2022-03-07,Active
14,Nathan Lewis,48,nathan.lewis@example.com,Sales,83000,2015-09-20,Active
15,Olivia Walker,26,olivia.walker@example.com,Engineering,79000,2023-06-01,Active`;
const csvBlobUrl = URL.createObjectURL(new Blob([csvDummyData], { type: "text/csv" }));

// API configuration (update these for real data)
const apiUrl = ref(
  "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet"
);

// OrthogonalViewer (Neuroglancer) — runs in iframe for full isolation
const zarrSource = "https://pennsieve-dev-zarr-test-use1.s3.us-east-1.amazonaws.com/ddb6cb43-3749-4e9d-9c59-e2d4a8aa7f5a";
//needs to be different port than current localhost
const orthogonalEmbedUrl = "http://localhost:5173/embed.html";


// OME-Zarr test source (3D OME-Zarr with Z-stack and tiled zoom)
const omeTiffSource = ref(
  "https://pennsieve-dev-zarr-test-use1.s3.us-east-1.amazonaws.com/ddb6cb43-3749-4e9d-9c59-e2d4a8aa7f5a/sam-SR042-CL1-Downsampled4x.ome.tiff"
);
const TiffSource = ref(
  "/smallTest.tiff"
)

const samplePackage = ref({
  content: {
    id: "N:package:example-id",
    name: "example.csv",
    packageType: "CSV",
    datasetId: "N:dataset:example-dataset",
    state: "READY",
    createdAt: new Date().toISOString(),
  },
});
</script>

<style lang="scss">
@use "./styles/theme" as t;

.playground {
  font-family: t.$system-font;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;

  h1 {
    text-align: center;
    color: t.$gray_6;
    margin-bottom: 40px;
    border-bottom: 2px solid t.$purple_3;
    padding-bottom: 10px;
  }
}

.component-section {
  margin-bottom: 40px;
  border: 1px solid t.$gray_2;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.component-label {
  background: t.$purple_3;
  color: t.$white;
  margin: 0;
  padding: 12px 20px;
  font-size: 1.2rem;
}

.component-path {
  background: t.$purple_tint;
  color: t.$purple_2;
  margin: 0;
  padding: 8px 20px;
  font-family: monospace;
  font-size: 0.9rem;
}

.component-note {
  background: t.$orange_tint;
  color: t.$orange_1;
  margin: 0;
  padding: 8px 20px;
  font-size: 0.85rem;
}

.component-container {
  padding: 20px;
  background: t.$white;
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
  color: t.$gray_4;
  font-style: italic;
  background: repeating-linear-gradient(
    45deg,
    t.$gray_0,
    t.$gray_0 10px,
    t.$gray_2 10px,
    t.$gray_2 20px
  );
  margin: 0;
  border-radius: 4px;
}

.bg-tertiary { background: t.$gray_0; }
.bg-dark { background: t.$black; }
</style>

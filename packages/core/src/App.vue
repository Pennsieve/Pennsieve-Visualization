<template>
  <div class="playground">
    <h1>Pennsieve Visualization Components Playground</h1>

    <!-- Markdown Component -->
    <section class="component-section">
      <h2 class="component-label">&lt;Markdown /&gt;</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">inline markdown string</p>
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
      <h2 class="component-label">&lt;TextViewer /&gt;</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">inline text content</p>
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
      <h2 class="component-label">&lt;CSVViewer /&gt;</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">{{ csvUrl }}</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <CSVViewerCore :url="csvBlobUrl" />
      </div>
    </section>

    <!-- DataExplorer Component -->
    <section class="component-section">
      <h2 class="component-label">&lt;DataExplorer /&gt;</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2/genes.parquet</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <DataExplorer instance-id="playground-explorer" src-url="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2/genes.parquet" />
      </div>
    </section>

    <!-- UMAP Component -->
    <section class="component-section">
      <h2 class="component-label">&lt;UMAP /&gt;</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">{{ apiUrl }}</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <UMAP instance-id="playground-umap" :src-url="apiUrl" />
      </div>
    </section>

    <!-- ProportionPlot Component -->
    <section class="component-section">
      <h2 class="component-label">&lt;ProportionPlot /&gt;</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">{{ apiUrl }}</p>
      <div
        class="component-container bg-tertiary"
        style="height: 400px"
      >
        <ProportionPlot :src-url="apiUrl" xKey="category" yKey="value" />
      </div>
    </section>

    <!-- TSViewer Component -->
    <section class="component-section">
      <h2 class="component-label">&lt;TSViewer /&gt;</h2>
      <p class="component-path">@pennsieve-viz/tsviewer</p>
      <p class="component-url">no data source (websocket-based)</p>
      <div
        class="component-container bg-tertiary"
        style="height: 500px"
      >
        <TSViewer />
      </div>
    </section>

    <!-- OmeViewer (Micro-CT) Component -->
    <section class="component-section">
      <h2 class="component-label">&lt;OmeViewer /&gt;</h2>
      <p class="component-path">@pennsieve-viz/micro-ct</p>
      <p class="component-url">{{ omeTiffSource }}</p>
      <div
        class="component-container bg-dark"
        style="height: 600px"
      >
        <OmeViewer :source="omeTiffSource" source-type="ome-tiff" />
      </div>
    </section>

    <!-- TiffViewer Component (hidden for now) -->
    <!-- <section class="component-section">
      <h2 class="component-label">&lt;TiffViewer /&gt;</h2>
      <p class="component-path">@pennsieve-viz/micro-ct</p>
      <p class="component-url">{{ TiffSource }}</p>
      <div
        class="component-container bg-dark"
        style="height: 600px"
      >
        <TiffViewer :source="TiffSource" />
      </div>
    </section> -->

    <!-- OrthogonalViewer Component (iframe-isolated) -->
    <section class="component-section">
      <h2 class="component-label">&lt;OrthogonalFrame /&gt;</h2>
      <p class="component-path">@pennsieve-viz/orthogonal via iframe</p>
      <p class="component-url">{{ zarrSource }}</p>
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

    <!-- NiiViewer Component (direct .nii.gz) -->
    <section class="component-section">
      <h2 class="component-label">&lt;NiiViewer /&gt; (.nii.gz)</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">{{ niiUrl }}</p>
      <div
        class="component-container bg-dark"
        style="height: 600px"
      >
        <NiiViewer :url="niiUrl" />
      </div>
    </section>

    <!-- NiiViewer Component (OME-Zarr - SciVis) -->
    <section class="component-section">
      <h2 class="component-label">&lt;NiiViewer /&gt; (OME-Zarr SciVis)</h2>
      <p class="component-path">@pennsieve-viz/core</p>
      <p class="component-url">{{ niiZarrUrl }}</p>
      <div
        class="component-container bg-dark"
        style="height: 600px"
      >
        <NiiViewer :url="niiZarrUrl" :zarr-level="0" :zarr-max-volume-size="256" />
      </div>
    </section>



    <!-- EditIcon Component -->
    <section class="component-section">
      <h2 class="component-label">&lt;EditIcon /&gt;</h2>
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
  OrthogonalFrame,
  NiiViewer,
} from "./index";
import { TSViewer } from "@pennsieve-viz/tsviewer";
import { OmeViewer, TiffViewer } from "@pennsieve-viz/micro-ct";
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

// CSV dummy data — sample neuroscience experiment metadata
const csvDummyData = `Subject_ID,Species,Sex,Age_Weeks,Genotype,Brain_Region,Electrode_Count,Sampling_Rate_Hz,Recording_Duration_Min,Spike_Count,Mean_Firing_Rate_Hz,Signal_SNR_dB,Condition,Date_Recorded,Notes
DRG-001,Rat,M,12,Wild-Type,Dorsal Root Ganglion,32,30000,45,128450,4.76,18.3,Baseline,2024-09-12,Pre-stimulation recording
DRG-002,Rat,F,14,Wild-Type,Dorsal Root Ganglion,32,30000,45,143200,5.31,21.1,Baseline,2024-09-12,Pre-stimulation recording
DRG-003,Rat,M,12,Knockout,Dorsal Root Ganglion,32,30000,45,67300,2.49,15.7,Baseline,2024-09-14,Reduced spontaneous activity
DRG-004,Rat,F,13,Knockout,Dorsal Root Ganglion,32,30000,45,72100,2.67,16.2,Baseline,2024-09-14,Reduced spontaneous activity
DRG-005,Rat,M,12,Wild-Type,Dorsal Root Ganglion,64,30000,60,312500,5.21,22.4,Capsaicin 1uM,2024-09-18,Increased firing post-stimulus
DRG-006,Rat,F,14,Wild-Type,Dorsal Root Ganglion,64,30000,60,298700,4.98,20.8,Capsaicin 1uM,2024-09-18,Increased firing post-stimulus
DRG-007,Rat,M,12,Knockout,Dorsal Root Ganglion,64,30000,60,145600,2.43,14.9,Capsaicin 1uM,2024-09-20,Attenuated response vs WT
DRG-008,Rat,F,13,Knockout,Dorsal Root Ganglion,64,30000,60,152300,2.54,15.3,Capsaicin 1uM,2024-09-20,Attenuated response vs WT
DRG-009,Mouse,M,8,Wild-Type,Dorsal Root Ganglion,16,20000,30,84500,4.69,19.6,Baseline,2024-10-01,Control cohort
DRG-010,Mouse,F,8,Wild-Type,Dorsal Root Ganglion,16,20000,30,91200,5.07,20.2,Baseline,2024-10-01,Control cohort
DRG-011,Mouse,M,8,Transgenic-ChR2,Dorsal Root Ganglion,16,20000,30,67800,3.77,17.5,Optogenetic 5mW,2024-10-03,Blue light 470nm stimulation
DRG-012,Mouse,F,8,Transgenic-ChR2,Dorsal Root Ganglion,16,20000,30,72400,4.02,18.1,Optogenetic 5mW,2024-10-03,Blue light 470nm stimulation
DRG-013,Rat,M,16,Wild-Type,Dorsal Root Ganglion,64,30000,90,567800,6.31,24.5,Nerve Injury 7d,2024-10-10,SNI model - ipsilateral
DRG-014,Rat,M,16,Wild-Type,Dorsal Root Ganglion,64,30000,90,198400,2.20,19.1,Nerve Injury 7d,2024-10-10,SNI model - contralateral control
DRG-015,Rat,F,16,Wild-Type,Dorsal Root Ganglion,64,30000,90,542100,6.02,23.8,Nerve Injury 7d,2024-10-12,SNI model - ipsilateral
DRG-016,Rat,F,16,Wild-Type,Dorsal Root Ganglion,64,30000,90,201700,2.24,18.7,Nerve Injury 7d,2024-10-12,SNI model - contralateral control
DRG-017,Human,F,N/A,N/A,Dorsal Root Ganglion,128,40000,120,892300,7.44,28.3,Surgical Explant,2024-11-05,IRB #2024-0892 - L4/L5
DRG-018,Human,M,N/A,N/A,Dorsal Root Ganglion,128,40000,120,764500,6.37,26.1,Surgical Explant,2024-11-08,IRB #2024-0892 - L5/S1`;
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

// NiiViewer test sources
const niiUrl = ref("/test-nifti.nii.gz");
const niiZarrUrl = ref(
  "https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/mri_ventricles.ome.zarr"
);

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

.component-url {
  background: t.$gray_1;
  color: t.$gray_5;
  margin: 0;
  padding: 6px 20px;
  font-family: monospace;
  font-size: 0.8rem;
  word-break: break-all;
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

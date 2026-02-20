<script setup>
import { OmeViewer } from "./components/ome";

// 3D OME-Zarr with Z-stack AND tiled zoom (3763x2860, 145 Z-slices, 4 channels, 1024x1024 tiles)
const testSource ="https://pennsieve-dev-zarr-test-use1.s3.us-east-1.amazonaws.com/ddb6cb43-3749-4e9d-9c59-e2d4a8aa7f5a";// "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.1/6001257.zarr";

// LARGE 2D pyramidal OME-Zarr (380928 x 921600 px) - no Z-stack
//const testSource = "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.1/4495402.zarr";

// Small 3D OME-Zarr with Z-stack (275x271 px - too small for tiling)
// const testSource =
//   "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr";

//Pennsieve S3
// const testSource =
//   "https://pennsieve-dev-zarr-test-use1.s3.us-east-1.amazonaws.com/ddb6cb43-3749-4e9d-9c59-e2d4a8aa7f5a/";

//Pennsieve Tiff
// const testSource =
//   "https://pennsieve-dev-zarr-test-use1.s3.us-east-1.amazonaws.com/ddb6cb43-3749-4e9d-9c59-e2d4a8aa7f5a/sam-SR042-CL1-Downsampled4x.ome.tiff";

// Local OME-TIFF with Z-stack
//const testSource = "/sam-SR042-CL1-Downsampled4x.ome.tiff";
</script>

<template>
  <div class="app">
    <header>
      <h1>OME Viewer</h1>
    </header>
    <main>
      <OmeViewer :source="testSource" source-type="ome-zarr" />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

header {
  padding: 1rem;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
}

header h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #fff;
}

main {
  flex: 1;
  overflow: hidden;
}
</style>

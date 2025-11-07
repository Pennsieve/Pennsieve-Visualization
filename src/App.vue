<template>
  <!-- <UMAPViewer style="height: 500px;" :pkg="pkg" :apiUrl="apiUrl" src-url="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet"></UMAPViewer> -->
  <!-- <DataExplorer :pkg="pkg"   apiUrl="https://api.pennsieve.net"></DataExplorer> -->
  <!-- <div style="height: 400px;width:400px;">
        <ProportionPlot src-url="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/"></ProportionPlot>
    </div> -->
  <div style="height: 400px; width: 400px">
    <Markdown
      mode="preview"
      markdownText="# My Markdown Example

This is a paragraph of text. You can make text **bold** using double asterisks or double underscores, like __this__. You can also make text *italic* using single asterisks or single underscores, like _this_.

## Lists

### Unordered List
* Item one
* Item two
  * Sub-item A
  * Sub-item B
* Item three

### Ordered List
1. First item
2. Second item
3. Third item

## Code

You can include `inline code` by wrapping it in backticks.

For longer code blocks, use three backticks and specify the language:

```python
def hello_world():
    print('Hello, world!'')

hello_world()"
    ></Markdown>
  </div>
</template>
<script setup lang="ts">
import { Markdown } from "./index";
import { onBeforeMount, ref } from "vue";

onBeforeMount(async () => {
  // const text = await fetch('/src/local/test.csv').then(r => r.text())
});
//  s3://temp-precision-dashboard-data/humandrg/v1/
const apiUrl = ref("https://api.pennsieve.net");
const pkg = {
  content: {
    createdAt: "2025-08-10T02:52:17.165166Z",
    datasetId: "N:dataset:260f846c-6edc-4e6b-aa9f-e29a9a096c56",
    datasetIntId: 2049,
    datasetNodeId: "N:dataset:260f846c-6edc-4e6b-aa9f-e29a9a096c56",
    id: "N:package:c4556033-05cb-4d30-8b4b-a697d71103fe",
    intId: 2243539,
    name: "EPSO.csv",
    nodeId: "N:package:20464fab-1320-4c7b-92a9-f08cb992a634",
    ownerId: 365,
    packageType: "CSV",
    state: "READY",
    updatedAt: "2025-08-10T02:52:17.165166Z",
  },
};
//{"content":{"id":"N:package:d9175bfa-0524-422a-b987-dde3302741b7","nodeId":"N:package:d9175bfa-0524-422a-b987-dde3302741b7","name":"Seurat_final_toshare.Rds","packageType":"Unsupported","datasetId":"N:dataset:260f846c-6edc-4e6b-aa9f-e29a9a096c56","datasetNodeId":"N:dataset:260f846c-6edc-4e6b-aa9f-e29a9a096c56","ownerId":365,"state":"READY","createdAt":"2025-08-08T16:25:03.08889Z","updatedAt":"2025-08-08T19:36:50.450967Z","intId":2243538,"datasetIntId":2049},"properties":[{"category":"Pennsieve","properties":[{"key":"subtype","value":"Generic Data","dataType":"string","fixed":false,"hidden":true,"display":"Generic Data"},{"key":"icon","value":"Generic","dataType":"string","fixed":false,"hidden":true,"display":"Generic"}]},{"category":"ViewerSupport","properties":[{"key":"parquet-umap-viewer","value":"{\"s3Asset\":\"14b49597-25da-4f83-8705-a0cb56313817/2d901a56-de34-46ef-8b32-4aa72f4f75d2\",\"viewerType\":\"parquet-umap-viewer\"}","dataType":"JSON","fixed":true,"hidden":true,"display":"{\"s3Asset\":\"14b49597-25da-4f83-8705-a0cb56313817/2d901a56-de34-46ef-8b32-4aa72f4f75d2\",\"viewerType\":\"parquet-umap-viewer\"}"}]}],"children":[],"ancestors":[],"storage":3232609766}
const mapRows = ref([]);
function logResults(s) {
  mapRows.value = s.results;
}
</script>
<style lang="scss"></style>

<template>
    <UMAPViewer src-url="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet"></UMAPViewer>
    <DataExplorer src-url="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet"></DataExplorer>
    <div style="height: 600px;width:600px;">
        <ProportionPlot src-url="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet"></ProportionPlot>
    </div>

</template>
<script setup lang="ts">

import {DataExplorer, UMAP as UMAPViewer, ProportionPlot} from './index'
import { onBeforeMount, ref } from 'vue';
onBeforeMount(async()=>{
   // const text = await fetch('/src/local/test.csv').then(r => r.text())
})
const apiUrl = ref("string");
const pkg = {
    content:{
        createdAt: "2025-08-10T02:52:17.165166Z",
        datasetId: "N:dataset:260f846c-6edc-4e6b-aa9f-e29a9a096c56",
        datasetIntId: 2049,
        datasetNodeId: "N:dataset:260f846c-6edc-4e6b-aa9f-e29a9a096c56",
        id: "N:package:20464fab-1320-4c7b-92a9-f08cb992a634",
        intId: 2243539,
        name: "EPSO.csv",
        nodeId: "N:package:20464fab-1320-4c7b-92a9-f08cb992a634",
        ownerId: 365,
        packageType: "CSV",
        state: "READY",
        updatedAt: "2025-08-10T02:52:17.165166Z"
    }
}
const mapRows = ref([])
function logResults(s){
    mapRows.value = s.results
}
</script>
<style lang="scss">

</style>

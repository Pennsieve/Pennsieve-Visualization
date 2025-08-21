<template>
    <UMAPViewer></UMAPViewer>
    <DataExplorer :src="pkg"></DataExplorer>
</template>
<script setup lang="ts">
import {default as UMAPViewer} from './components/UMAP/wrapper.vue';
import {DataExplorer} from './index'
import { onBeforeMount } from 'vue';
onBeforeMount(async()=>{
   // const text = await fetch('/src/local/test.csv').then(r => r.text())
})
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

</script>
<style lang="scss">

</style>

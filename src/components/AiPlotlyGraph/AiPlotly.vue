<script setup></script>
<template>
  <div class="ai-plot-widget">
    <!-- Data source input -->
    <el-input v-model="dataUrl" placeholder="S3 Parquet URL" @blur="loadData" />

    <!-- AI prompt input (only shows after data loaded) -->
    <el-input
      v-if="dataLoaded"
      v-model="userPrompt"
      :maxlength="280"
      placeholder="Describe your plot..."
      @keyup.enter="generatePlot"
    />

    <!-- Plotly container -->
    <div ref="plotlyDiv" class="plot-container"></div>

    <!-- Save config button -->
    <el-button @click="saveConfig">Save Widget Config</el-button>
  </div>
</template>

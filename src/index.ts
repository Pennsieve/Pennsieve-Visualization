import { defineAsyncComponent } from "vue";

// Lazy load components
export const DataExplorer = defineAsyncComponent(
  () => import("./components/DataExplorer/DataExplorerWrap.vue")
);

export const UMAP = defineAsyncComponent(
  () => import("./components/UMAP/wrapper.vue")
);

export const ProportionPlot = defineAsyncComponent(
  () => import("./components/ProportionPlot/proportionPlot.vue")
);

export const Markdown = defineAsyncComponent(
  () => import("./components/Markdown/Markdown.vue")
);
export const TextViewer = defineAsyncComponent(
  () => import("./components/TextViewer/TextViewer.vue")
);

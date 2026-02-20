import { createApp } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { useDuckDBStore } from './dev/duckdbStore.js'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(ElementPlus)

// Dev-only: provide the real DuckDB store (uses jsDelivr CDN bundles)
const duckdbStore = useDuckDBStore()
app.provide('duckdb', duckdbStore)

app.mount('#app')

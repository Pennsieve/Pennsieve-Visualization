import { createApp } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { getSharedDuckDBStore } from './duckdb'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(ElementPlus)

// The same shared store host apps use
app.provide('duckdb', getSharedDuckDBStore(() => import('@duckdb/duckdb-wasm')))


app.mount('#app')

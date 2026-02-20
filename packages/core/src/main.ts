import { createApp, ref } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(ElementPlus)

// Dev-only stub DuckDB store so playground components don't crash
app.provide('duckdb', {
  isReady: ref(false),
  createConnection: async () => ({ connection: null, connectionId: 'stub' }),
  closeConnection: async () => {},
  loadFile: async () => 'stub',
  executeQuery: async () => [],
  sharedResultName: ref(null),
  sharedVersion: ref(0),
  publishViewFromQuery: async () => {},
  formatIdFromUrl: (url: string) => url,
})

app.mount('#app')

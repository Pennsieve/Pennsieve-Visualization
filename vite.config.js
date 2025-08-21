
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from "node:url";


export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: './src/index.ts', 
      name: 'PennsieveVisualization',
      fileName: (format) => `pennsieve-visualization.${format}.js`,
    },
    rollupOptions: {
      //external dependencies 
      external: [
        'vue',
        '@aws-amplify/auth',
        'pinia'],
      output: {
        assetFileNames: (a) => a.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]',
        globals: {
          vue: 'Vue',
          pinia: 'Pinia', 
          '@aws-amplify/auth': 'aws_amplify_auth'
        },
      },
    },
  },
})

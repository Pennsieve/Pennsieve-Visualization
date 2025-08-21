
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
      external: ['vue', 'aws-amplify/auth'],
      output: {
        globals: {
          vue: 'Vue',
          'aws-amplify/auth': 'Amplify.Auth',
        },
      },
    },
  },
})

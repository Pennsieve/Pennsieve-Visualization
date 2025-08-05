// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: './src/index.ts', 
      name: 'PennsieveVisualization',
      fileName: (format) => `pennsieve-visualization.${format}.js`,
    },
    rollupOptions: {
      //external dependencies 
      external: ['vue', 'aws-amplify'],
      output: {
        globals: {
          vue: 'Vue',
          'aws-amplify': 'Amplify',
        },
      },
    },
  },
})

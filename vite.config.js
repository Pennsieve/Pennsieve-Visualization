
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    include: ['@aws-amplify/auth']
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: './src/index.ts',
      name: 'PennsieveVisualization',
      fileName: (format) => `pennsieve-visualization.${format}.js`,
      formats: ['es'],
    },
    copyPublicDir: false,
    rollupOptions: {
      external: [
        'vue',
        'pinia',
        'plotly.js',
        '@aws-amplify/auth', 
      ],
      output: {
        // No globals needed for ES/CJS outputs
        assetFileNames: (a) =>
          a.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]',
      },
    },
  },
})


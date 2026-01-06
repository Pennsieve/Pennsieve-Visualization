import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ['src'],
      tsconfigPath: resolve(__dirname, 'tsconfig.json'),
      entryRoot: 'src'
    })
  ],
  resolve: {
    alias: {
      '@pennsieve-viz/core': resolve(__dirname, '../core/src'),
      '@pennsieve-viz/duckdb': resolve(__dirname, '../duckdb/src')
    }
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PennsieveVizProportionPlot',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: [
        'vue',
        'pinia',
        'plotly.js',
        '@aws-amplify/auth',
        '@pennsieve-viz/core',
        '@pennsieve-viz/duckdb'
      ],
      output: {
        globals: {
          vue: 'Vue',
          pinia: 'Pinia'
        },
        assetFileNames: (a) =>
          a.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]'
      }
    },
    copyPublicDir: false
  }
})

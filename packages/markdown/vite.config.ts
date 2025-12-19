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
      '@pennsieve-viz/core': resolve(__dirname, '../core/src')
    }
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PennsieveVizMarkdown',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: [
        'vue',
        '@pennsieve-viz/core',
        'marked',
        'dompurify'
      ],
      output: {
        globals: {
          vue: 'Vue'
        },
        assetFileNames: (a) =>
          a.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]'
      }
    },
    copyPublicDir: false
  }
})

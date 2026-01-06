import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'TSViewer',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: [
        'vue',
        'pinia',
        'element-plus',
        '@element-plus/icons-vue',
        '@aws-amplify/auth',
        'aws-amplify/auth'
      ],
      output: {
        exports: 'named',
        globals: {
          vue: 'Vue',
          pinia: 'Pinia',
          'element-plus': 'ElementPlus'
        },
        assetFileNames: (a) =>
          a.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]'
      }
    },
    copyPublicDir: false
  }
})

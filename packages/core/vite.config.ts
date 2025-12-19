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
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PennsieveVizCore',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: ['vue', '@aws-amplify/auth'],
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

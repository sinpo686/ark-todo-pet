import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          pet: resolve('src/renderer/src/windows/pet/index.html'),
          todo: resolve('src/renderer/src/windows/todo/index.html'),
          settings: resolve('src/renderer/src/windows/settings/index.html')
        }
      }
    }
  }
})

// Runs the renderer in a normal browser (used for UI development and Playwright tests).
// The backend is chosen at runtime: ?backend=demo (in-browser fake) or the dev-server proxy (/api).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyOrtRuntime } from './electron.vite.config'

export default defineConfig({
  root: resolve('src/renderer'),
  publicDir: resolve('src/renderer/public'),
  plugins: [react(), copyOrtRuntime()],
  resolve: { alias: { '@shared': resolve('src/shared'), '@courses': resolve('courses') } },
  worker: { format: 'es' },
  server: {
    port: 5317,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:5318', changeOrigin: false } }
  }
})

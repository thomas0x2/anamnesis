import { resolve } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Copy runtime assets next to the renderer so nothing is fetched from a CDN:
 * the onnxruntime-web wasm (local Whisper) and pdf.js's standard fonts, image decoders and colour profiles.
 */
export function copyOrtRuntime(): Plugin {
  return {
    name: 'anamnesis-copy-runtime',
    buildStart() {
      const pub = resolve('src/renderer/public')
      const copy = (from: string, to: string, files: string[]): void => {
        mkdirSync(to, { recursive: true })
        for (const f of files) if (existsSync(resolve(from, f)) && !existsSync(resolve(to, f))) copyFileSync(resolve(from, f), resolve(to, f))
      }
      copy(resolve('node_modules/onnxruntime-web/dist'), resolve(pub, 'ort'), ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'])
      const pdf = resolve('node_modules/pdfjs-dist')
      copy(resolve(pdf, 'standard_fonts'), resolve(pub, 'pdfjs/standard_fonts'), readdirSync(resolve(pdf, 'standard_fonts')))
      copy(resolve(pdf, 'wasm'), resolve(pub, 'pdfjs/wasm'), readdirSync(resolve(pdf, 'wasm')).filter((f) => !f.startsWith('quickjs')))
      copy(resolve(pdf, 'iccs'), resolve(pub, 'pdfjs/iccs'), readdirSync(resolve(pdf, 'iccs')))
    }
  }
}

export default defineConfig({
  main: {
    build: { externalizeDeps: true }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    publicDir: resolve('src/renderer/public'),
    plugins: [react(), copyOrtRuntime()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@courses': resolve('courses')
      }
    },
    worker: { format: 'es' },
    build: {
      target: 'chrome140',
      chunkSizeWarningLimit: 4000,
      rolldownOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})

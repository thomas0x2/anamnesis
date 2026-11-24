import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
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

/** The commit this build comes from, with its date (and "+changes" for uncommitted edits), shown in Settings. */
export function buildId(): string {
  try {
    const git = (c: string): string => execSync(`git ${c}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = git('status --porcelain --untracked-files=no') ? ' +changes' : ''
    return `${git('log -1 --format=%h·%cs')}${dirty}`
  } catch {
    return 'unknown'
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
    define: { __BUILD_ID__: JSON.stringify(buildId()) },
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

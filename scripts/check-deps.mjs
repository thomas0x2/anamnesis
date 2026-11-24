// Runs before `npm run dev`, `npm start` and `npm run build`: stops when node_modules does not match the
// lockfile (for example after a `git pull` that changed dependencies without `npm ci`). Old packages fail
// quietly instead: math, for one, then shows as raw $…$ source.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** Top-level packages whose installed version differs from the lockfile, as "name installed → wanted". */
export function staleDeps(dir = root) {
  const lockPath = join(dir, 'package-lock.json')
  if (!existsSync(lockPath)) return []
  const lock = read(lockPath)
  const pkg = read(join(dir, 'package.json'))
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  const out = []
  for (const name of names) {
    const wanted = lock.packages?.[`node_modules/${name}`]?.version
    if (!wanted) continue
    const file = join(dir, 'node_modules', name, 'package.json')
    const installed = existsSync(file) ? read(file).version : null
    if (installed !== wanted) out.push(`${name} ${installed ?? 'missing'} → ${wanted}`)
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stale = staleDeps()
  if (stale.length) {
    console.error(`\nThe installed packages do not match package-lock.json:\n  ${stale.join('\n  ')}\n\nRun  npm ci  and start again.\n`)
    process.exit(1)
  }
}

// Course materials on disk: the PDFs in a course folder, and reading a material's bytes by its
// entry in the course's materials file (the renderer names a material, never a path).
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { FolderFile, MaterialsFile, Settings } from '../shared/types'
import type { JsonStore } from './store'

const SKIP = new Set(['node_modules', '.git', '__MACOSX'])

/** PDFs in `dir` and its subfolders (up to 4 levels, at most 600 files). */
export async function scanPdfs(dir: string, maxDepth = 4, limit = 600): Promise<FolderFile[] | null> {
  const root = resolve(dir)
  try {
    if (!(await stat(root)).isDirectory()) return null
  } catch {
    return null
  }
  const out: FolderFile[] = []
  const walk = async (d: string, depth: number): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const e of entries) {
      if (out.length >= limit) return
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1)
      } else if (e.isFile() && /\.pdf$/i.test(e.name)) {
        try {
          const s = await stat(full)
          out.push({ path: full, rel: relative(root, full), name: e.name, size: s.size, mtimeMs: s.mtimeMs })
        } catch {
          /* vanished */
        }
      }
    }
  }
  await walk(root, 0)
  return out
}

export async function fileInfo(path: string): Promise<FolderFile | null> {
  try {
    const s = await stat(path)
    const name = path.split(/[\\/]/).pop() ?? path
    return { path, rel: name, name, size: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return null
  }
}

/** The bytes of material `materialId` of course `courseId`; only PDFs listed in the course's materials file. */
export async function readMaterial(store: JsonStore, settings: Settings, courseId: string, materialId: string, fallbackScript: string | null = null): Promise<Uint8Array | null> {
  if (!/^[\w-]+$/.test(courseId) || !/^[\w-]+$/.test(materialId)) return null
  const file = await store.read<MaterialsFile>(`courses/${courseId}/materials`)
  let path = file?.items?.find((m) => m.id === materialId)?.path ?? null
  if (!path && courseId === 'numcs' && materialId === 'script') path = settings.script.path ?? fallbackScript
  if (!path || !/\.pdf$/i.test(path)) return null
  try {
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}

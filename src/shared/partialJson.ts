// Tolerant parser for a JSON prefix that is still streaming in.
// Returns the value parsed so far: open strings are kept as-is, open arrays/objects are closed,
// a dangling key or literal is dropped.

export interface PartialParse {
  value: unknown
  complete: boolean
}

export function parsePartialJson(src: string): PartialParse {
  let i = 0
  const n = src.length
  let truncated = false

  const ws = (): void => {
    while (i < n && /\s/.test(src[i])) i++
  }

  function parseString(): string {
    // assumes src[i] === '"'
    i++
    let out = ''
    while (i < n) {
      const ch = src[i]
      if (ch === '"') {
        i++
        return out
      }
      if (ch === '\\') {
        if (i + 1 >= n) {
          i = n
          truncated = true
          return out
        }
        const e = src[i + 1]
        if (e === 'u') {
          const hex = src.slice(i + 2, i + 6)
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            i = n
            truncated = true
            return out
          }
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }
        out += map[e] ?? e
        i += 2
        continue
      }
      out += ch
      i++
    }
    truncated = true
    return out
  }

  function parseNumber(): number | undefined {
    const m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i))
    if (!m) {
      i = n
      truncated = true
      return undefined
    }
    i += m[0].length
    if (i >= n) truncated = true
    return Number(m[0])
  }

  function parseLiteral(): unknown {
    for (const [word, val] of [
      ['true', true],
      ['false', false],
      ['null', null]
    ] as const) {
      if (src.startsWith(word, i)) {
        i += word.length
        return val
      }
      if (word.startsWith(src.slice(i))) {
        i = n
        truncated = true
        return undefined
      }
    }
    i = n
    truncated = true
    return undefined
  }

  function parseValue(): unknown {
    ws()
    if (i >= n) {
      truncated = true
      return undefined
    }
    const ch = src[i]
    if (ch === '{') return parseObject()
    if (ch === '[') return parseArray()
    if (ch === '"') return parseString()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber()
    return parseLiteral()
  }

  function parseArray(): unknown[] {
    i++
    const arr: unknown[] = []
    for (;;) {
      ws()
      if (i >= n) {
        truncated = true
        return arr
      }
      if (src[i] === ']') {
        i++
        return arr
      }
      const before = truncated
      const v = parseValue()
      if (v !== undefined && !(truncated && !before && v === undefined)) arr.push(v)
      ws()
      if (i >= n) {
        truncated = true
        return arr
      }
      if (src[i] === ',') {
        i++
        continue
      }
      if (src[i] === ']') {
        i++
        return arr
      }
      // malformed: stop
      i = n
      truncated = true
      return arr
    }
  }

  function parseObject(): Record<string, unknown> {
    i++
    const obj: Record<string, unknown> = {}
    for (;;) {
      ws()
      if (i >= n) {
        truncated = true
        return obj
      }
      if (src[i] === '}') {
        i++
        return obj
      }
      if (src[i] !== '"') {
        i = n
        truncated = true
        return obj
      }
      const key = parseString()
      ws()
      if (i >= n || src[i] !== ':') {
        truncated = true
        i = n
        return obj
      }
      i++
      const v = parseValue()
      if (v !== undefined) obj[key] = v
      ws()
      if (i >= n) {
        truncated = true
        return obj
      }
      if (src[i] === ',') {
        i++
        continue
      }
      if (src[i] === '}') {
        i++
        return obj
      }
      i = n
      truncated = true
      return obj
    }
  }

  const value = parseValue()
  ws()
  return { value, complete: !truncated && i >= n }
}

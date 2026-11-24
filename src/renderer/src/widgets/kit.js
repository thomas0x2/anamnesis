// Anamnesis widget kit: the one set of components the tutor builds interactive demos from.
// It runs inside the sandboxed widget frame (no network, no access to the app) and gives every
// generated demo the same look as the rest of the app: Ma tokens, IBM Plex, hairline controls,
// the same plot axes as the built-in charts. The tutor's code calls K.demo({...}); see
// WIDGET_KIT_DOC in src/shared/prompts.ts for the API as the tutor sees it.
;(function () {
  'use strict'
  var NS = 'http://www.w3.org/2000/svg'
  var PALETTE = ['#8fb3e0', '#e6c56f', '#d98fb8', '#8fd1a8']
  var NAMED = {
    brand: '#e5603b',
    text: '#ececea',
    muted: '#8a8a85',
    faint: '#5c5c58',
    good: '#9fd8b0',
    warn: '#e4c08a',
    bad: '#ec9a8f',
    blue: PALETTE[0],
    yellow: PALETTE[1],
    pink: PALETTE[2],
    green: PALETTE[3]
  }
  var M = { top: 10, right: 14, bottom: 28, left: 46 }

  function post(msg) {
    try {
      parent.postMessage(msg, '*')
    } catch (e) {
      /* detached */
    }
  }
  var reported = {}
  function report(e) {
    var msg = String((e && (e.message || e)) || 'unknown error')
    if (reported[msg]) return
    reported[msg] = true
    post({ type: 'widget-error', message: msg.slice(0, 300) })
    var root = document.getElementById('k-root')
    if (root && !root.querySelector('.k-error')) {
      var d = el('div', 'k-error')
      d.textContent = 'This widget hit an error: ' + msg
      root.appendChild(d)
    }
  }
  window.addEventListener('error', function (e) {
    report(e.error || e.message)
  })
  window.addEventListener('unhandledrejection', function (e) {
    report(e.reason)
  })

  function el(tag, cls, parentEl) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (parentEl) parentEl.appendChild(n)
    return n
  }
  function sv(tag, attrs, parentEl) {
    var n = document.createElementNS(NS, tag)
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k])
    if (parentEl) parentEl.appendChild(n)
    return n
  }
  function color(c, i) {
    if (typeof c === 'number') return PALETTE[((c % 4) + 4) % 4]
    if (typeof c === 'string' && c) return NAMED[c] || c
    return PALETTE[(i || 0) % 4]
  }
  function finite(v) {
    return typeof v === 'number' && isFinite(v)
  }

  // ---------------------------------------------------------------- numbers
  function fmt(v, digits) {
    if (typeof v !== 'number') return String(v)
    if (!isFinite(v)) return isNaN(v) ? 'NaN' : v > 0 ? '∞' : '−∞'
    if (digits !== undefined) return v.toFixed(digits).replace('-', '−')
    if (v === 0) return '0'
    var a = Math.abs(v)
    if (a >= 1e5 || a < 1e-3) {
      var e = Math.floor(Math.log10(a))
      var mant = (a / Math.pow(10, e)).toFixed(2)
      if (Number(mant) >= 10) {
        e += 1
        mant = (a / Math.pow(10, e)).toFixed(2)
      }
      return (v < 0 ? '−' : '') + mant.replace(/\.?0+$/, '') + 'e' + e
    }
    var d = a >= 100 ? 1 : a >= 10 ? 2 : 3
    return v.toFixed(d).replace(/\.?0+$/, '').replace('-', '−')
  }
  function niceTicks(lo, hi, count) {
    var span = hi - lo
    if (!(span > 0) || !isFinite(span)) return [lo]
    var raw = span / count
    var mag = Math.pow(10, Math.floor(Math.log10(raw)))
    var err = raw / mag
    var step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag
    var out = []
    for (var k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) out.push(Number((k * step).toPrecision(12)))
    return out
  }
  function logTicks(lo, hi) {
    var a = Math.floor(Math.log10(lo))
    var b = Math.ceil(Math.log10(hi))
    var every = Math.max(1, Math.ceil((b - a) / 7))
    var out = []
    for (var e = a; e <= b; e += every) {
      var v = Number('1e' + e)
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v)
    }
    return out.length >= 2 ? out : [lo, hi]
  }
  function autoRange(vals, log) {
    var v = vals.filter(function (x) {
      return finite(x) && (!log || x > 0)
    })
    v.sort(function (a, b) {
      return a - b
    })
    if (!v.length) return log ? [1e-3, 1] : [-1, 1]
    var lo = v[0]
    var hi = v[v.length - 1]
    if (v.length > 30) {
      var lo2 = v[Math.round(0.01 * (v.length - 1))]
      var hi2 = v[Math.round(0.99 * (v.length - 1))]
      var inner = log ? Math.log10(hi2 / lo2) : hi2 - lo2
      var outer = log ? Math.log10(hi / lo) : hi - lo
      if (inner > 0 && outer > 12 * inner) {
        lo = lo2
        hi = hi2
      }
    }
    if (log) return hi / lo < 10 ? [lo / 4.8, hi * 4.8] : [lo / 1.6, hi * 1.6]
    if (hi - lo < 1e-12) {
      var d = Math.abs(lo) * 0.1 || 1
      return [lo - d, hi + d]
    }
    var pad = (hi - lo) * 0.07
    return [lo - pad, hi + pad]
  }
  function linspace(a, b, n) {
    n = Math.max(2, Math.round(n || 100))
    var out = []
    for (var i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1))
    return out
  }
  function range(a, b, step) {
    if (b === undefined) {
      b = a
      a = 0
    }
    step = step || 1
    var out = []
    for (var x = a; step > 0 ? x < b : x > b; x += step) out.push(x)
    return out
  }
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v))
  }
  /** RK4 for y' = f(t, y) with y a number or an array; returns { t: [...], y: [...] }. */
  function ode(f, y0, t0, t1, n) {
    n = Math.max(1, Math.round(n || 400))
    var h = (t1 - t0) / n
    var vec = Array.isArray(y0)
    var add = function (a, b, s) {
      if (!vec) return a + s * b
      return a.map(function (ai, i) {
        return ai + s * b[i]
      })
    }
    var y = vec ? y0.slice() : y0
    var ts = [t0]
    var ys = [y]
    for (var i = 0; i < n; i++) {
      var t = t0 + i * h
      var k1 = f(t, y)
      var k2 = f(t + h / 2, add(y, k1, h / 2))
      var k3 = f(t + h / 2, add(y, k2, h / 2))
      var k4 = f(t + h, add(y, k3, h))
      if (vec)
        y = y.map(function (yi, j) {
          return yi + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])
        })
      else y = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
      ts.push(t + h)
      ys.push(y)
    }
    return { t: ts, y: ys }
  }
  /** Seeded random numbers (mulberry32): the same demo looks the same every time. */
  function rand(seed) {
    var a = (seed === undefined ? 1 : seed) >>> 0
    var r = function () {
      a = (a + 0x6d2b79f5) >>> 0
      var t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    r.normal = function () {
      var u = Math.max(1e-12, r())
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
    }
    return r
  }

  // ---------------------------------------------------------------- params (controls)
  function slider(o) {
    o = o || {}
    var min = finite(o.min) ? o.min : 0
    var max = finite(o.max) ? o.max : 1
    return { kind: 'slider', label: o.label, min: min, max: max, step: o.step || (max - min) / 100, value: finite(o.value) ? clamp(o.value, min, max) : min, fmt: o.fmt, log: !!o.log }
  }
  function choice(o) {
    o = o || {}
    var opts = (o.options || []).map(function (x) {
      return typeof x === 'object' ? x : { value: x, label: String(x) }
    })
    return { kind: 'choice', label: o.label, options: opts, value: o.value !== undefined ? o.value : opts.length ? opts[0].value : null }
  }
  function toggle(o) {
    o = o || {}
    return { kind: 'toggle', label: o.label || '', value: !!o.value }
  }
  function button(o) {
    o = o || {}
    return { kind: 'button', label: o.label || 'Go', onClick: o.onClick }
  }

  // ---------------------------------------------------------------- views
  /** A 2-D plot in data coordinates: axes, grid and legend like the app's charts. */
  function Plot(opts) {
    this.o = opts || {}
    this.node = el('div', 'k-view k-plot')
    if (this.o.title) el('div', 'k-view-title', this.node).textContent = this.o.title
    this.legendEl = el('div', 'k-legend', this.node)
    this.svg = sv('svg', { class: 'k-svg' }, this.node)
    this.list = []
    this.handles = []
    this.id = 'k' + Math.random().toString(36).slice(2, 8)
  }
  var P = Plot.prototype
  P._push = function (kind, data, o) {
    o = o || {}
    var item = { kind: kind, data: data, o: o, i: this.list.length }
    this.list.push(item)
    return this
  }
  P.set = function (o) {
    for (var k in o) this.o[k] = o[k]
    return this
  }
  P.fn = function (f, o) {
    o = o || {}
    var self = this
    return this._push('fn', f, o, self)
  }
  P.curve = function (g, t0, t1, o) {
    o = o || {}
    var n = o.n || 400
    var pts = []
    for (var i = 0; i <= n; i++) {
      var t = t0 + ((t1 - t0) * i) / n
      var p = g(t)
      pts.push([p[0], p[1]])
    }
    return this._push('path', pts, o)
  }
  P.path = function (pts, o) {
    return this._push('path', pts, o)
  }
  P.points = function (pts, o) {
    return this._push('points', pts, o)
  }
  P.stems = function (pts, o) {
    return this._push('stems', pts, o)
  }
  P.bars = function (pts, o) {
    return this._push('bars', pts, o)
  }
  P.line = function (x1, y1, x2, y2, o) {
    return this._push('segment', [x1, y1, x2, y2], o)
  }
  P.arrow = function (x1, y1, x2, y2, o) {
    o = Object.assign({}, o || {}, { head: true })
    return this._push('segment', [x1, y1, x2, y2], o)
  }
  P.vline = function (x, o) {
    return this._push('vline', x, o)
  }
  P.hline = function (y, o) {
    return this._push('hline', y, o)
  }
  P.area = function (f, a, b, o) {
    return this._push('area', { f: f, a: a, b: b }, o)
  }
  P.rect = function (x, y, w, h, o) {
    return this._push('rect', [x, y, w, h], o)
  }
  P.circle = function (x, y, r, o) {
    return this._push('circle', [x, y, r], o)
  }
  P.text = function (x, y, s, o) {
    return this._push('text', [x, y, String(s)], o)
  }
  P.field = function (F, o) {
    return this._push('field', F, o)
  }
  P.heat = function (F, o) {
    return this._push('heat', F, o)
  }
  P.level = function (F, levels, o) {
    return this._push('level', { F: F, levels: Array.isArray(levels) ? levels : [levels] }, o)
  }
  /** A draggable point; its position lives in the demo state under `name` and survives redraws. */
  P.handle = function (name, o) {
    o = o || {}
    var st = this._state
    var cur = st[name]
    if (!Array.isArray(cur)) cur = st[name] = [finite(o.x) ? o.x : 0, finite(o.y) ? o.y : 0]
    this.handles.push({ name: name, o: o })
    this._push('handle', name, o)
    return cur
  }

  P._render = function (width) {
    var o = this.o
    var self = this
    var svg = this.svg
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    var height = clamp(o.height || 260, 120, 640)
    var axes = o.axes !== false
    var m = axes ? M : { top: 6, right: 6, bottom: 6, left: 6 }
    var logX = !!o.logX
    var logY = !!o.logY
    var w = Math.max(80, width - m.left - m.right)
    var h = Math.max(60, height - m.top - m.bottom)
    svg.setAttribute('width', width)
    svg.setAttribute('height', height)
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height)

    // x range first (functions are sampled over it), then y from everything drawn
    var x0 = o.xMin
    var x1 = o.xMax
    var xs = []
    var ys = []
    var collect = function (x, y) {
      xs.push(x)
      ys.push(y)
    }
    this.list.forEach(function (it) {
      var d = it.data
      if (it.kind === 'path' || it.kind === 'points' || it.kind === 'stems' || it.kind === 'bars')
        d.forEach(function (p) {
          collect(p[0], p[1])
          if (it.kind !== 'path' && it.kind !== 'points') ys.push(0)
        })
      else if (it.kind === 'segment') {
        collect(d[0], d[1])
        collect(d[2], d[3])
      } else if (it.kind === 'rect') {
        collect(d[0], d[1])
        collect(d[0] + d[2], d[1] + d[3])
      } else if (it.kind === 'circle') {
        collect(d[0] - d[2], d[1] - d[2])
        collect(d[0] + d[2], d[1] + d[2])
      } else if (it.kind === 'handle') {
        var hp = self._state[d]
        collect(hp[0], hp[1])
      } else if (it.kind === 'text') collect(d[0], d[1])
    })
    if (!finite(x0) || !finite(x1)) {
      var xr = autoRange(xs, logX)
      if (!finite(x0)) x0 = xr[0]
      if (!finite(x1)) x1 = xr[1]
    }
    if (logX && x0 <= 0) x0 = Math.max(1e-12, x1 / 1e6)
    var tx = function (v) {
      return logX ? Math.log10(v) : v
    }
    var X0 = tx(x0)
    var X1 = tx(x1)
    var samples = Math.max(200, Math.min(1200, Math.round(w * 1.5)))
    var sampled = {}
    this.list.forEach(function (it) {
      if (it.kind !== 'fn' && it.kind !== 'area') return
      var f = it.kind === 'fn' ? it.data : it.data.f
      var a = it.kind === 'area' ? it.data.a : x0
      var b = it.kind === 'area' ? it.data.b : x1
      var pts = []
      for (var i = 0; i <= samples; i++) {
        var t = tx(a) + ((tx(b) - tx(a)) * i) / samples
        var x = logX ? Math.pow(10, t) : t
        var y
        try {
          y = f(x)
        } catch (e) {
          // a pole is fine (NaN); a mistake in the code is not
          if (e instanceof ReferenceError || e instanceof TypeError || e instanceof SyntaxError) throw e
          y = NaN
        }
        pts.push([x, y])
        if (it.kind === 'fn') ys.push(y)
        else {
          ys.push(y)
          ys.push(0)
        }
      }
      sampled[it.i] = pts
    })
    var y0 = o.yMin
    var y1 = o.yMax
    if (!finite(y0) || !finite(y1)) {
      var yr = autoRange(ys, logY)
      if (!finite(y0)) y0 = yr[0]
      if (!finite(y1)) y1 = yr[1]
    }
    if (logY && y0 <= 0) y0 = Math.max(1e-16, y1 / 1e12)
    if (o.equal && !logX && !logY) {
      var ux = w / (x1 - x0)
      var uy = h / (y1 - y0)
      if (ux > uy) {
        var needX = w / uy - (x1 - x0)
        x0 -= needX / 2
        x1 += needX / 2
      } else {
        var needY = h / ux - (y1 - y0)
        y0 -= needY / 2
        y1 += needY / 2
      }
      X0 = tx(x0)
      X1 = tx(x1)
    }
    var ty = function (v) {
      return logY ? Math.log10(v) : v
    }
    var Y0 = ty(y0)
    var Y1 = ty(y1)
    var X = function (v) {
      return m.left + ((tx(v) - X0) / (X1 - X0)) * w
    }
    var Y = function (v) {
      return m.top + h - ((ty(v) - Y0) / (Y1 - Y0)) * h
    }
    var IX = function (px) {
      var t = X0 + ((px - m.left) / w) * (X1 - X0)
      return logX ? Math.pow(10, t) : t
    }
    var IY = function (py) {
      var t = Y0 + ((m.top + h - py) / h) * (Y1 - Y0)
      return logY ? Math.pow(10, t) : t
    }
    this.scale = { x: X, y: Y, ix: IX, iy: IY, xMin: x0, xMax: x1, yMin: y0, yMax: y1 }

    var defs = sv('defs', {}, svg)
    var clip = sv('clipPath', { id: this.id }, defs)
    sv('rect', { x: m.left, y: m.top, width: w, height: h }, clip)

    if (axes) {
      var xt = logX ? logTicks(x0, x1) : niceTicks(x0, x1, Math.max(3, Math.round(w / 90)))
      var yt = logY ? logTicks(y0, y1) : niceTicks(y0, y1, Math.max(3, Math.round(h / 55)))
      var grid = sv('g', { class: 'k-grid' }, svg)
      xt.forEach(function (t) {
        var px = X(t)
        if (px < m.left - 0.5 || px > m.left + w + 0.5) return
        sv('line', { x1: px, x2: px, y1: m.top, y2: m.top + h }, grid)
        sv('text', { x: px, y: m.top + h + 17, 'text-anchor': 'middle', class: 'k-tick' }, svg).textContent = fmt(t)
      })
      yt.forEach(function (t) {
        var py = Y(t)
        if (py < m.top - 0.5 || py > m.top + h + 0.5) return
        sv('line', { x1: m.left, x2: m.left + w, y1: py, y2: py }, grid)
        sv('text', { x: m.left - 7, y: py + 4, 'text-anchor': 'end', class: 'k-tick' }, svg).textContent = fmt(t)
      })
      if (!logY && y0 < 0 && y1 > 0) sv('line', { x1: m.left, x2: m.left + w, y1: Y(0), y2: Y(0), class: 'k-base' }, svg)
      if (!logX && x0 < 0 && x1 > 0) sv('line', { x1: X(0), x2: X(0), y1: m.top, y2: m.top + h, class: 'k-base' }, svg)
      sv('line', { x1: m.left, x2: m.left + w, y1: m.top + h, y2: m.top + h, class: 'k-base' }, svg)
      if (o.xLabel) sv('text', { x: m.left + w, y: m.top + h - 6, 'text-anchor': 'end', class: 'k-axis-label' }, svg).textContent = o.xLabel
      if (o.yLabel) sv('text', { x: m.left + 6, y: m.top + 12, class: 'k-axis-label' }, svg).textContent = o.yLabel
    }

    var plotG = sv('g', { 'clip-path': 'url(#' + this.id + ')' }, svg)
    var topG = sv('g', {}, svg)
    var lim = h * 4
    var pathD = function (pts) {
      var d = ''
      var pen = false
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0]
        var y = pts[i][1]
        if (!finite(x) || !finite(y) || (logY && y <= 0) || (logX && x <= 0)) {
          pen = false
          continue
        }
        var px = X(x)
        var py = Y(y)
        if (py < m.top - lim || py > m.top + h + lim) {
          pen = false
          continue
        }
        d += (pen ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1)
        pen = true
      }
      return d
    }
    var legend = []
    var series = 0
    var stroke = function (it) {
      var c = color(it.o.color, series)
      return c
    }
    var lineAttrs = function (it, c) {
      return { fill: 'none', stroke: c, 'stroke-width': it.o.width || 2, 'stroke-dasharray': it.o.dash ? '6 5' : null, opacity: it.o.opacity, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }
    }
    var heads = []
    this.list.forEach(function (it) {
      var d = it.data
      var o2 = it.o
      var auto = o2.color === undefined
      var c = stroke(it)
      var g = o2.over ? topG : plotG
      switch (it.kind) {
        case 'fn':
        case 'path':
          sv('path', Object.assign({ d: pathD(it.kind === 'fn' ? sampled[it.i] : d) }, lineAttrs(it, c)), g)
          break
        case 'area': {
          var pts = sampled[it.i].filter(function (p) {
            return finite(p[1])
          })
          if (pts.length) {
            var base = logY ? y0 : 0
            var dd = 'M' + X(pts[0][0]) + ',' + Y(base)
            pts.forEach(function (p) {
              dd += 'L' + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)
            })
            dd += 'L' + X(pts[pts.length - 1][0]) + ',' + Y(base) + 'Z'
            sv('path', { d: dd, fill: c, opacity: o2.opacity !== undefined ? o2.opacity : 0.22, stroke: 'none' }, g)
          }
          break
        }
        case 'points':
          d.forEach(function (p) {
            if (finite(p[0]) && finite(p[1]) && (!logY || p[1] > 0)) sv('circle', { cx: X(p[0]), cy: Y(p[1]), r: o2.r || 3.5, fill: o2.hollow ? '#0b0b0b' : c, stroke: c, 'stroke-width': 1.5, opacity: o2.opacity }, g)
          })
          break
        case 'stems':
          d.forEach(function (p) {
            if (!finite(p[0]) || !finite(p[1])) return
            sv('line', { x1: X(p[0]), x2: X(p[0]), y1: Y(logY ? y0 : 0), y2: Y(p[1]), stroke: c, 'stroke-width': o2.width || 1.5, opacity: o2.opacity }, g)
            sv('circle', { cx: X(p[0]), cy: Y(p[1]), r: o2.r || 3, fill: c }, g)
          })
          break
        case 'bars': {
          var bw = o2.barWidth || (d.length > 1 ? Math.abs(d[1][0] - d[0][0]) * 0.8 : (x1 - x0) * 0.05)
          d.forEach(function (p) {
            if (!finite(p[0]) || !finite(p[1])) return
            var ya = Y(logY ? y0 : 0)
            var yb = Y(p[1])
            sv('rect', { x: X(p[0] - bw / 2), y: Math.min(ya, yb), width: Math.max(1, X(p[0] + bw / 2) - X(p[0] - bw / 2)), height: Math.abs(ya - yb), fill: c, opacity: o2.opacity !== undefined ? o2.opacity : 0.85 }, g)
          })
          break
        }
        case 'segment':
          if (o2.head) heads.push({ d: d, c: c, w: o2.width || 2, o: o2, g: g })
          else sv('line', Object.assign({ x1: X(d[0]), y1: Y(d[1]), x2: X(d[2]), y2: Y(d[3]) }, lineAttrs(it, c)), g)
          break
        case 'vline':
          sv('line', Object.assign({ x1: X(d), x2: X(d), y1: m.top, y2: m.top + h }, lineAttrs(it, o2.color === undefined ? NAMED.muted : c), { 'stroke-width': o2.width || 1, 'stroke-dasharray': o2.dash === false ? null : '4 4' }), g)
          if (o2.label) sv('text', { x: X(d) + 4, y: m.top + 12, class: 'k-note', fill: o2.color === undefined ? NAMED.muted : c }, g).textContent = o2.label
          break
        case 'hline':
          sv('line', Object.assign({ x1: m.left, x2: m.left + w, y1: Y(d), y2: Y(d) }, lineAttrs(it, o2.color === undefined ? NAMED.muted : c), { 'stroke-width': o2.width || 1, 'stroke-dasharray': o2.dash === false ? null : '4 4' }), g)
          if (o2.label) sv('text', { x: m.left + w - 4, y: Y(d) - 5, 'text-anchor': 'end', class: 'k-note', fill: o2.color === undefined ? NAMED.muted : c }, g).textContent = o2.label
          break
        case 'rect': {
          var rx = Math.min(X(d[0]), X(d[0] + d[2]))
          var ry = Math.min(Y(d[1]), Y(d[1] + d[3]))
          sv('rect', { x: rx, y: ry, width: Math.abs(X(d[0] + d[2]) - X(d[0])), height: Math.abs(Y(d[1] + d[3]) - Y(d[1])), fill: o2.fill ? color(o2.fill) : 'none', 'fill-opacity': o2.fill ? (o2.opacity !== undefined ? o2.opacity : 0.25) : null, stroke: o2.stroke === false ? 'none' : c, 'stroke-width': o2.width || 1.5, rx: o2.radius || 0 }, g)
          if (o2.label) sv('text', { x: rx + Math.abs(X(d[0] + d[2]) - X(d[0])) / 2, y: ry + Math.abs(Y(d[1] + d[3]) - Y(d[1])) / 2 + 4, 'text-anchor': 'middle', class: 'k-label' }, g).textContent = o2.label
          break
        }
        case 'circle': {
          var rpx = Math.abs(X(d[0] + d[2]) - X(d[0]))
          var rpy = Math.abs(Y(d[1] + d[2]) - Y(d[1]))
          sv('ellipse', { cx: X(d[0]), cy: Y(d[1]), rx: rpx, ry: rpy, fill: o2.fill ? color(o2.fill) : 'none', 'fill-opacity': o2.fill ? (o2.opacity !== undefined ? o2.opacity : 0.25) : null, stroke: o2.stroke === false ? 'none' : c, 'stroke-width': o2.width || 1.5, 'stroke-dasharray': o2.dash ? '6 5' : null }, g)
          break
        }
        case 'text':
          sv(
            'text',
            {
              x: X(d[0]) + (o2.dx || 0),
              y: Y(d[1]) + (o2.dy || 0),
              'text-anchor': o2.anchor || 'start',
              class: 'k-label',
              fill: o2.color !== undefined ? c : null,
              'font-size': o2.size || null
            },
            o2.under ? plotG : topG
          ).textContent = d[2]
          auto = false
          break
        case 'field': {
          var n = o2.n || 15
          var cells = []
          var maxL = 0
          for (var i = 0; i < n; i++)
            for (var j = 0; j < n; j++) {
              var fx = x0 + ((i + 0.5) * (x1 - x0)) / n
              var fy = y0 + ((j + 0.5) * (y1 - y0)) / n
              var v = d(fx, fy)
              var L = Math.hypot(v[0], v[1])
              if (finite(L)) {
                cells.push([fx, fy, v[0], v[1], L])
                if (L > maxL) maxL = L
              }
            }
          var cell = Math.min(w, h) / n
          cells.forEach(function (q) {
            if (!(q[4] > 0)) return
            var len = cell * 0.42 * (o2.normalize === false ? q[4] / maxL : 1)
            var px = X(q[0])
            var py = Y(q[1])
            var ux2 = (q[2] / q[4]) * ((w / (x1 - x0)) / (h / (y1 - y0)))
            var uy2 = q[3] / q[4]
            var nn = Math.hypot(ux2, uy2)
            ux2 /= nn
            uy2 /= nn
            arrowPx(g, px - (ux2 * len) / 2, py + (uy2 * len) / 2, px + (ux2 * len) / 2, py - (uy2 * len) / 2, o2.color === undefined ? NAMED.muted : c, 1.2, 4)
          })
          auto = false
          break
        }
        case 'heat': {
          var nh = o2.n || 48
          var vals = []
          var lo = Infinity
          var hi = -Infinity
          for (var a = 0; a < nh; a++)
            for (var b = 0; b < nh; b++) {
              var hx = x0 + ((a + 0.5) * (x1 - x0)) / nh
              var hy = y0 + ((b + 0.5) * (y1 - y0)) / nh
              var hv = d(hx, hy)
              vals.push([a, b, hv])
              if (finite(hv)) {
                lo = Math.min(lo, hv)
                hi = Math.max(hi, hv)
              }
            }
          if (finite(o2.min)) lo = o2.min
          if (finite(o2.max)) hi = o2.max
          var cw = w / nh
          var ch = h / nh
          var diverging = o2.diverging !== undefined ? o2.diverging : lo < 0 && hi > 0
          vals.forEach(function (q) {
            if (!finite(q[2])) return
            var fill
            var op
            if (diverging) {
              var s = Math.max(Math.abs(lo), Math.abs(hi)) || 1
              var tt = clamp(q[2] / s, -1, 1)
              fill = tt >= 0 ? NAMED.brand : PALETTE[0]
              op = Math.abs(tt) * 0.85
            } else {
              fill = o2.color !== undefined ? c : PALETTE[0]
              op = hi > lo ? clamp((q[2] - lo) / (hi - lo), 0, 1) * 0.9 : 0.5
            }
            sv('rect', { x: m.left + q[0] * cw, y: m.top + h - (q[1] + 1) * ch, width: cw + 0.6, height: ch + 0.6, fill: fill, 'fill-opacity': op.toFixed(3) }, g)
          })
          auto = false
          break
        }
        case 'level': {
          var nl = o2.n || 64
          var grid2 = []
          for (var gi = 0; gi <= nl; gi++) {
            var row = []
            for (var gj = 0; gj <= nl; gj++) row.push(d.F(x0 + ((x1 - x0) * gi) / nl, y0 + ((y1 - y0) * gj) / nl))
            grid2.push(row)
          }
          d.levels.forEach(function (lv, li) {
            var segs = marching(grid2, nl, lv)
            var dd2 = ''
            segs.forEach(function (sg) {
              var ax = X(x0 + ((x1 - x0) * sg[0]) / nl)
              var ay = Y(y0 + ((y1 - y0) * sg[1]) / nl)
              var bx = X(x0 + ((x1 - x0) * sg[2]) / nl)
              var by = Y(y0 + ((y1 - y0) * sg[3]) / nl)
              dd2 += 'M' + ax.toFixed(1) + ',' + ay.toFixed(1) + 'L' + bx.toFixed(1) + ',' + by.toFixed(1)
            })
            sv('path', { d: dd2, fill: 'none', stroke: o2.color !== undefined ? c : color(li), 'stroke-width': o2.width || 1.5, 'stroke-dasharray': o2.dash ? '6 5' : null }, g)
          })
          if (o2.color === undefined) series += d.levels.length - 1
          break
        }
        case 'handle':
          auto = false
          break
      }
      if (o2.label && ['fn', 'path', 'points', 'stems', 'bars', 'area', 'level', 'segment'].indexOf(it.kind) >= 0) legend.push({ label: o2.label, c: c, dash: !!o2.dash, dot: it.kind === 'points' || it.kind === 'stems' })
      if (auto && ['fn', 'path', 'points', 'stems', 'bars', 'area', 'level'].indexOf(it.kind) >= 0) series++
    })
    heads.forEach(function (a) {
      arrowPx(a.g, X(a.d[0]), Y(a.d[1]), X(a.d[2]), Y(a.d[3]), a.c, a.w, 9, a.o.dash)
    })

    // handles: drawn on top, dragged with the pointer
    this.handles.forEach(function (hd) {
      var p = self._state[hd.name]
      var c = color(hd.o.color === undefined ? 'brand' : hd.o.color)
      var g = sv('g', { class: 'k-handle' }, topG)
      sv('circle', { cx: X(p[0]), cy: Y(p[1]), r: 13, fill: 'transparent' }, g)
      sv('circle', { cx: X(p[0]), cy: Y(p[1]), r: hd.o.r || 6, fill: c, stroke: '#0b0b0b', 'stroke-width': 2 }, g)
      if (hd.o.label) sv('text', { x: X(p[0]) + 10, y: Y(p[1]) - 9, class: 'k-label' }, g).textContent = hd.o.label
      g.addEventListener('pointerdown', function (e) {
        e.preventDefault()
        self._drag = hd
        try {
          svg.setPointerCapture(e.pointerId)
        } catch (err) {
          /* fine */
        }
      })
    })
    if (!this._bound) {
      this._bound = true
      svg.addEventListener('pointermove', function (e) {
        var hd = self._drag
        if (!hd) return
        var r = svg.getBoundingClientRect()
        var s = self.scale
        var nx = s.ix(clamp(e.clientX - r.left, m.left, m.left + w))
        var ny = s.iy(clamp(e.clientY - r.top, m.top, m.top + h))
        var p = self._state[hd.name]
        var ax = hd.o.axis || 'xy'
        var q = [ax.indexOf('x') >= 0 ? nx : p[0], ax.indexOf('y') >= 0 ? ny : p[1]]
        if (typeof hd.o.snap === 'function') q = hd.o.snap(q[0], q[1]) || q
        if (finite(hd.o.step))
          q = q.map(function (v) {
            return Math.round(v / hd.o.step) * hd.o.step
          })
        self._state[hd.name] = [q[0], q[1]]
        self._redraw()
      })
      var end = function () {
        self._drag = null
      }
      svg.addEventListener('pointerup', end)
      svg.addEventListener('pointercancel', end)
    }

    this.legendEl.innerHTML = ''
    this.legendEl.style.display = legend.length ? '' : 'none'
    legend.forEach(function (l) {
      var item = el('span', 'k-legend-item', self.legendEl)
      var key = el('span', 'k-legend-key' + (l.dash ? ' dashed' : '') + (l.dot ? ' dot' : ''), item)
      key.style.background = l.dash ? 'none' : l.c
      key.style.borderColor = l.c
      el('span', null, item).textContent = l.label
    })
  }

  function arrowPx(g, ax, ay, bx, by, c, width, head, dash) {
    var len = Math.hypot(bx - ax, by - ay)
    if (!(len > 1)) return
    var ux = (bx - ax) / len
    var uy = (by - ay) / len
    var hh = Math.min(head, len * 0.45)
    sv('line', { x1: ax, y1: ay, x2: bx - hh * 0.6 * ux, y2: by - hh * 0.6 * uy, stroke: c, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-dasharray': dash ? '6 5' : null }, g)
    var p2 = bx - hh * ux + hh * 0.45 * uy + ',' + (by - hh * uy - hh * 0.45 * ux)
    var p3 = bx - hh * ux - hh * 0.45 * uy + ',' + (by - hh * uy + hh * 0.45 * ux)
    sv('polygon', { points: bx + ',' + by + ' ' + p2 + ' ' + p3, fill: c }, g)
  }

  // level lines by marching squares on a (n+1)x(n+1) grid, in grid coordinates
  function marching(G, n, lv) {
    var out = []
    var lerp = function (a, b) {
      var d = b - a
      return d === 0 ? 0.5 : (lv - a) / d
    }
    for (var i = 0; i < n; i++)
      for (var j = 0; j < n; j++) {
        var a = G[i][j]
        var b = G[i + 1][j]
        var c = G[i + 1][j + 1]
        var d = G[i][j + 1]
        if (!(finite(a) && finite(b) && finite(c) && finite(d))) continue
        var pts = []
        if (a < lv !== b < lv) pts.push([i + lerp(a, b), j])
        if (b < lv !== c < lv) pts.push([i + 1, j + lerp(b, c)])
        if (c < lv !== d < lv) pts.push([i + 1 - lerp(c, d), j + 1])
        if (d < lv !== a < lv) pts.push([i, j + 1 - lerp(d, a)])
        if (pts.length === 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
        else if (pts.length === 4) {
          out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
          out.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]])
        }
      }
    return out
  }

  /** A free panel for non-plot pictures: rows of cells (memory, arrays, registers), bits, tags, html. */
  function Panel(opts) {
    this.o = opts || {}
    this.node = el('div', 'k-view k-panel')
    if (this.o.title) el('div', 'k-view-title', this.node).textContent = this.o.title
    this.body = el('div', 'k-panel-body', this.node)
    if (this.o.height) this.body.style.minHeight = this.o.height + 'px'
  }
  Panel.prototype._clear = function () {
    this.body.innerHTML = ''
  }
  Panel.prototype.cells = function (values, o) {
    o = o || {}
    var wrap = el('div', 'k-cells-wrap', this.body)
    if (o.title) el('div', 'k-cells-title', wrap).textContent = o.title
    var row = el('div', 'k-cells', wrap)
    var hl = o.highlight || {}
    values.forEach(function (v, i) {
      var c = el('div', 'k-cell', row)
      var tone = Array.isArray(hl) ? (hl.indexOf(i) >= 0 ? 'brand' : null) : hl[i]
      if (tone) {
        c.classList.add('on')
        c.style.borderColor = color(tone)
        c.style.color = color(tone)
      }
      if (o.width) c.style.minWidth = o.width + 'px'
      el('div', 'k-cell-v', c).textContent = v === null || v === undefined ? '' : String(v)
      var lab = o.labels ? o.labels[i] : o.index ? (typeof o.index === 'function' ? o.index(i) : i) : null
      if (lab !== null && lab !== undefined) el('div', 'k-cell-i', c).textContent = String(lab)
    })
    return this
  }
  Panel.prototype.bits = function (value, width, o) {
    o = o || {}
    width = width || 8
    var bits = []
    var v = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)) || 0)
    if (v < 0n) v = (1n << BigInt(width)) + v
    for (var i = width - 1; i >= 0; i--) bits.push(Number((v >> BigInt(i)) & 1n))
    var groups = o.groups || null
    var hl = {}
    if (groups) {
      var at = 0
      groups.forEach(function (gsz, gi) {
        for (var k = 0; k < gsz; k++) hl[at + k] = gi
        at += gsz
      })
    }
    var wrap = el('div', 'k-cells-wrap', this.body)
    if (o.title) el('div', 'k-cells-title', wrap).textContent = o.title
    var row = el('div', 'k-cells k-bits', wrap)
    bits.forEach(function (b, i) {
      var c = el('div', 'k-cell' + (b ? ' one' : ''), row)
      if (groups) c.style.borderBottom = '2px solid ' + color(hl[i])
      if (groups && i > 0 && hl[i] !== hl[i - 1]) c.style.marginLeft = '8px'
      el('div', 'k-cell-v', c).textContent = String(b)
      if (o.index !== false) el('div', 'k-cell-i', c).textContent = String(width - 1 - i)
    })
    if (o.labels && groups) {
      var lr = el('div', 'k-tags', wrap)
      o.labels.forEach(function (l, gi) {
        var t = el('span', 'k-tag', lr)
        t.style.borderColor = color(gi)
        t.textContent = l
      })
    }
    return this
  }
  Panel.prototype.tags = function (items) {
    var row = el('div', 'k-tags', this.body)
    items.forEach(function (t, i) {
      var o = typeof t === 'object' ? t : { label: t }
      var s = el('span', 'k-tag', row)
      if (o.color !== undefined) {
        s.style.borderColor = color(o.color, i)
        s.style.color = color(o.color, i)
      }
      s.textContent = o.label
    })
    return this
  }
  Panel.prototype.html = function (s) {
    var d = el('div', 'k-html', this.body)
    d.innerHTML = s
    return d
  }
  Panel.prototype.text = function (s) {
    el('div', 'k-text', this.body).textContent = s
    return this
  }

  function plot(o) {
    return { kind: 'plot', o: o || {} }
  }
  function panel(o) {
    return { kind: 'panel', o: o || {} }
  }

  // ---------------------------------------------------------------- the demo
  var mounted = false
  function demo(spec) {
    if (mounted) throw new Error('K.demo can be called once per widget')
    mounted = true
    spec = spec || {}
    var root = document.getElementById('k-root') || el('div', null, document.body)
    var state = {}
    var params = spec.params || {}
    var viewSpecs = spec.views || (spec.view ? [spec.view] : spec.plot ? [plot(spec.plot)] : [plot({})])
    if (!Array.isArray(viewSpecs)) viewSpecs = [viewSpecs]
    var viewsEl = el('div', 'k-views' + (viewSpecs.length > 1 ? ' k-views-' + (spec.layout === 'column' ? 'col' : 'row') : ''), root)
    var views = viewSpecs.map(function (v) {
      var view = v && v.kind === 'panel' ? new Panel(v.o) : new Plot(v && v.kind === 'plot' ? v.o : v)
      view._state = state
      view._redraw = schedule
      viewsEl.appendChild(view.node)
      return view
    })
    var controls = el('div', 'k-controls', root)
    var readout = el('div', 'k-readout', root)

    // time: a play button that advances state.t
    var play = spec.play || spec.animate
    var playing = false
    var playBtn = null
    var tSlider = null
    if (play) {
      play = Object.assign({ from: 0, to: 10, speed: 1, loop: true, label: 't' }, play === true ? {} : play)
      state.t = play.from
      playing = !!play.autoplay
      playBtn = el('button', 'k-btn k-play', controls)
      playBtn.type = 'button'
      var tl = el('label', 'k-ctl', controls)
      el('span', 'k-ctl-label', tl).textContent = play.label
      tSlider = el('input', null, tl)
      tSlider.type = 'range'
      tSlider.min = play.from
      tSlider.max = play.to
      tSlider.step = (play.to - play.from) / 500
      tSlider.value = state.t
      var tv = el('span', 'k-val', tl)
      var syncT = function () {
        tSlider.value = state.t
        tv.textContent = fmt(state.t)
        playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play'
      }
      tSlider.addEventListener('input', function () {
        state.t = Number(tSlider.value)
        playing = false
        syncT()
        schedule()
      })
      playBtn.addEventListener('click', function () {
        if (!playing && state.t >= play.to) state.t = play.from
        playing = !playing
        syncT()
        last = null
        if (playing) requestAnimationFrame(tick)
      })
      syncT()
      var last = null
      var tick = function (ts) {
        if (!playing) return
        if (last !== null) {
          state.t += ((ts - last) / 1000) * play.speed
          if (state.t > play.to) {
            if (play.loop) state.t = play.from + ((state.t - play.from) % (play.to - play.from))
            else {
              state.t = play.to
              playing = false
            }
          }
        }
        last = ts
        syncT()
        draw()
        if (playing) requestAnimationFrame(tick)
      }
      if (playing) requestAnimationFrame(tick)
    }

    Object.keys(params).forEach(function (key) {
      var p = params[key]
      if (p === null || typeof p !== 'object' || !p.kind) {
        state[key] = p
        return
      }
      var label = p.label !== undefined ? p.label : key
      if (p.kind === 'slider') {
        state[key] = p.value
        var l = el('label', 'k-ctl', controls)
        el('span', 'k-ctl-label', l).textContent = label
        var inp = el('input', null, l)
        inp.type = 'range'
        var v = el('span', 'k-val', l)
        var toUi = function (x) {
          return p.log ? Math.log10(x) : x
        }
        var fromUi = function (u) {
          return p.log ? Math.pow(10, u) : u
        }
        inp.min = toUi(p.min)
        inp.max = toUi(p.max)
        inp.step = p.log ? (toUi(p.max) - toUi(p.min)) / 200 : p.step
        inp.value = toUi(p.value)
        var show = function () {
          v.textContent = p.fmt ? p.fmt(state[key]) : fmt(state[key])
        }
        show()
        inp.addEventListener('input', function () {
          var x = fromUi(Number(inp.value))
          if (!p.log && p.step) x = Number((Math.round((x - p.min) / p.step) * p.step + p.min).toPrecision(12))
          state[key] = x
          show()
          schedule()
        })
      } else if (p.kind === 'choice') {
        state[key] = p.value
        var wrap = el('span', 'k-ctl', controls)
        if (label) el('span', 'k-ctl-label', wrap).textContent = label
        var seg = el('span', 'k-seg', wrap)
        p.options.forEach(function (opt) {
          var b = el('button', state[key] === opt.value ? 'on' : '', seg)
          b.type = 'button'
          b.textContent = opt.label !== undefined ? opt.label : String(opt.value)
          b.addEventListener('click', function () {
            state[key] = opt.value
            Array.prototype.forEach.call(seg.children, function (c) {
              c.classList.remove('on')
            })
            b.classList.add('on')
            schedule()
          })
        })
      } else if (p.kind === 'toggle') {
        state[key] = p.value
        var tlab = el('label', 'k-ctl k-check', controls)
        var cb = el('input', null, tlab)
        cb.type = 'checkbox'
        cb.checked = p.value
        el('span', 'k-ctl-label', tlab).textContent = label
        cb.addEventListener('change', function () {
          state[key] = cb.checked
          schedule()
        })
      } else if (p.kind === 'button') {
        var bt = el('button', 'k-btn', controls)
        bt.type = 'button'
        bt.textContent = label
        bt.addEventListener('click', function () {
          if (typeof p.onClick === 'function') p.onClick(state)
          schedule()
        })
      }
    })
    if (!controls.children.length) controls.style.display = 'none'

    var out = function (label, value) {
      var item = el('span', 'k-out', readout)
      if (value === undefined) {
        item.textContent = String(label)
        return
      }
      el('span', null, item).textContent = label + ' '
      el('b', null, item).textContent = typeof value === 'number' ? fmt(value) : String(value)
    }
    out.note = function (s, tone) {
      var n = el('div', 'k-note-line', readout)
      if (tone) n.style.color = color(tone)
      n.textContent = s
    }
    out.table = function (headers, rows) {
      var t = el('table', 'k-table', readout)
      var hr = el('tr', null, el('thead', null, t))
      headers.forEach(function (hh) {
        el('th', null, hr).textContent = hh
      })
      var tb = el('tbody', null, t)
      rows.forEach(function (r) {
        var tr = el('tr', null, tb)
        r.forEach(function (c) {
          el('td', null, tr).textContent = typeof c === 'number' ? fmt(c) : String(c)
        })
      })
    }

    if (typeof spec.setup === 'function') spec.setup(state)

    var pending = false
    function schedule() {
      if (pending) return
      pending = true
      requestAnimationFrame(function () {
        pending = false
        draw()
      })
    }
    var drawnOnce = false
    function draw() {
      views.forEach(function (v) {
        if (v instanceof Plot) {
          v.list = []
          v.handles = []
        } else v._clear()
      })
      readout.innerHTML = ''
      try {
        if (typeof spec.draw === 'function') spec.draw(state, views.length === 1 ? views[0] : views, out)
        var width = viewsEl.clientWidth || document.documentElement.clientWidth || 600
        var each = views.length > 1 && spec.layout !== 'column' ? (width - 16 * (views.length - 1)) / views.length : width
        views.forEach(function (v) {
          if (v instanceof Plot) v._render(Math.max(160, Math.floor(each)))
        })
        viewsEl.style.display = ''
      } catch (e) {
        // a failed first draw leaves only the error; a later failure keeps the last good picture
        if (!drawnOnce) viewsEl.style.display = 'none'
        report(e)
      }
      if (viewsEl.style.display !== 'none') drawnOnce = true
      readout.style.display = readout.children.length ? '' : 'none'
      sendSize()
    }
    var lastW = 0
    new ResizeObserver(function () {
      var w = viewsEl.clientWidth
      if (Math.abs(w - lastW) > 1) {
        lastW = w
        schedule()
      }
    }).observe(viewsEl)
    draw()
  }

  window.K = {
    demo: demo,
    slider: slider,
    choice: choice,
    toggle: toggle,
    button: button,
    plot: plot,
    panel: panel,
    fmt: fmt,
    linspace: linspace,
    range: range,
    clamp: clamp,
    ode: ode,
    rand: rand,
    color: color,
    colors: PALETTE.slice(),
    _report: report
  }

  // keep the frame as tall as its content: after every draw, and on any later change in size
  var lastH = 0
  function sendSize() {
    var hgt = Math.ceil(document.documentElement.getBoundingClientRect().height)
    if (Math.abs(hgt - lastH) > 1) {
      lastH = hgt
      post({ type: 'widget-size', height: hgt })
    }
  }
  new ResizeObserver(sendSize).observe(document.documentElement)
  window.addEventListener('load', sendSize)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sendSize)
})()

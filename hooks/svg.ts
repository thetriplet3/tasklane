import type { Link, Status, Turn } from '../types'

// Svg is drawn isolated, so it follows the person's light or dark theme with its own media query.
export type Tone = 'amber' | 'blue' | 'gray' | 'green' | 'purple'

const TONES: Record<Tone, { fill: string; ink: string; solid: string; dFill: string; dInk: string; dSolid: string }> = {
  amber: { fill: '#FAEEDA', ink: '#854F0B', solid: '#BA7517', dFill: '#412402', dInk: '#FAC775', dSolid: '#EF9F27' },
  blue: { fill: '#E6F1FB', ink: '#0C447C', solid: '#378ADD', dFill: '#042C53', dInk: '#85B7EB', dSolid: '#378ADD' },
  gray: { fill: '#F1EFE8', ink: '#5F5E5A', solid: '#888780', dFill: '#2C2C2A', dInk: '#B4B2A9', dSolid: '#888780' },
  green: { fill: '#EAF3DE', ink: '#3B6D11', solid: '#639922', dFill: '#173404', dInk: '#97C459', dSolid: '#97C459' },
  purple: { fill: '#EEEDFE', ink: '#3C3489', solid: '#7F77DD', dFill: '#26215C', dInk: '#AFA9EC', dSolid: '#7F77DD' },
}

export const TONE_OF: Record<Status, Tone> = { you: 'amber', running: 'blue', parked: 'gray', done: 'green' }

const FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif`

const css = () => {
  const light = Object.entries(TONES)
    .map(([k, t]) => `.f-${k}{fill:${t.fill}}.i-${k}{fill:${t.ink}}.s-${k}{fill:${t.solid}}.l-${k}{stroke:${t.solid}}.g-${k}{stop-color:${t.solid}}`)
    .join('')
  const dark = Object.entries(TONES)
    .map(([k, t]) => `.f-${k}{fill:${t.dFill}}.i-${k}{fill:${t.dInk}}.s-${k}{fill:${t.dSolid}}.l-${k}{stroke:${t.dSolid}}.g-${k}{stop-color:${t.dSolid}}`)
    .join('')
  return `<style>text{${FONT}}.track{fill:#D3D1C7}.muted{fill:#5F5E5A}.line{stroke:#B4B2A9}.node{fill:#FFFFFF;stroke:#B4B2A9}.ink{fill:#2C2C2A}${light}@media (prefers-color-scheme:dark){.track{fill:#444441}.muted{fill:#B4B2A9}.line{stroke:#5F5E5A}.node{fill:#2C2C2A;stroke:#5F5E5A}.ink{fill:#F1EFE8}${dark}}</style>`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const doc = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${css()}${body}</svg>`

// About 6.4 px per character at 11 px.
const textWidth = (s: string, size = 11) => Math.ceil(s.length * size * 0.58)

export const pill = (label: string, tone: Tone) => {
  const w = textWidth(label) + 16
  return {
    source: doc(w, 20, `<rect x="0" y="1" width="${w}" height="18" rx="9" class="f-${tone}"/><text x="${w / 2}" y="14" font-size="11" font-weight="500" text-anchor="middle" class="i-${tone}">${esc(label)}</text>`),
    width: w,
    height: 20,
  }
}

// Outline glyphs drawn from primitives; the running one turns while something runs.
const glyph = (status: Status, isMoving = true) => {
  const t = TONE_OF[status]
  const stroke = `class="l-${t}" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`
  const shapes: Record<Status, string> = {
    you: `<path d="M5 9.5V5.5a1.2 1.2 0 0 1 2.4 0V9M7.4 8.5V4.3a1.2 1.2 0 0 1 2.4 0v4.2M9.8 8.6V5a1.2 1.2 0 0 1 2.4 0v5.8a4.6 4.6 0 0 1-4.6 4.6h-.4a4.6 4.6 0 0 1-3.9-2.2L2.4 11a1.2 1.2 0 0 1 2-1.3L5 10.6" ${stroke}/>`,
    running: `<g><circle cx="8" cy="8" r="6" ${stroke} stroke-dasharray="26 12"/>${isMoving ? '<animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1.4s" repeatCount="indefinite"/>' : ''}</g>`,
    parked: `<circle cx="8" cy="8" r="6.5" ${stroke}/><path d="M6.4 5.6v4.8M9.6 5.6v4.8" ${stroke}/>`,
    done: `<circle cx="8" cy="8" r="6.5" ${stroke}/><path d="M5.4 8.2l1.8 1.8 3.4-3.6" ${stroke}/>`,
  }
  return shapes[status]
}

export const icon = (status: Status, isMoving = true) => ({ source: doc(16, 16, glyph(status, isMoving)), width: 16, height: 16 })

export const bar = (fraction: number, tone: Tone, width = 220) => {
  const f = Math.max(0, Math.min(1, fraction))
  const filled = Math.max(f > 0 ? 3 : 0, Math.round(width * f))
  return {
    source: doc(width, 4, `<rect width="${width}" height="4" rx="2" class="track"/><rect width="${filled}" height="4" rx="2" class="s-${tone}"/>`),
    width,
    height: 4,
  }
}

// One column per turn, newest on the right; each column says its cost on hover.
export const spark = (turns: Turn[], width: number, label: (t: Turn) => string) => {
  const shown = turns.slice(-Math.max(8, Math.floor(width / 6)))
  const h = 40
  const max = Math.max(...shown.map(t => t.cost), 0.0001)
  // Bars stay thin when there are few turns, and line up from the right like a timeline.
  const step = Math.min(18, shown.length > 0 ? width / shown.length : width)
  const left = width - step * shown.length
  const cols = shown
    .map((t, i) => {
      const bh = Math.max(2, Math.round((t.cost / max) * (h - 4)))
      const x = Math.round(left + i * step + 1)
      const w = Math.max(2, Math.floor(step - 2))
      return `<rect x="${x}" y="${h - bh}" width="${w}" height="${bh}" rx="1.5" class="s-purple"><title>${esc(label(t))}</title></rect>`
    })
    .join('')
  const empty = shown.length === 0 ? `<text x="${width / 2}" y="24" font-size="11" text-anchor="middle" class="muted">Turn costs show here</text>` : ''
  return { source: doc(width, h, `${cols}${empty}`), width, height: h }
}

// This session in the middle, connected sessions around it, a line's weight by how many messages it carried.
export const graph = (me: string, links: Link[], width: number) => {
  const h = links.length === 0 ? 70 : 200
  const cx = width / 2
  const cy = h / 2
  const total = Math.max(1, ...links.map(l => l.sent + l.received))
  const rx = Math.min(width / 2 - 70, 220)
  const ry = h / 2 - 26
  const peers = links
    .map((l, i) => {
      const a = (i / links.length) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(a) * rx
      const y = cy + Math.sin(a) * ry
      const n = l.sent + l.received
      const sw = 1 + Math.round((n / total) * 4)
      const name = clip(l.name, 18)
      const w = textWidth(name) + 18
      const tip = esc(`${l.name}: ${l.sent} sent, ${l.received} received${l.card ? `, on ${l.card}` : ''}`)
      return `<g><title>${tip}</title><line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="l-purple" stroke-width="${sw}" stroke-opacity="0.55"/><rect x="${x - w / 2}" y="${y - 11}" width="${w}" height="22" rx="11" class="node" stroke-width="0.8"/><text x="${x}" y="${y + 4}" font-size="11" text-anchor="middle" class="ink">${esc(name)}</text><text x="${(cx + x) / 2}" y="${(cy + y) / 2 - 4}" font-size="10" text-anchor="middle" class="muted">→${l.sent} ←${l.received}</text></g>`
    })
    .join('')
  const meName = clip(me, 20)
  const mw = textWidth(meName, 12) + 22
  const center = `<rect x="${cx - mw / 2}" y="${cy - 13}" width="${mw}" height="26" rx="13" class="f-purple"/><text x="${cx}" y="${cy + 4}" font-size="12" font-weight="500" text-anchor="middle" class="i-purple">${esc(meName)}</text>`
  const none = links.length === 0 ? `<text x="${cx}" y="${cy + 30}" font-size="11" text-anchor="middle" class="muted">No messages with other sessions yet</text>` : ''
  return { source: doc(width, h, `${peers}${center}${none}`), width, height: h }
}

// A smooth line through the points (Catmull-Rom as cubic Béziers), never bulging past `floor`.
const curve = (pts: [number, number][], floor = Infinity) =>
  pts
    .map(([x, y], i) => {
      if (i === 0) return `M${x},${y}`
      const [x0, y0] = pts[Math.max(0, i - 2)]!
      const [x1, y1] = pts[i - 1]!
      const [x3, y3] = pts[Math.min(pts.length - 1, i + 1)]!
      return `C${x1 + (x - x0) / 6},${Math.min(floor, y1 + (y - y0) / 6)} ${x - (x3 - x1) / 6},${Math.min(floor, y - (y3 - y1) / 6)} ${x},${y}`
    })
    .join('')

export type Hero = {
  cost: string
  sub: string
  tokens: string
  mix: { input: number; cached: number; output: number }
  mixLabel: string
  today: string
  hours: { cost: number; label: string }[]
}

// The board's header: the session's cost large, its token mix, and the last 24 hours as an area, each hour titled.
export const hero = (h: Hero, width: number) => {
  const narrow = width < 560
  const height = narrow ? 210 : 128
  const colA = narrow ? width / 2 : width * 0.28
  const colB = narrow ? width / 2 : width * 0.26
  const big = Math.min(34, Math.floor((colA - 12) / (h.cost.length * 0.6)))
  const cap = (x: number, y: number, t: string) => `<text x="${x}" y="${y}" font-size="10.5" font-weight="600" letter-spacing="0.6" class="muted">${esc(t)}</text>`
  const a = `${cap(0, 16, 'SESSION COST')}<text x="0" y="${22 + big}" font-size="${big}" font-weight="600" class="ink">${esc(h.cost)}</text><text x="0" y="${42 + big}" font-size="11.5" class="muted">${esc(clip(h.sub, Math.floor(colA / 6.5)))}</text>`

  const bx = colA + 4
  const bw = colB - 16
  const sum = Math.max(1, h.mix.input + h.mix.cached + h.mix.output)
  let at = bx
  const seg = (n: number, tone: Tone, name: string) => {
    const w = (n / sum) * bw
    const r = `<rect x="${at}" y="58" width="${Math.max(n > 0 ? 2 : 0, w)}" height="8" class="s-${tone}"><title>${name}</title></rect>`
    at += w
    return r
  }
  const b = `${cap(bx, 16, 'TOKENS')}<text x="${bx}" y="44" font-size="22" font-weight="600" class="ink">${esc(h.tokens)}</text><clipPath id="mix"><rect x="${bx}" y="58" width="${bw}" height="8" rx="4"/></clipPath><rect x="${bx}" y="58" width="${bw}" height="8" rx="4" class="track"/><g clip-path="url(#mix)">${seg(h.mix.input, 'blue', 'new input')}${seg(h.mix.cached, 'purple', 'cache')}${seg(h.mix.output, 'green', 'output')}</g><text x="${bx}" y="84" font-size="10.5" class="muted">${esc(clip(h.mixLabel, Math.floor(bw / 5.6)))}</text>`

  const cx = narrow ? 0 : colA + colB + 8
  const cy = narrow ? 104 : 0
  const cw = width - cx
  const top = cy + 30
  const ch = narrow ? 76 : 76
  const max = Math.max(0.0001, ...h.hours.map(x => x.cost))
  const n = Math.max(1, h.hours.length - 1)
  const pts = h.hours.map((x, i): [number, number] => [cx + (i / n) * cw, top + ch - (x.cost / max) * (ch - 6)])
  const line = curve(pts, top + ch)
  const area = `${line}L${cx + cw},${top + ch}L${cx},${top + ch}Z`
  const slots = h.hours
    .map((x, i) => `<rect x="${cx + ((i - 0.5) / n) * cw}" y="${top}" width="${cw / n}" height="${ch}" fill="transparent"><title>${esc(x.label)}</title></rect>`)
    .join('')
  const last = pts.at(-1)
  const c = `${cap(cx, cy + 16, 'LAST 24 HOURS')}<text x="${cx + cw}" y="${cy + 16}" font-size="11.5" font-weight="600" text-anchor="end" class="ink">${esc(h.today)}</text><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="g-purple" stop-opacity="0.45"/><stop offset="1" class="g-purple" stop-opacity="0"/></linearGradient></defs><line x1="${cx}" y1="${top + ch}" x2="${cx + cw}" y2="${top + ch}" class="line" stroke-width="1"/><path d="${area}" fill="url(#fade)"/><path d="${line}" fill="none" class="l-purple" stroke-width="2" stroke-linecap="round"/>${last ? `<circle cx="${last[0] - 3}" cy="${last[1]}" r="3.5" class="s-purple"/>` : ''}<text x="${cx}" y="${top + ch + 14}" font-size="10" class="muted">24 h ago</text><text x="${cx + cw}" y="${top + ch + 14}" font-size="10" text-anchor="end" class="muted">now</text>${slots}`
  return { source: doc(width, height, `${a}${b}${c}`), width, height }
}

export type Slice = { name: string; cost: number; label: string }

const RING: Tone[] = ['blue', 'purple', 'amber', 'green', 'gray']

// Main chat and each subagent as slices of one ring, the total in the middle, a legend beside it.
export const ring = (total: string, slices: Slice[], width: number) => {
  const shown = slices.length > 6 ? [...slices.slice(0, 5), { name: `${slices.length - 5} more`, cost: slices.slice(5).reduce((n, x) => n + x.cost, 0), label: 'smaller subagents' }] : slices
  // A sliver gets a visible arc; the legend keeps the true share.
  const real = Math.max(0.0001, shown.reduce((n, x) => n + x.cost, 0))
  const drawn = shown.map(x => (x.cost > 0 ? Math.max(x.cost, real * 0.015) : 0))
  const sum = Math.max(0.0001, drawn.reduce((n, x) => n + x, 0))
  const r = 46
  const size = 2 * r + 20
  const height = Math.max(size, shown.length * 22 + 12)
  const cx = r + 10
  const cy = height / 2
  let a0 = -Math.PI / 2
  const arcs = shown
    .map((x, i) => {
      const f = drawn[i]! / sum
      const tone = i === 0 ? 'blue' : RING[1 + ((i - 1) % (RING.length - 1))]!
      // A slice that is the whole ring draws as a circle: an arc's ends would meet.
      if (f > 0.999) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="l-${tone}" stroke-width="14"><title>${esc(x.label)}</title></circle>`
      const a1 = a0 + f * Math.PI * 2
      const gap = f > 0.02 ? 0.025 : 0
      const p = (a: number) => `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`
      const d = `M${p(a0 + gap)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1 - gap)}`
      a0 = a1
      return `<path d="${d}" fill="none" class="l-${tone}" stroke-width="14"><title>${esc(x.label)}</title></path>`
    })
    .join('')
  const lx = size + 14
  const legend = shown
    .map((x, i) => {
      const tone = i === 0 ? 'blue' : RING[1 + ((i - 1) % (RING.length - 1))]!
      const y = cy - (shown.length * 22) / 2 + i * 22 + 15
      const share = (x.cost / real) * 100
      const pct = share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`
      return `<g><title>${esc(x.label)}</title><rect x="${lx}" y="${y - 9}" width="10" height="10" rx="3" class="s-${tone}"/><text x="${lx + 18}" y="${y}" font-size="12" class="ink">${esc(clip(x.name, Math.max(8, Math.floor((width - lx - 90) / 6.6))))}</text><text x="${width}" y="${y}" font-size="12" text-anchor="end" class="muted">${pct}</text></g>`
    })
    .join('')
  const mid = `<text x="${cx}" y="${cy + 2}" font-size="15" font-weight="600" text-anchor="middle" class="ink">${esc(total)}</text><text x="${cx}" y="${cy + 17}" font-size="9.5" text-anchor="middle" class="muted">all agents</text>`
  return { source: doc(width, height, `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="line" stroke-width="14" stroke-opacity="0.35"/>${arcs}${mid}${legend}`), width, height }
}

// A column's head: its glyph, name and count, its cost on the right, and its share of the session as an accent line.
export const colHead = (status: Status, name: string, count: number, sum: string, share: number, width: number) => {
  const t = TONE_OF[status]
  const nw = textWidth(name, 13) + 6
  const badge = String(count)
  const bw = Math.max(20, textWidth(badge, 11) + 12)
  const f = Math.max(0, Math.min(1, share))
  const body = `<g transform="translate(0,3)">${glyph(status, count > 0)}</g><text x="24" y="16" font-size="13" font-weight="600" class="i-${t}">${esc(name)}</text><rect x="${24 + nw}" y="5" width="${bw}" height="16" rx="8" class="f-${t}"/><text x="${24 + nw + bw / 2}" y="16.5" font-size="11" font-weight="600" text-anchor="middle" class="i-${t}">${badge}</text><text x="${width}" y="16" font-size="12" text-anchor="end" class="muted">${esc(sum)}</text><rect x="0" y="27" width="${width}" height="3" rx="1.5" class="track" opacity="0.6"/><rect x="0" y="27" width="${Math.max(f > 0 ? 3 : 0, width * f)}" height="3" rx="1.5" class="s-${t}"/>`
  return { source: doc(width, 30, body), width, height: 30 }
}

export type Strip = { status: Status; label: string; when: string; cost: string; meta: string; fraction: number; isRunning: boolean }

// What a card says under its title: status, age and cost on one line, a cost bar that shimmers while it runs, then its size.
export const strip = (c: Strip, width: number) => {
  const t = TONE_OF[c.status]
  const pw = textWidth(c.label, 10.5) + 14
  const f = Math.max(0, Math.min(1, c.fraction))
  const filled = Math.max(f > 0 ? 4 : 0, Math.round(width * f))
  const shimmer = c.isRunning
    ? `<clipPath id="cb"><rect width="${filled}" y="25" height="5" rx="2.5"/></clipPath><rect y="25" width="40" height="5" fill="#FFFFFF" opacity="0.45" clip-path="url(#cb)"><animate attributeName="x" from="-40" to="${filled}" dur="1.6s" repeatCount="indefinite"/></rect>`
    : ''
  const body = `<rect x="0" y="1" width="${pw}" height="16" rx="8" class="f-${t}"/><text x="${pw / 2}" y="12.5" font-size="10.5" font-weight="600" text-anchor="middle" class="i-${t}">${esc(c.label)}</text><text x="${pw + 8}" y="12.5" font-size="11" class="muted">${esc(clip(c.when, Math.floor((width - pw - 70) / 6)))}</text><text x="${width}" y="13" font-size="12.5" font-weight="600" text-anchor="end" class="ink">${esc(c.cost)}</text><rect y="25" width="${width}" height="5" rx="2.5" class="track" opacity="0.6"/><rect y="25" width="${filled}" height="5" rx="2.5" class="s-${t}"/>${shimmer}<text x="0" y="45" font-size="10.5" class="muted">${esc(clip(c.meta, Math.floor(width / 5.8)))}</text>`
  return { source: doc(width, 50, body), width, height: 50 }
}

// An empty column: a dashed outline with a quiet line in it.
export const empty = (text: string, width: number) => {
  const body = `<rect x="1" y="1" width="${width - 2}" height="40" rx="8" fill="none" class="line" stroke-width="1" stroke-dasharray="4 4"/><text x="${width / 2}" y="25" font-size="11.5" text-anchor="middle" class="muted">${esc(text)}</text>`
  return { source: doc(width, 42, body), width, height: 42 }
}

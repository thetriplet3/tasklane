import type { Board, Card, Link, Status } from '../types'

// Acknowledgements and status checks: they belong to the task in progress, never a new card.
const FOLLOW_UP =
  /^(ok(ay)?|yes|yeah|yea|yep|sure|go ah?ead|continue|proceed|do it|done|ready|logged in|thanks?|thank you|agreed|approved?|please (go ahead|start|fix|continue)|(what|how)('s| is| about)? (the )?(status|progress|next)|status|how about now|check( it)? now|what about now)\b/i

export const isFollowUp = (text: string): boolean =>
  FOLLOW_UP.test(text.trim()) && text.trim().split(/\s+/).length <= 8

// Peer messages carry the sender's sidebar name in their wrapper tag.
export const peerName = (text: string): string =>
  /from-name="([^"]+)"/.exec(text)?.[1] ?? 'another session'

// Subagent and teammate ids are not sessions.
export const isAgentId = (to: string): boolean => /^(a[0-9a-f]{8,}|agent[-_])/i.test(to)

export const emptyBoard = (session: string): Board => ({
  session,
  name: '',
  cards: [],
  links: [],
  rules: [],
  turns: [],
  baseline: 0,
  updated: 0,
})

// A board saved by an earlier version lacks the newer fields.
export const normalize = (b: Partial<Board> & { session: string }): Board => ({
  ...emptyBoard(b.session),
  ...b,
  cards: (b.cards ?? []).map(c => ({ ...c, since: c.since ?? c.started })),
})

export const withStatus = (c: Card, status: Status, now: number): Card =>
  c.status === status ? c : { ...c, status, since: now }

export const ago = (ms: number): string =>
  ms >= 86400000 ? `${Math.floor(ms / 86400000)} d` : ms >= 3600000 ? `${Math.floor(ms / 3600000)} h` : `${Math.max(1, Math.floor(ms / 60000))} min`

export const day = (at: number): string =>
  new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export const titleOf = (text: string): string => {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 70 ? `${line.slice(0, 67)}…` : line
}

export const newCard = (id: string, text: string, now: number): Card => ({
  id,
  title: titleOf(text),
  status: 'running',
  started: now,
  since: now,
  msgs: [text.slice(0, 280)],
  first: text.slice(0, 600),
  fold: 0,
  cost: 0,
  tokens: 0,
  input: 0,
  cached: 0,
  output: 0,
  ms: 0,
})

export const current = (b: Board): Card | undefined => b.cards.find(c => c.id === b.current)

export const patchCard = (b: Board, id: string | undefined, fn: (c: Card) => Card): Board =>
  id === undefined ? b : { ...b, cards: b.cards.map(c => (c.id === id ? fn(c) : c)) }

export const bumpLink = (b: Board, name: string, dir: 'sent' | 'received'): Board => {
  const had = b.links.find(l => l.name === name)
  const link: Link = { name, sent: 0, received: 0, ...had, card: current(b)?.title ?? had?.card, cardId: current(b)?.id ?? had?.cardId }
  link[dir] += 1
  return { ...b, links: [...b.links.filter(l => l.name !== name), link] }
}

// A turn that ends on a question waits for the person; any other end is done until the next message reopens it.
export const statusAfter = (answer: string): Card['status'] => (/\?\s*$/.test(answer.trim()) ? 'you' : 'done')

export const money = (usd: number): string => `$${usd.toFixed(2)}`

export const short = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

export const minutes = (ms: number): string =>
  ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

// One message of a session's past, as the transcript reader reports it.
export type Past = { at: number; text: string; cost: number; tokens: number; input?: number; cached?: number; output?: number; ms: number; asks: boolean; uuid?: string }

// The grouping model's answer: one `<number> | <title>` line per message that starts a task.
export const parseStarts = (answer: string): Map<number, string> =>
  new Map(
    [...answer.matchAll(/^\s*(\d+)\s*[|:.)-]\s*(.+?)\s*$/gm)].map(m => [Number(m[1]), titleOf(m[2]!)] as [number, string]),
  )

// Past messages become cards: a message the model marked opens one, every other joins the card before it.
export const pastCards = (past: Past[], starts: Map<number, string>): Card[] => {
  const cards: Card[] = []
  past.forEach((p, i) => {
    const ack = isFollowUp(p.text)
    const last = cards.at(-1)
    if (last && (ack || !starts.has(i))) {
      last.fold += ack ? 1 : 0
      if (!ack) last.msgs = [...last.msgs, p.text.slice(0, 280)].slice(-6)
      last.cost += p.cost
      last.tokens += p.tokens
      last.input = (last.input ?? 0) + (p.input ?? 0)
      last.cached = (last.cached ?? 0) + (p.cached ?? 0)
      last.output = (last.output ?? 0) + (p.output ?? 0)
      last.ms += p.ms
      last.since = p.at + p.ms
      return
    }
    cards.push({
      ...newCard(`h${p.at}`, p.text, p.at),
      // An empty title falls back to the message's first line.
      title: starts.get(i) || titleOf(p.text),
      row: p.uuid ?? '',
      status: 'done',
      since: p.at + p.ms,
      cost: p.cost,
      tokens: p.tokens,
      input: p.input ?? 0,
      cached: p.cached ?? 0,
      output: p.output ?? 0,
      ms: p.ms,
    })
  })
  return cards
}

// Uncached input, cache (read and written) and output tokens, summed.
export const split = (cards: Pick<Card, 'input' | 'cached' | 'output'>[]): string => {
  const sum = (k: 'input' | 'cached' | 'output') => cards.reduce((n, c) => n + (c[k] ?? 0), 0)
  return `new input ${short(sum('input'))} · cache ${short(sum('cached'))} · output ${short(sum('output'))}`
}

// A task matches when every word searched is in its title or messages.
export const matches = (c: Card, q: string): boolean => {
  const hay = `${c.title}\n${c.msgs.join('\n')}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}

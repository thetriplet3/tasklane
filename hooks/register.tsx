import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board } from '../types'
import {
  bumpLink,
  current,
  emptyBoard,
  isAgentId,
  isFollowUp,
  newCard,
  normalize,
  patchCard,
  peerName,
  statusAfter,
  withStatus,
} from './board'
import { readAgents } from './agents'
import { findRows, importHistory } from './history'
import { PANE, ROWS, change, rowKey } from './state'
import { drawPane } from './view'

// The scan lists what each file reads, so each file names the atoms it touches.
const board = atom({ plugin: 'tasklane', key: 'board' } as const, emptyBoard(''), { shape: 'board-2' })

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Tasklane' })

// The newest sidebar name the transcript holds; the transcript is too big to read whole.
const titleIn = async ($: EngineInterface, transcript: string): Promise<string | undefined> => {
  const ran = await $.process.run(['grep', '-o', '"customTitle":"[^"]*"', transcript]).catch(() => undefined)
  const last = (ran?.stdout ?? '').trim().split('\n').at(-1)
  return last ? /"customTitle":"([^"]*)"/.exec(last)?.[1] : undefined
}

const NAME = `Name the task in this coding session in at most 6 words, sentence case, no quotes or full stop.
Say what is being done (e.g. "Fix login redirect on Safari"), not what the person said.`

// A model-written title from what was said so far; it stays the message's own words until one comes back.
// shortcut: renamed each time a task ends a turn with new messages, one small-model call each; cap it if that adds up.
async function nameCard($: EngineInterface, id: string, answer: string) {
  const c = (await read($, board)).cards.find(x => x.id === id)
  if (!c || (c.named ?? 0) >= c.msgs.length) return
  const said = [c.first ?? '', ...c.msgs].filter((m, i, all) => m !== '' && all.indexOf(m) === i)
  const prompt = `${NAME}\n\nThe person wrote:\n${said.map(m => `- ${m.slice(0, 400)}`).join('\n')}${answer ? `\n\nClaude answered:\n${answer.slice(0, 800)}` : ''}`
  const reply = await $.model.complete({ model: 'haiku', prompt, maxTokens: 30 }).catch(() => undefined)
  const title = reply?.isAnswered ? reply.text.trim().split('\n')[0]!.replace(/^[\s"'“”]+|[\s"'“”.]+$/g, '').trim() : ''
  if (title === '' || title.length > 80) return
  await change($, b => patchCard(b, id, x => ({ ...x, title, named: x.msgs.length, first: x.first ?? x.msgs[0] })))
}

// Tasks typed before titles were model-written, newest first, from what was said alone.
async function nameBacklog($: EngineInterface) {
  const waiting = (await read($, board)).cards.filter(c => c.id.startsWith('t') && c.named === undefined).slice(-20).reverse()
  for (const c of waiting) await nameCard($, c.id, '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const session = await $.session.id()
    const saved = (await $.store.get(`board:${session}`)) as Board | undefined
    await update($, board, b => (b.session === session ? b : saved ? normalize(saved) : emptyBoard(session)))
    await $.command.register({ name: 'tasklane', description: 'Open Tasklane' })
    void open($)
    void importHistory($)
    void nameBacklog($)
    void readAgents($, session)
    return next(e)
  })

  on('command.run', { command: 'tasklane' }, async $ => {
    await open($)
    return { text: 'Tasklane opened.' }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const name = await titleIn($, e.transcript_path)
    if (name) await change($, b => (b.name === name ? b : { ...b, name }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (e.origin.kind === 'peer') {
      await change($, b => bumpLink(b, peerName(text), 'received'))
      return next(e)
    }
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!typed || e.isMeta || e.command || text === '' || text.startsWith('/')) return next(e)

    const now = await $.clock.now()
    const b = await read($, board)
    const active = current(b)
    let same = active !== undefined && isFollowUp(text)
    if (active !== undefined && !same) {
      // Only an unclear message costs a small-model call; a failure keeps it on the task in progress.
      const label = await $.model
        .classify(`Task in progress: ${active.title}\nNew message: ${text.slice(0, 600)}`, ['same task', 'new task'], { model: 'haiku' })
        .catch(() => 'same task')
      same = label !== 'new task'
    }

    const after = await change($, x => {
      if (same && active) {
        const ack = isFollowUp(text)
        return patchCard(x, active.id, c => ({
          ...withStatus(c, 'running', now),
          fold: c.fold + (ack ? 1 : 0),
          msgs: ack ? c.msgs : [...c.msgs, text.slice(0, 280)].slice(-6),
        }))
      }
      const card = newCard(`t${now}`, text, now)
      return { ...x, cards: [...x.cards, card], current: card.id }
    })

    // The person's standing rules ride along with every prompt they type.
    if (after.rules.length === 0) return next(e)
    const rules = `Standing rules the user set for this session (follow them without being reminded):\n${after.rules.map(r => `- ${r}`).join('\n')}`
    return next({ ...e, context: [...(e.context ?? []), rules] })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (String(e.tool) !== 'SendMessage' || ran.isError) return ran
    const to = String((e as { to?: unknown }).to ?? '')
    if (to !== '' && !isAgentId(to)) await change($, b => bumpLink(b, to, 'sent'))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    void readAgents($, await $.session.id())
    if (e.agentId !== undefined) return next(e)
    const usage = await $.session.usage()
    const now = await $.clock.now()
    const used = e.usage
    const tokens = used
      ? used.input_tokens + used.output_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
      : 0
    await change($, b => {
      const cost = usage.cost?.usd ?? b.baseline
      // A cost below the baseline means the engine started its ledger over.
      const turn = cost >= b.baseline ? cost - b.baseline : cost
      // A message sent mid-turn opens its own card, so one turn can end several: the work is shared among them.
      const ending = b.cards.filter(c => c.id === b.current || c.status === 'running').map(c => c.id)
      const n = Math.max(1, ending.length)
      const moved = {
        ...b,
        cards: b.cards.map(c => {
          if (!ending.includes(c.id)) return c
          // The answer is the newest card's; an older one the turn also worked on is done.
          const after = c.id === b.current ? statusAfter(e.answer) : 'done'
          const status = e.isAborted || c.status === 'parked' ? c.status : after
          return {
            ...withStatus(c, status, now),
            cost: c.cost + turn / n,
            tokens: c.tokens + tokens / n,
            input: (c.input ?? 0) + (used?.input_tokens ?? 0) / n,
            cached: (c.cached ?? 0) + (used ? used.cache_read_input_tokens + used.cache_creation_input_tokens : 0) / n,
            output: (c.output ?? 0) + (used?.output_tokens ?? 0) / n,
            ms: c.ms + e.durationMs / n,
          }
        }),
      }
      return { ...moved, baseline: cost, turns: [...moved.turns, { at: now, cost: turn, card: b.current }].slice(-500) }
    })
    const named = (await read($, board)).current
    if (named && !e.isAborted) void nameCard($, named, e.answer ?? '')
    void findRows($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($, e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    ROWS.set(rowKey(e.props.text), e.requestId)
    return next(e)
  }).catch(($, e, next) => next(e))

}

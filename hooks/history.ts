import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Board, Link, Turn } from '../types'
import { emptyBoard, isFollowUp, parseStarts, pastCards } from './board'
import type { Past } from './board'
import { ask, job } from './activity'
import { change } from './state'

const board = atom({ plugin: 'tasklane', key: 'board' } as const, emptyBoard(''), { shape: 'board-2' })

// What every transcript reader shares: list prices, a reply's usage, timestamps.
// shortcut: cost is estimated from token counts at list prices; the transcript keeps no billed cost.
export const PRICING = String.raw`import glob, json, os, re, sys
from datetime import datetime

# USD per million tokens: input, output, cache read. Writes cost 1.25x input (5 min) or 2x (1 h).
PRICES = [('fable', 10, 50, .25), ('mythos', 10, 50, .25), ('opus-5-5', 4, 20, .2), ('opus', 5, 25, .5),
          ('sonnet-5', 2, 10, .2), ('sonnet', 3, 15, .3), ('haiku-5-5', .1, .5, .01), ('haiku', 1, 5, .1)]

def price(model, u):
    for key, i, o, r in PRICES:
        if key in (model or ''):
            c = u.get('cache_creation') or {}
            w1 = c.get('ephemeral_1h_input_tokens', 0)
            w5 = u.get('cache_creation_input_tokens', 0) - w1
            return (u.get('input_tokens', 0) * i + u.get('output_tokens', 0) * o + u.get('cache_read_input_tokens', 0) * r
                    + w5 * i * 1.25 + w1 * i * 2) / 1e6
    return 0

def usage(m):
    u = m.get('usage') or {}
    its = u.get('iterations') or []
    if not its: return u
    tot = {}
    for it in its:
        for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'):
            tot[k] = tot.get(k, 0) + it.get(k, 0)
        cc = it.get('cache_creation') or {}
        tot.setdefault('cache_creation', {'ephemeral_1h_input_tokens': 0})
        tot['cache_creation']['ephemeral_1h_input_tokens'] += cc.get('ephemeral_1h_input_tokens', 0)
    return tot

def ms(ts):
    return int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp() * 1000)
`

// Reads the session's transcript file, which is too big to hand the module whole, into one line per message typed.
const READER = PRICING + String.raw`
session, before = sys.argv[1], int(sys.argv[2])
found = glob.glob(os.path.expanduser(f'~/.claude/projects/*/{session}.jsonl'))
if not found:
    print(json.dumps({'found': False})); sys.exit()

def text_of(content):
    if isinstance(content, str): return content
    if any(b.get('type') == 'tool_result' for b in content): return None
    return '\n'.join(b.get('text', '') for b in content if b.get('type') == 'text')

prompts, replies, sent, received, title = [], {}, {}, {}, ''
for line in open(found[0], encoding='utf-8', errors='replace'):
    if '"customTitle"' in line:
        t = re.search(r'"customTitle":"([^"]*)"', line)
        if t: title = t.group(1)
    if not line.startswith('{"') or ('"type":"user"' not in line and '"type":"assistant"' not in line): continue
    try: d = json.loads(line)
    except ValueError: continue
    if d.get('isSidechain') or 'timestamp' not in d: continue
    at = ms(d['timestamp'])
    if at >= before: continue
    m = d.get('message') or {}
    if d['type'] == 'user':
        text = text_of(m.get('content', ''))
        if text is None: continue
        for name in re.findall(r'<cross-session-message[^>]*from-name="([^"]+)"', text):
            received[name] = received.get(name, 0) + 1
        text = text.strip()
        if d.get('isMeta') or d.get('isCompactSummary') or text == '' or text.startswith('<') or text.startswith('[Request interrupted'):
            continue
        prompts.append({'at': at, 'uuid': d.get('uuid', ''), 'text': text[:400], 'end': at, 'cost': 0, 'tokens': 0, 'input': 0, 'cached': 0, 'output': 0, 'last': ''})
    elif prompts:
        p = prompts[-1]
        # A reply is written once per content block, each line repeating its usage: count it once.
        if m.get('id') not in replies:
            replies[m.get('id')] = True
            u = usage(m)
            p['cost'] += price(m.get('model'), u)
            p['tokens'] += sum(u.get(k, 0) for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'))
            p['input'] += u.get('input_tokens', 0)
            p['cached'] += u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
            p['output'] += u.get('output_tokens', 0)
        p['end'] = at
        for b in m.get('content') or []:
            if b.get('type') == 'text' and b.get('text', '').strip(): p['last'] = b['text'].strip()[-200:]
            if b.get('type') == 'tool_use' and b.get('name') == 'SendMessage':
                to = str((b.get('input') or {}).get('to', ''))
                if to and not re.match(r'^a[0-9a-f]{8,}', to): sent[to] = sent.get(to, 0) + 1

for p in prompts:
    p['ms'] = p.pop('end') - p['at']
    p['asks'] = p.pop('last').endswith('?')
print(json.dumps({'found': True, 'title': title, 'prompts': prompts, 'sent': sent, 'received': received}))
`

type Read = { found: false } | { found: true; title: string; prompts: Past[]; sent: Record<string, number>; received: Record<string, number> }

const ASK = `These are the messages a person typed into one long coding session, numbered, oldest first.
Split them into tasks: a task is one piece of work; follow-ups, answers to questions and corrections belong to the task before them.
Answer only with one line per message that starts a new task, as "<number> | <title of the task, at most 6 words>". Message 0 always starts one.`

// shortcut: tasks are cut where the subject changes, so going back to an older task opens a new card; merge cards if that matters.
async function groupPast($: EngineInterface, past: Past[]): Promise<Map<number, string>> {
  const starts = new Map<number, string>()
  const parts = Math.ceil(past.length / 250)
  for (let from = 0; from < past.length; from += 250) {
    await job($, 'history', 'running', `Sorting ${past.length} messages into tasks${parts > 1 ? `, part ${from / 250 + 1} of ${parts}` : ''}`)
    const part = past.slice(from, from + 250)
    const list = part.map((p, i) => `${i}: ${p.text.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')
    const reply = await ask($, 'sort', { model: 'haiku', prompt: `${ASK}\n\n${list}`, maxTokens: 4000 })
    // No answer: every message that is not a go-ahead opens its own card.
    const found = reply?.isAnswered ? parseStarts(reply.text) : new Map(part.flatMap((p, i) => (isFollowUp(p.text) ? [] : [[i, '']] as [number, string][])))
    if (!found.has(0)) found.set(0, '')
    for (const [i, title] of found) if (i < part.length) starts.set(from + i, title)
  }
  return starts
}

const merge = (links: Link[], counts: Record<string, number>, dir: 'sent' | 'received') =>
  Object.entries(counts).reduce((all, [name, n]) => {
    const had = all.find(l => l.name === name) ?? { name, sent: 0, received: 0 }
    return [...all.filter(l => l.name !== name), { ...had, [dir]: had[dir] + n }]
  }, links)

// Puts the session's messages from before the board loaded on it, once per board.
export async function importHistory($: EngineInterface) {
  const b = await read($, board)
  // Cards saved before the token split was kept get the split filled in from the transcript, their cards left as they are.
  const unsplit = b.cards.filter(c => c.input === undefined)
  // Imported cards saved before their chat row was kept get it from the transcript too.
  const unrowed = b.cards.filter(c => c.id.startsWith('h') && c.row === undefined)
  if ((b.imported && unsplit.length === 0 && unrowed.length === 0) || b.session === '') {
    if (b.imported) await job($, 'history', 'done', 'Earlier messages already read')
    return
  }
  await job($, 'history', 'running', 'Reading the transcript')
  const before = b.imported ? await $.clock.now() : (b.cards[0]?.started ?? (await $.clock.now()))
  const ran = await $.process.run(['python3', '-I', '-c', READER, b.session, String(before)], { timeoutMs: 120000 }).catch(() => undefined)
  let got: Read
  try {
    got = JSON.parse(ran?.stdout ?? '') as Read
  } catch {
    // The reader failed (no python3, or a transcript it cannot parse); the board keeps going from now and tries again next start.
    await job($, 'history', 'failed', ran ? "Couldn't read the transcript" : "Couldn't run python3 to read the transcript")
    return
  }
  if (!got.found || got.prompts.length === 0) {
    await change($, x => ({ ...x, imported: true }))
    await job($, 'history', 'done', 'No earlier messages')
    return
  }
  const { prompts, title, sent, received } = got
  if (b.imported) {
    const owner = (at: number) => [...b.cards].reverse().find(c => c.started <= at)?.id
    await change($, x => ({
      ...x,
      cards: x.cards.map(c => {
        if (c.row === undefined && c.id.startsWith('h')) c = { ...c, row: prompts.find(p => `h${p.at}` === c.id)?.uuid ?? '' }
        if (c.input !== undefined) return c
        const mine = prompts.filter(p => owner(p.at) === c.id)
        const sum = (k: 'input' | 'cached' | 'output') => mine.reduce((n, p) => n + (p[k] ?? 0), 0)
        return { ...c, input: sum('input'), cached: sum('cached'), output: sum('output') }
      }),
    }))
    await job($, 'history', 'done', `Filled in ${unsplit.length + unrowed.length} older tasks from ${prompts.length} messages`)
    return
  }
  $.ui.status(`Tasklane: sorting ${prompts.length} earlier messages into tasks`)
  const cards = pastCards(prompts, await groupPast($, prompts))
  $.ui.status(undefined)
  const owner = (at: number) => [...cards].reverse().find(c => c.started <= at)?.id
  const turns: Turn[] = prompts.map(p => ({ at: p.at + p.ms, cost: p.cost, card: owner(p.at) }))
  await change($, (x: Board) => {
    // A session with no card yet sends its newest past task back to "Needs you" when its last reply asked something.
    const last = cards.at(-1)
    if (x.cards.length === 0 && last && prompts.at(-1)?.asks) last.status = 'you'
    return {
      ...x,
      imported: true,
      name: x.name || title,
      cards: [...cards, ...x.cards],
      current: x.current ?? last?.id,
      turns: [...turns, ...x.turns],
      links: merge(merge(x.links, sent, 'sent'), received, 'received'),
    }
  })
  await job($, 'history', 'done', `Read ${prompts.length} messages into ${cards.length} tasks`)
}

// Finds the chat row (the transcript's message id) of each task's opening message, for "Go to message".
const ROWS = String.raw`import glob, json, os, sys
session, want = sys.argv[1], json.loads(sys.argv[2])
found = glob.glob(os.path.expanduser(f'~/.claude/projects/*/{session}.jsonl'))
got = {}
for line in (open(found[0], encoding='utf-8', errors='replace') if found else []):
    if '"type":"user"' not in line: continue
    try: d = json.loads(line)
    except ValueError: continue
    if d.get('isSidechain') or d.get('isMeta') or not d.get('uuid'): continue
    c = (d.get('message') or {}).get('content', '')
    text = (c if isinstance(c, str) else '\n'.join(b.get('text', '') for b in c if b.get('type') == 'text')).strip()
    for id, start in want:
        if text[:len(start)] == start: got[id] = d['uuid']
print(json.dumps(got))
`

export async function findRows($: EngineInterface) {
  const b = await read($, board)
  const want = b.cards.filter(c => c.row === undefined).map(c => [c.id, c.first ?? c.msgs[0] ?? ''] as const).filter(([, t]) => t !== '')
  if (want.length === 0 || b.session === '') return
  const ran = await $.process.run(['python3', '-I', '-c', ROWS, b.session, JSON.stringify(want)], { timeoutMs: 60000 }).catch(() => undefined)
  let got: Record<string, string>
  try {
    got = JSON.parse(ran?.stdout ?? '') as Record<string, string>
  } catch {
    return
  }
  // A message the transcript doesn't hold yet is looked for again after the next turn; once found it stays.
  if (Object.keys(got).length > 0) await change($, x => ({ ...x, cards: x.cards.map(c => (got[c.id] && c.row === undefined ? { ...c, row: got[c.id] } : c)) }))
}

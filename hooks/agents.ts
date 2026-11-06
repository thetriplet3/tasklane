import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Agents } from '../types'
import { PRICING } from './history'
import { job } from './activity'

export const NO_AGENTS: Agents = { main: { cost: 0, input: 0, cached: 0, output: 0, calls: 0, model: '' }, agents: [], updated: 0 }
const agents = atom({ plugin: 'tasklane', key: 'agents' } as const, NO_AGENTS, { shape: 'agents-1' })

// The main chat from the session's transcript, each subagent from its own file beside it (older sessions kept them in
// the main file, marked as a sidechain).
const USAGE =
  PRICING +
  String.raw`
session = sys.argv[1]
found = glob.glob(os.path.expanduser(f'~/.claude/projects/*/{session}.jsonl'))
if not found:
    print(json.dumps({'found': False})); sys.exit()

def blank(): return {'cost': 0, 'input': 0, 'cached': 0, 'output': 0, 'calls': 0, 'models': {}, 'start': None, 'end': None, 'seen': set()}
main, side, spawned = blank(), {}, {}

def add(t, d):
    if 'timestamp' in d:
        at = ms(d['timestamp'])
        t['start'] = at if t['start'] is None else min(t['start'], at)
        t['end'] = at if t['end'] is None else max(t['end'], at)
    m = d.get('message') or {}
    if d.get('type') != 'assistant' or m.get('id') in t['seen']: return m
    # A reply is written once per content block, each line repeating its usage: count it once.
    t['seen'].add(m.get('id'))
    u = usage(m)
    t['cost'] += price(m.get('model'), u)
    t['input'] += u.get('input_tokens', 0)
    t['cached'] += u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
    t['output'] += u.get('output_tokens', 0)
    t['calls'] += 1
    t['models'][m.get('model')] = t['models'].get(m.get('model'), 0) + 1
    return m

def lines(path):
    for line in open(path, encoding='utf-8', errors='replace'):
        if not line.startswith('{"'): continue
        try: yield json.loads(line)
        except ValueError: pass

for d in lines(found[0]):
    if d.get('isSidechain'):
        add(side.setdefault(d.get('agentId') or 'sidechain', blank()), d)
        continue
    m = add(main, d)
    if d.get('type') == 'assistant' and 'timestamp' in d:
        for b in m.get('content') or []:
            if b.get('type') == 'tool_use' and b.get('name') in ('Agent', 'Task'): spawned[b.get('id')] = ms(d['timestamp'])

meta = {}
for path in glob.glob(os.path.join(found[0][:-6], 'subagents', 'agent-*.jsonl')):
    aid = os.path.basename(path)[6:-6]
    for d in lines(path): add(side.setdefault(aid, blank()), d)
    try: meta[aid] = json.load(open(path[:-6] + '.meta.json'))
    except (OSError, ValueError): meta[aid] = {}

def out(t):
    model = max(t['models'], key=t['models'].get) if t['models'] else ''
    return {'cost': t['cost'], 'input': t['input'], 'cached': t['cached'], 'output': t['output'], 'calls': t['calls'], 'model': model or ''}

listed = []
for aid, t in side.items():
    if t['calls'] == 0: continue
    m = meta.get(aid, {})
    listed.append({**out(t), 'id': aid, 'type': m.get('agentType', 'agent'), 'description': m.get('description', ''),
                   'at': spawned.get(m.get('toolUseId'), t['start'] or 0), 'ms': (t['end'] or 0) - (t['start'] or 0),
                   'finished': bool(m.get('finished', True))})
print(json.dumps({'found': True, 'main': out(main), 'agents': listed}))
`

type Read = { found: false } | ({ found: true } & Omit<Agents, 'updated'>)

// One read at a time; a turn that ends meanwhile asks for one more after it.
// shortcut: rescans the whole transcript per turn (about a second for a long session); read only the new bytes if that drags.
let reading = false
let again = false
export async function readAgents($: EngineInterface, session: string) {
  if (session === '') return
  if (reading) {
    again = true
    return
  }
  reading = true
  try {
    do {
      again = false
      await job($, 'usage', 'running', 'Totting up the main chat and subagents')
      const ran = await $.process.run(['python3', '-I', '-c', USAGE, session], { timeoutMs: 120000 }).catch(() => undefined)
      let got: Read | undefined
      try {
        got = JSON.parse(ran?.stdout ?? '') as Read
      } catch {
        got = undefined
      }
      // Saved only when whole: the view reads every field.
      if (got?.found && got.main && Array.isArray(got.agents)) {
        const now = await $.clock.now()
        const { main, agents: list } = got
        await update($, agents, () => ({ main, agents: list, updated: now }))
        await job($, 'usage', 'done', `Main chat and ${list.length === 1 ? '1 subagent' : `${list.length} subagents`}`)
      } else await job($, 'usage', got && !got.found ? 'done' : 'failed', got && !got.found ? 'No transcript yet' : "Couldn't read the transcripts")
    } while (again)
  } finally {
    reading = false
  }
}

import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { AgentUse, Board, Card, JobKind, Link, Purpose, Status, Usage, View } from '../types'
import { NO_ACTIVITY } from './activity'
import { NO_AGENTS } from './agents'
import { ago, day, emptyBoard, matches, minutes, money, normalize, patchCard, plural, short, split, withStatus } from './board'
import { ROWS, change, rowKey } from './state'
import { TONE_OF, bar, colHead, empty, graph, hero, icon, pill, ring, spark, strip } from './svg'

const COLUMNS: { status: Status; name: string; color: Color }[] = [
  { status: 'you', name: 'Needs you', color: 'warning' },
  { status: 'running', name: 'Running', color: 'suggestion' },
  { status: 'parked', name: 'Parked', color: 'inactive' },
  { status: 'done', name: 'Done', color: 'success' },
]

const DAY = 86400000

const board = atom({ plugin: 'tasklane', key: 'board' } as const, emptyBoard(''), { shape: 'board-2' })
const view = atom({ plugin: 'tasklane', key: 'view' } as const, {} as View, { shape: 'view-1' })
const agents = atom({ plugin: 'tasklane', key: 'agents' } as const, NO_AGENTS, { shape: 'agents-1' })
const activity = atom({ plugin: 'tasklane', key: 'activity' } as const, NO_ACTIVITY, { shape: 'activity-1' })

type Art = { source: string; width: number; height: number }

async function drawBoard($: EngineInterface, e: RenderInput<'Pane'>) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  // The phones draw no text field yet, and the terminal no vector art.
  const Input = 'Input' in els ? els.Input : undefined
  const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
  const Markdown = 'Markdown' in els ? els.Markdown : undefined
  const Select = 'Select' in els ? els.Select : undefined

  const b = await read($, board)
  const v = await read($, view)
  const ag = await read($, agents)
  const act = await read($, activity)
  const now = await $.clock.now()
  const width = e.props.bodyColumns ?? 80
  // Four columns side by side when the pane is wide, two when docked, one when narrow.
  const perRow = width >= 90 ? 4 : width >= 56 ? 2 : 1
  // Slightly under a share each, and growing to fill: borders and gaps never push one onto a new row.
  const colWidth = perRow === 4 ? '22%' : perRow === 2 ? '46%' : '100%'
  const tileWidth = width >= 56 ? '22%' : '46%'
  // About 7 px per cell, an underestimate on the desktop; full-width art is drawn wider and scales down to its slot.
  const px = Math.min(width * 7, 900)
  const wide = Math.min(width * 10, 1400)
  // About 8 px per cell on the desktop, less the box's padding.
  const full = Math.max(160, width * 8 - 40)
  const cardPx = Math.max(80, Math.floor(px / perRow) - 44)

  const art = (key: string, a: Art, alt: string, isInteractive = false) =>
    Svg ? <Svg key={key} source={a.source} alt={alt} width={a.width} height={a.height} isInteractive={isInteractive} /> : null
  // An interactive drawing is a frame with no height of its own, so it always gets one; the width scales the drawing down to fit.
  const fit = (key: string, a: Art, alt: string) =>
    Svg ? <Svg key={key} source={a.source} alt={alt} width={full} height={Math.round((a.height * full) / a.width)} isInteractive /> : null

  const total = b.cards.reduce((n, c) => n + c.cost, 0)
  const tokens = b.cards.reduce((n, c) => n + c.tokens, 0)
  const ms = b.cards.reduce((n, c) => n + c.ms, 0)
  const today = b.turns.filter(t => t.at >= now - DAY).reduce((n, t) => n + t.cost, 0)
  const messages = b.cards.reduce((n, c) => n + c.msgs.length + c.fold, 0)
  const first = b.cards[0]?.started
  const maxCost = Math.max(0.01, ...b.cards.map(c => c.cost))
  const titleOf = (id?: string) => b.cards.find(c => c.id === id)?.title
  // A connection's task by its current, model-written title. Links saved before the id was kept hold the title of
  // that time, usually the opening message, so they're matched on that.
  const taskOf = (l: Link) =>
    titleOf(l.cardId) ?? b.cards.find(c => l.card !== undefined && (c.first ?? c.msgs[0]) === l.card)?.title ?? l.card
  const turnLabel = (t: { at: number; cost: number; card?: string }) =>
    `${money(t.cost)}, ${ago(now - t.at)} ago${titleOf(t.card) ? ` · ${titleOf(t.card)}` : ''}`

  // Moving between views keeps the search, the folded sections and the sort, so Back returns to the same layout.
  const setView = (to: View) => () => update($, view, x => ({ q: x.q, closed: x.closed, sort: x.sort, ...to }))
  const q = (v.q ?? '').trim()
  const search = (text: string) => void update($, view, x => ({ ...x, q: text }))
  const move = (id: string, status: Status) => async () => {
    const at = await $.clock.now()
    await change($, x => patchCard(x, id, c => withStatus(c, status, at)))
  }
  const addRule = (text: string) => {
    const rule = text.trim()
    if (rule !== '') void change($, x => ({ ...x, rules: [...x.rules.filter(r => r !== rule), rule] }))
  }
  const dropRule = (rule: string) => () => change($, x => ({ ...x, rules: x.rules.filter(r => r !== rule) }))

  // Folding: sections and columns by id.
  const closed = new Set(v.closed ?? [])
  const fold = (ids: string[], isClosed: boolean) =>
    update($, view, x => ({ ...x, closed: isClosed ? [...new Set([...(x.closed ?? []), ...ids])] : (x.closed ?? []).filter(c => !ids.includes(c)) }))
  const toggle = (id: string) => () => fold([id], !closed.has(id))
  const section = (id: string, title: string, note: string | undefined, body: RenderChildren) => (
    <Box key={`sec:${id}`} flexDirection="column" borderStyle="round" borderColor="subtle" padding="sm" gap="sm">
      <Box flexDirection="row" columnGap="sm" flexWrap="wrap" alignItems="center">
        <Button key={`toggle:${id}`} plain onPress={toggle(id)}>
          <Text size="title">{closed.has(id) ? '▸' : '▾'}</Text> <Text weight="medium">{title}</Text>
        </Button>
        {note && (
          <Text size="caption" dimColor>
            {note}
          </Text>
        )}
      </Box>
      {!closed.has(id) && body}
    </Box>
  )

  const tile = (label: string, value: string, hint?: string) => (
    <Box key={`tile:${label}`} width={tileWidth} flexGrow={1} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" paddingY="xs">
      <Text size="caption" dimColor>
        {label}
      </Text>
      <Text size="title" weight="medium" tabular>
        {value}
      </Text>
      {hint && (
        <Text size="caption" dimColor>
          {hint}
        </Text>
      )}
    </Box>
  )

  // The drawings take no clicks, so each bar is a button: a block glyph by height; hovering one reveals its caption.
  const GLYPHS = '▁▂▃▄▅▆▇█'
  const shownTurns = b.turns.slice(-Math.max(8, Math.floor(full / 13)))
  const top = Math.max(0.0001, ...shownTurns.map(t => t.cost))
  const turnBars = (
    <Box flexDirection="column" gap="xs">
      {shownTurns.length === 0 && (
        <Text size="caption" dimColor>
          Turn costs show here
        </Text>
      )}
      <Box flexDirection="row" alignItems="flex-end" justifyContent="flex-end">
        {shownTurns.map(t => (
          <Box key={`tb:${t.at}`} hover={{ scope: `turn:${t.at}`, backgroundColor: 'subtle' }}>
            <Button key={`turn:${t.at}`} plain onPress={titleOf(t.card) ? setView({ card: t.card }) : () => undefined}>
              <Text size="title" color="claude">
                {GLYPHS[Math.min(7, Math.floor((t.cost / top) * 7.99))]}
              </Text>
            </Button>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" justifyContent="flex-end">
        {shownTurns.map(t => (
          <Box key={`tc:${t.at}`} display="none" hover={{ scope: `turn:${t.at}`, display: 'flex' }}>
            <Text size="caption" dimColor>
              {turnLabel(t)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )

  const waitingFor = b.cards.filter(c => c.status === 'you').length
  const head = (
    <Box key="sec:top" flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap="sm">
      <Text size="title" weight="medium">
        {b.name || 'This session'}
      </Text>
      <Box flexDirection="row" columnGap="sm" alignItems="center">
        {waitingFor > 0 && art('wait', pill(`${waitingFor} waiting on you`, 'amber'), `${waitingFor} waiting on you`)}
        <Text size="caption" dimColor>
          {plural(messages, 'message')}
          {first ? `, since ${day(first)}` : ''}
        </Text>
      </Box>
    </Box>
  )
  // The last 24 hours by the hour, oldest first, for the header's trend.
  const dayTurns = b.turns.filter(t => t.at >= now - DAY)
  const hours = Array.from({ length: 24 }, (_, i) => {
    const from = now - (24 - i) * 3600000
    const mine = dayTurns.filter(t => t.at >= from && t.at < from + 3600000)
    const cost = mine.reduce((n, t) => n + t.cost, 0)
    return { cost, label: `${i === 23 ? 'this hour' : `${23 - i} h ago`}: ${money(cost)}, ${plural(mine.length, 'turn')}` }
  })
  const sumOf = (k: 'input' | 'cached' | 'output') => b.cards.reduce((n, c) => n + (c[k] ?? 0), 0)
  const overview = section(
    'overview',
    'Overview',
    closed.has('overview') ? `${money(total)} · ${short(tokens)} tokens` : undefined,
    Svg ? (
      fit(
        'hero',
        hero(
          {
            cost: money(total),
            sub: `${plural(b.cards.length, 'task')} · ${minutes(ms)} agent time`,
            tokens: short(tokens),
            mix: { input: sumOf('input'), cached: sumOf('cached'), output: sumOf('output') },
            mixLabel: `in ${short(sumOf('input'))} · cache ${short(sumOf('cached'))} · out ${short(sumOf('output'))}`,
            today: `${money(today)} · ${plural(dayTurns.length, 'turn')}`,
            hours,
          },
          full,
        ),
        `Session cost ${money(total)}, ${plural(b.cards.length, 'task')}; ${short(tokens)} tokens, ${split(b.cards)}; last 24 hours ${money(today)}`,
      )
    ) : (
      <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="sm">
        {tile('Session cost', money(total), plural(b.cards.length, 'task'))}
        {tile('Tokens', short(tokens), split(b.cards))}
        {tile('Agent time', minutes(ms))}
        {tile('Last 24h', money(today), plural(dayTurns.length, 'turn'))}
      </Box>
    ),
  )
  const chart = Svg && section('chart', 'Cost per turn', 'hover a bar, click it to open its task', turnBars)

  // Main chat against each subagent, read from the transcripts; a subagent belongs to the task in progress when it started.
  const subCost = ag.agents.reduce((n, a) => n + a.cost, 0)
  const allCost = Math.max(0.01, ag.main.cost + subCost)
  const topUse = Math.max(0.01, ag.main.cost, ...ag.agents.map(a => a.cost))
  const ownerOf = (a: AgentUse) => [...b.cards].reverse().find(c => c.started <= a.at)
  const byCost = [...ag.agents].sort((x, y) => (v.sort === 'time' ? y.at - x.at : y.cost - x.cost))
  const model = (u: Usage) => u.model.replace(/^claude-/, '') || 'model unknown'
  const useRow = (key: string, title: string, sub: string, u: Usage, card?: Card) => (
    <Box key={`u:${key}`} flexDirection="column" borderStyle="round" borderColor="subtle" hover={{ borderColor: 'claude' }} paddingX="sm" paddingY="xs" gap="xs">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap="sm">
        {card ? (
          <Button key={`ag:${key}`} plain onPress={setView({ card: card.id })}>
            {title}
          </Button>
        ) : (
          <Text weight="medium">{title}</Text>
        )}
        <Text size="caption" tabular>
          {money(u.cost)} · {Math.round((u.cost / allCost) * 100)}%
        </Text>
      </Box>
      <Text size="caption" dimColor>
        {sub}
      </Text>
      <Text size="caption" dimColor tabular>
        {split([u])}
      </Text>
      {art(`ub:${key}`, bar(u.cost / topUse, key === 'main' ? 'blue' : 'purple', Math.max(80, full - 40)), `${money(u.cost)} of ${money(allCost)}`)}
    </Box>
  )
  const agentRow = (a: AgentUse) => {
    const card = ownerOf(a)
    const sub = [model(a), plural(a.calls, 'call'), minutes(a.ms), a.finished ? 'finished' : 'running', card?.title].filter(Boolean).join(' · ')
    return useRow(a.id, `${a.type} · ${a.description || a.id}`, sub, a, card)
  }
  const usage = section(
    'agents',
    'Usage by agent',
    ag.updated === 0 ? 'reading the transcripts' : `main chat ${money(ag.main.cost)} · ${plural(ag.agents.length, 'subagent')} ${money(subCost)}`,
    <Box flexDirection="column" gap="xs">
      {ag.updated > 0 &&
        fit(
          'ring',
          ring(
            money(ag.main.cost + subCost),
            [
              { name: 'Main chat', cost: ag.main.cost, label: `Main chat: ${money(ag.main.cost)}` },
              ...[...ag.agents].sort((x, y) => y.cost - x.cost).map(a => ({ name: `${a.type} · ${a.description || a.id}`, cost: a.cost, label: `${a.type} · ${a.description}: ${money(a.cost)}` })),
            ],
            full,
          ),
          `Main chat ${money(ag.main.cost)}, subagents ${money(subCost)}`,
        )}
      {Select && ag.agents.length > 1 && (
        <Box flexDirection="row">
          <Select
            key="sort"
            label="Sort subagents by"
            value={v.sort ?? 'cost'}
            options={[
              { value: 'cost', label: 'cost' },
              { value: 'time', label: 'newest' },
            ]}
            onSelect={to => void update($, view, x => ({ ...x, sort: to === 'time' ? ('time' as const) : ('cost' as const) }))}
          />
        </Box>
      )}
      {ag.updated > 0 && useRow('main', 'Main chat', `${model(ag.main)} · ${plural(ag.main.calls, 'call')}`, ag.main)}
      {byCost.map(agentRow)}
      {ag.updated > 0 && ag.agents.length === 0 && (
        <Text size="caption" dimColor>
          No subagents in this session yet
        </Text>
      )}
      <Text size="caption" dimColor>
        estimated at list prices from the transcripts · click a subagent to open the task it ran for
      </Text>
    </Box>,
  )

  const statusLine = (c: Card, color: Color, label: string) => (
    <Box flexDirection="row" flexWrap="wrap" columnGap="sm" alignItems="center">
      {Svg ? (
        art(`pill:${c.id}`, pill(label, TONE_OF[c.status]), label)
      ) : (
        <Text size="caption" color={color} weight="medium">
          {label}
        </Text>
      )}
      <Text size="caption" dimColor>
        {c.status === 'you' ? `waiting ${ago(now - c.since)}` : day(c.started)}
      </Text>
    </Box>
  )

  // Scrolls the chat to the message that opened the task; a row the chat hasn't loaded can't be reached.
  // The chat's own id for the row where it has drawn it, else the transcript's.
  // Only the terminal lets a mod scroll the chat: the desktop answers "transcript not scrollable here".
  const rowOf = (c: Card) => (e.surface === 'terminal' ? (ROWS.get(rowKey(c.first ?? c.msgs[0] ?? '')) ?? (c.row || undefined)) : undefined)
  const goto = (c: Card) => async () => {
    const row = rowOf(c)
    const moved = row ? await $.ui.scroll({ to: { requestId: row }, block: 'center' }).catch((err: unknown) => ({ deny: String(err) })) : { deny: 'no row' }
    if (moved.deny) $.ui.toast(`Couldn't jump to that message (${moved.deny})`)
  }
  // The opening message, where the title is no longer its own words.
  const said = (c: Card) => {
    const m = (c.first ?? c.msgs[0] ?? '').replace(/\s+/g, ' ').trim()
    return m !== '' && m.slice(0, 40) !== c.title.slice(0, 40) ? (m.length > 220 ? `${m.slice(0, 219)}…` : m) : ''
  }
  const selected = b.cards.find(c => c.id === v.card)
  if (selected) {
    const col = COLUMNS.find(x => x.status === selected.status) ?? COLUMNS[1]!
    const mine = b.turns.filter(t => t.card === selected.id)
    return (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" flexWrap="wrap" columnGap="sm">
          <Button key="crumb" plain onPress={setView({})}>
            {b.name || 'This session'}
          </Button>
          <Text dimColor>›</Text>
          <Text weight="medium">{col.name}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor={col.color} padding="sm" gap="sm">
          <Box flexDirection="row" columnGap="sm" alignItems="center">
            {art('icon', icon(selected.status), col.name)}
            <Text size="title" weight="medium">
              {selected.title}
            </Text>
          </Box>
          {said(selected) && (
            <Text size="caption" dimColor italic>
              Opened with “{said(selected)}”
            </Text>
          )}
          {statusLine(selected, col.color, selected.id === b.current ? 'current' : col.name)}
          <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="sm">
            {tile('Cost', money(selected.cost), `${Math.round((selected.cost / Math.max(total, 0.01)) * 100)}% of session`)}
            {tile('Tokens', short(selected.tokens), split([selected]))}
            {tile('Agent time', minutes(selected.ms))}
            {tile('Messages', String(selected.msgs.length + selected.fold), selected.fold > 0 ? `${selected.fold} folded` : undefined)}
          </Box>
          {Svg && mine.length > 0 && fit('cardspark', spark(mine, wide, turnLabel), 'Cost of each turn on this task')}
          <Box flexDirection="column" gap="xs" marginTop="sm">
            {selected.msgs.map((m, i) =>
              Markdown ? <Markdown key={`m${i}`} text={`> ${m.replace(/\n/g, '\n> ')}`} /> : <Text key={`m${i}`}>“{m}”</Text>,
            )}
            {selected.fold > 0 && <Text dimColor>+ {plural(selected.fold, 'status check')} and go-aheads</Text>}
          </Box>
          {ag.agents.some(a => ownerOf(a)?.id === selected.id) && (
            <Box flexDirection="column" gap="xs" marginTop="sm">
              <Text weight="medium">Subagents</Text>
              {byCost.filter(a => ownerOf(a)?.id === selected.id).map(a => (
                <Box key={`sa:${a.id}`}>
                  <Text size="caption" tabular>
                    {a.type} · {a.description || a.id} <Text dimColor>{money(a.cost)} · {split([a])}</Text>
                  </Text>
                </Box>
              ))}
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap" gap="sm" marginTop="sm">
            {selected.status !== 'parked' && <Button key="park" onPress={move(selected.id, 'parked')}>Park</Button>}
            {selected.status !== 'done' && <Button key="done" onPress={move(selected.id, 'done')}>Mark done</Button>}
            {(selected.status === 'parked' || selected.status === 'done') && (
              <Button key="reopen" onPress={move(selected.id, 'running')}>Reopen</Button>
            )}
            {rowOf(selected) && <Button key="goto" onPress={goto(selected)}>Go to message</Button>}
            <Button key="back" variant="primary" onPress={setView({})}>Back to board</Button>
          </Box>
        </Box>
      </Box>
    )
  }

  const column = (other: Board, col: (typeof COLUMNS)[number], open: boolean) => {
    const cards = other.cards.filter(c => c.status === col.status && (q === '' || matches(c, q)))
    const sum = cards.reduce((n, c) => n + c.cost, 0)
    const top = Math.max(0.01, ...other.cards.map(c => c.cost))
    const folded = open && closed.has(`col:${col.status}`)
    const boardTotal = Math.max(0.01, other.cards.reduce((n, c) => n + c.cost, 0))
    return (
      <Box key={`${open ? 'c' : 'p'}:${col.status}`} width={colWidth} flexGrow={1} flexDirection="column" borderStyle="round" borderColor="subtle" padding="sm" gap="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" columnGap="xs" alignItems="center">
            {open && (
              <Button key={`toggle:col:${col.status}`} plain onPress={toggle(`col:${col.status}`)}>
                <Text size="title">{folded ? '▸' : '▾'}</Text>
              </Button>
            )}
            {Svg ? (
              art(`head:${col.status}`, colHead(col.status, col.name, cards.length, money(sum), sum / boardTotal, cardPx - (open ? 22 : 0)), `${col.name} ${cards.length}, ${money(sum)}`)
            ) : (
              <>
                {art(`icon:${col.status}`, icon(col.status, cards.length > 0), col.name)}
                <Text weight="medium" color={col.color}>
                  {col.name} <Text dimColor>{cards.length}</Text>
                </Text>
              </>
            )}
          </Box>
          {!Svg && (
            <Text size="caption" dimColor tabular>
              {` ${money(sum)}`}
            </Text>
          )}
        </Box>
        {!folded &&
          cards.length === 0 &&
          (Svg ? (
            art(`empty:${col.status}`, empty(q === '' ? 'Nothing here' : 'No match', cardPx + 16), q === '' ? 'Nothing here' : 'No match')
          ) : (
            <Text size="caption" dimColor>
              {q === '' ? 'Nothing here' : 'No match'}
            </Text>
          ))}
        {!folded && [...cards].reverse().map(c => (
          <Box
            key={`k:${c.id}`}
            flexDirection="column"
            borderStyle="round"
            borderColor={c.id === other.current ? col.color : 'subtle'}
            hover={{ scope: `card:${c.id}`, borderColor: col.color }}
            paddingX="sm"
            paddingY="xs"
            gap="xs"
          >
            {open ? (
              <Button key={c.id} plain onPress={setView({ card: c.id })}>
                <Text weight="medium">{c.title}</Text>
              </Button>
            ) : (
              <Text weight="medium">{c.title}</Text>
            )}
            {(said(c) || (open && rowOf(c))) && (
              <Box display="none" hover={{ scope: `card:${c.id}`, display: 'flex' }} flexDirection="column" gap="xs">
                {said(c) && (
                  <Text size="caption" dimColor italic>
                    “{said(c)}”
                  </Text>
                )}
                {open && rowOf(c) && (
                  <Button key={`go:${c.id}`} plain onPress={goto(c)}>
                    ↗ Go to message
                  </Button>
                )}
              </Box>
            )}
            {Svg ? (
              art(
                `strip:${c.id}`,
                strip(
                  {
                    status: c.status,
                    label: c.id === other.current ? 'current' : col.name,
                    when: c.status === 'you' ? `waiting ${ago(now - c.since)}` : day(c.started),
                    cost: money(c.cost),
                    meta: `${short(c.tokens)} tokens · ${plural(c.msgs.length + c.fold, 'message')} · ${minutes(c.ms)}`,
                    fraction: c.cost / top,
                    isRunning: c.status === 'running',
                  },
                  cardPx,
                ),
                `${c.id === other.current ? 'current' : col.name}, ${c.status === 'you' ? `waiting ${ago(now - c.since)}` : day(c.started)}, ${money(c.cost)}`,
              )
            ) : (
              <>
                {statusLine(c, col.color, c.id === other.current ? 'current' : col.name)}
                <Text size="caption" dimColor tabular>
                  {money(c.cost)} · {short(c.tokens)} · {plural(c.msgs.length + c.fold, 'msg')}
                </Text>
              </>
            )}
          </Box>
        ))}
      </Box>
    )
  }

  if (v.peer !== undefined) {
    const id = (await $.store.get(`name:${v.peer}`)) as string | undefined
    const raw = id ? ((await $.store.get(`board:${id}`)) as Board | undefined) : undefined
    const other = raw ? normalize(raw) : undefined
    return (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" flexWrap="wrap" columnGap="sm">
          <Button key="crumb" plain onPress={setView({})}>
            {b.name || 'This session'}
          </Button>
          <Text dimColor>›</Text>
          <Text weight="medium">{v.peer}</Text>
        </Box>
        {other ? (
          <Box flexDirection="column" gap="sm">
            <Text dimColor>
              {money(other.cards.reduce((n, c) => n + c.cost, 0))} · {plural(other.cards.length, 'task')} · updated{' '}
              {ago(now - other.updated)} ago
            </Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="sm">
              {COLUMNS.map(col => column(other, col, false))}
            </Box>
          </Box>
        ) : (
          <Box borderStyle="round" borderColor="subtle" padding="sm">
            <Text dimColor>
              No board for this session on this computer. It may run in the cloud or on another computer, or not have this mod turned
              on.
            </Text>
          </Box>
        )}
        <Box>
          <Button key="back" onPress={setView({})}>Back to board</Button>
        </Box>
      </Box>
    )
  }

  // What the mod itself is doing: its background reads, and what its Haiku calls cost by purpose.
  const JOBS: { kind: JobKind; name: string }[] = [
    { kind: 'history', name: 'Reading earlier messages' },
    { kind: 'usage', name: 'Usage by agent' },
    { kind: 'names', name: 'Naming earlier tasks' },
  ]
  const PURPOSES: { purpose: Purpose; name: string }[] = [
    { purpose: 'sort', name: 'Sorting earlier messages into tasks' },
    { purpose: 'name', name: 'Naming tasks after each turn' },
    { purpose: 'backlog', name: 'Naming earlier tasks' },
  ]
  // Haiku calls cost fractions of a cent, so small sums keep four places.
  const fine = (usd: number) => (usd > 0 && usd < 0.0001 ? '<$0.0001' : usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : money(usd))
  const secs = (n: number) => (n < 60000 ? `${n < 1000 ? '<1' : Math.round(n / 1000)} s` : minutes(n))
  const running = JOBS.filter(j => act.jobs[j.kind]?.state === 'running')
  const spent = PURPOSES.flatMap(p => {
    const s = act.spend[p.purpose]
    return s && s.calls > 0 ? [{ ...p, s }] : []
  })
  const haiku = spent.reduce((n, p) => n + p.s.cost, 0)
  const haikuCalls = spent.reduce((n, p) => n + p.s.calls, 0)
  const jobRow = ({ kind, name }: (typeof JOBS)[number]) => {
    const j = act.jobs[kind]
    const mark: { glyph: string; color: Color } = !j
      ? { glyph: '○', color: 'inactive' }
      : j.state === 'running'
        ? { glyph: '◌', color: 'claude' }
        : j.state === 'done'
          ? { glyph: '✓', color: 'success' }
          : { glyph: '✕', color: 'error' }
    const when = !j ? 'not run yet' : j.state === 'running' ? `running for ${secs(now - j.started)}` : `${j.ms !== undefined ? `took ${secs(j.ms)} · ` : ''}${ago(now - j.at)} ago`
    return (
      <Box key={`job:${kind}`} flexDirection="column" paddingX="xs">
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap="sm">
          <Text>
            <Text color={mark.color}>{mark.glyph}</Text> <Text weight="medium">{name}</Text>
          </Text>
          <Text size="caption" dimColor tabular>
            {when}
          </Text>
        </Box>
        <Text size="caption" dimColor>
          {j?.step ?? 'Starts with the session'}
        </Text>
      </Box>
    )
  }
  const spendRow = ({ purpose, name, s }: (typeof spent)[number]) => (
    <Box key={`hk:${purpose}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX="sm" paddingY="xs" gap="xs">
      <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap="sm">
        <Text weight="medium">{name}</Text>
        <Text size="caption" tabular>
          {fine(s.cost)} · {Math.round((s.cost / Math.max(haiku, 1e-9)) * 100)}%
        </Text>
      </Box>
      <Text size="caption" dimColor tabular>
        {plural(s.calls, 'call')}
        {s.failed > 0 ? ` (${s.failed} unanswered)` : ''} · about {secs(s.ms / s.calls)} each · last {ago(now - s.last)} ago
      </Text>
      <Text size="caption" dimColor tabular>
        in {short(s.input)} · cache {short(s.cached + s.written)} · out {short(s.output)}
      </Text>
      {art(`hb:${purpose}`, bar(s.cost / Math.max(haiku, 1e-9), 'amber', Math.max(80, full - 40)), `${fine(s.cost)} of ${fine(haiku)}`)}
    </Box>
  )
  const activityPanel = section(
    'activity',
    'Activity',
    running.length > 0 ? `${running.map(j => j.name.toLowerCase()).join(', ')}…` : `Haiku ${plural(haikuCalls, 'call')} · ${fine(haiku)}`,
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="column" gap="xs">
        {JOBS.map(jobRow)}
      </Box>
      <Text weight="medium">
        Haiku <Text dimColor>· {plural(haikuCalls, 'call')} · {fine(haiku)}</Text>
      </Text>
      {spent.length === 0 ? (
        <Text size="caption" dimColor>
          No Haiku calls yet in this session. Tasks are named after each turn.
        </Text>
      ) : (
        <Box flexDirection="column" gap="xs">
          {spent.length > 1 &&
            fit(
              'haiku-ring',
              ring(fine(haiku), spent.map(p => ({ name: p.name, cost: p.s.cost, label: `${p.name}: ${fine(p.s.cost)}` })), full),
              `Haiku ${fine(haiku)}: ${spent.map(p => `${p.name} ${fine(p.s.cost)}`).join(', ')}`,
            )}
          {spent.map(spendRow)}
        </Box>
      )}
      <Text size="caption" dimColor>
        Priced as Haiku 5.5 at list prices; not part of the session cost above.
      </Text>
    </Box>,
  )

  // The index: a chip per section and column, with its count. Pressing one shows it alone, right under the index, and
  // pressing it again shows everything: the pane's row-counted scroll can't be trusted to land on a section on the desktop.
  const SECTIONS = ['overview', ...(Svg ? ['chart'] : []), 'agents', 'tasks', ...COLUMNS.map(c => `col:${c.status}`), 'rules', 'links', 'activity']
  const anyOpen = SECTIONS.some(id => !closed.has(id))
  const shows = (id: string) => (s: string) => s === id || (id.startsWith('col:') && s === 'tasks')
  const isFocused = (id: string) => SECTIONS.every(s => closed.has(s) !== shows(id)(s))
  const focus = (id: string) => () =>
    update($, view, x => ({ ...x, closed: isFocused(id) ? [] : SECTIONS.filter(s => !shows(id)(s)) }))
  // The task statuses lead, a chip each with its count; Needs you stands out while it holds anything, a zero is dimmed.
  const statusChip = (col: (typeof COLUMNS)[number]) => {
    const id = `col:${col.status}`
    const n = b.cards.filter(c => c.status === col.status).length
    const urgent = col.status === 'you' && n > 0
    return (
      <Box
        key={`ix:${id}`}
        width={tileWidth}
        flexGrow={1}
        borderStyle="round"
        borderColor={isFocused(id) ? 'claude' : urgent ? col.color : 'subtle'}
        hover={{ borderColor: col.color }}
        paddingX="sm"
        paddingY="xs"
      >
        <Button key={`nav:${id}`} plain onPress={focus(id)}>
          <Text color={n > 0 ? col.color : 'inactive'}>●</Text> <Text weight="medium" dimColor={n === 0}>{col.name}</Text>{' '}
          <Text weight="medium" color={urgent ? col.color : undefined} dimColor={n === 0} tabular>
            {String(n)}
          </Text>
        </Button>
      </Box>
    )
  }
  // The other sections, as one quiet line of links; the one shown alone is highlighted.
  const link = (id: string, label: string) => (
    <Button key={`nav:${id}`} plain onPress={focus(id)}>
      <Text size="caption" color={isFocused(id) ? 'claude' : undefined} dimColor={!isFocused(id)} weight={isFocused(id) ? 'medium' : undefined}>
        {label}
      </Text>
    </Button>
  )
  const dot = (k: string) => (
    <Text key={`dot:${k}`} size="caption" dimColor>
      ·
    </Text>
  )
  const links = [
    link('overview', 'Overview'),
    ...(Svg ? [link('chart', 'Cost')] : []),
    link('agents', `Agents ${ag.agents.length}`),
    link('rules', `Rules ${b.rules.length}`),
    link('links', `Connections ${b.links.length}`),
    link('activity', running.length > 0 ? 'Activity ◌' : 'Activity'),
  ]
  const index = (
    <Box key="index" flexDirection="column" gap="xs">
      <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="sm">
        {COLUMNS.map(statusChip)}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap="xs" rowGap="xs" alignItems="center">
        {links.flatMap((l, i) => (i === 0 ? [l] : [dot(String(i)), l]))}
        {dot('end')}
        <Button key="fold-all" plain onPress={() => fold(SECTIONS, anyOpen)}>
          <Text size="caption" dimColor>
            {anyOpen ? 'Collapse all' : 'Expand all'}
          </Text>
        </Button>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" gap="md">
      {head}
      {index}
      {overview}
      {chart}
      {usage}

      {section(
        'tasks',
        'Tasks',
        plural(b.cards.length, 'task'),
        <Box flexDirection="column" gap="sm">
          {Input && (
            <Box flexDirection="column" gap="xs">
              <Input key="search" placeholder="Search tasks" value={v.q ?? ''} submitLabel="Search" onInput={search} onSubmit={search} />
              {q !== '' && (
                <Box flexDirection="row" columnGap="sm" alignItems="center">
                  <Text size="caption" dimColor>
                    {plural(b.cards.filter(c => matches(c, q)).length, 'task')} match “{q}”
                  </Text>
                  <Button key="clear" plain onPress={() => search('')}>
                    Clear
                  </Button>
                </Box>
              )}
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="sm">
            {COLUMNS.map(col => column(b, col, true))}
          </Box>
        </Box>,
      )}

      {section(
        'rules',
        'Standing rules',
        'sent to Claude with every message · click one to drop it',
        <Box flexDirection="column" gap="sm">
        {b.rules.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap="sm" rowGap="xs">
            {b.rules.map(r => (
              <Box key={`chip:${r}`} borderStyle="round" borderColor="suggestion" hover={{ borderColor: 'error' }} paddingX="sm">
                <Button key={`r:${r}`} plain onPress={dropRule(r)}>
                  {r} <Text dimColor>×</Text>
                </Button>
              </Box>
            ))}
          </Box>
        )}
        {Input && <Input key="rule" placeholder="Don't wait for Codex review, merge on green CI" submitLabel="Add" onSubmit={addRule} />}
        </Box>,
      )}

      {section(
        'links',
        'Connected sessions',
        b.links.length === 0
          ? 'none yet'
          : `${plural(b.links.length, 'session')}, ${plural(b.links.reduce((n, l) => n + l.sent + l.received, 0), 'message')}`,
        <Box flexDirection="column" gap="xs">
        {fit('graph', graph(b.name || 'This session', b.links.map(l => ({ ...l, card: taskOf(l) })), Math.min(wide, 900)), 'Sessions this one exchanged messages with')}
        {b.links.map(l => (
          <Box key={`lk:${l.name}`} flexDirection="row" hover={{ backgroundColor: 'subtle' }} paddingX="xs">
            <Button key={`l:${l.name}`} plain onPress={setView({ peer: l.name })}>
              {l.name}{' '}
              <Text dimColor>
                → {l.sent} ← {l.received}
                {taskOf(l) ? ` · ${taskOf(l)}` : ''}
              </Text>
            </Button>
          </Box>
        ))}
        </Box>,
      )}
      {activityPanel}
    </Box>
  )
}

// A view that fails to draw would leave the pane blank, and the view is kept across reloads; say what broke instead,
// with a way back to the board.
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  try {
    return await drawBoard($, e)
  } catch (err) {
    const { Box, Text, Button } = $.ui.resolve(e)
    const why = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    return (
      <Box flexDirection="column" gap="sm" padding="sm" borderStyle="round" borderColor="error">
        <Text color="error" weight="medium">
          Tasklane couldn't draw this view
        </Text>
        <Text key="draw-error" dimColor>
          {why}
        </Text>
        <Box>
          <Button key="reset" variant="primary" onPress={() => update($, view, x => ({ q: x.q }))}>
            Back to the board
          </Button>
        </Box>
      </Box>
    )
  }
}

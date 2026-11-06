import { expect, mock, test } from 'claude-code/testing'

const NOW = 1793350000000
const card = (id: string, title: string, status: string, cost: number) => ({
  id,
  title,
  status,
  started: NOW - 3600000,
  since: NOW - 3600000,
  msgs: [title],
  fold: 2,
  cost,
  tokens: 1200000,
  input: 1000,
  cached: 1100000,
  output: 99000,
  ms: 90000,
})
const SAVED = {
  session: 's1',
  name: 'acme-web',
  cards: [
    card('t1', 'Playwright element picking', 'you', 38.4),
    card('t2', 'Cut search tool calls', 'running', 54.1),
    card('t3', 'UI/UX refresh', 'parked', 12.4),
    card('t4', 'Own delete dialog', 'done', 4.2),
  ],
  current: 't2',
  links: [{ name: 'billing-api', sent: 3, received: 12, card: 'Cut search tool calls' }],
  rules: ['Merge on green CI'],
  turns: [{ at: NOW - 1000, cost: 2, card: 't3' }],
  baseline: 0,
  updated: 0,
}

// What a drawing says (its alt) or a line of text, whichever the surface draws.
type Ui = { findAll: (q: { type: string }) => Promise<unknown[]> }
const shown = async (ui: Ui) =>
  [...(await ui.findAll({ type: 'Text' })).map(n => (n as { text?: string }).text ?? ''), ...(await ui.findAll({ type: 'Svg' })).map(n => (n as { props: { alt: string } }).props.alt)].join('\n')

const pane = (surface: 'desktop' | 'mobile' | 'terminal', bodyColumns: number) =>
  ({
    plugin: 'tasklane',
    component: 'Pane',
    requestId: 'tasklane',
    surface,
    props: { title: 'Tasklane', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

test('the saved board draws on every surface and width, and its controls work', async ($, on) => {
  mock.store(on, { 'board:s1': SAVED })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 's1' }))
  on('command.register', () => ({ value: { command: 'tasklane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const [surface, width] of [['desktop', 120], ['desktop', 60], ['mobile', 40], ['terminal', 80]] as const) {
    const ui = await $.ui.mount(pane(surface, width))
    expect(await shown(ui as never)).toMatch(/Needs you 1/)
    // Surfaces that draw vector art show the figures in the header drawing, the terminal as tiles.
    const hero = (await ui.findAll({ type: 'Svg' })).map(n => n as unknown as { props: { alt: string } }).find(n => n.props.alt.startsWith('Session cost'))
    const figures = hero ? hero.props.alt : (await ui.findAll({ type: 'Text' })).map(n => (n as { text?: string }).text).join('\n')
    expect(hero !== undefined).toBe(surface !== 'terminal')
    expect(figures).toContain('$109.10')
    expect(figures).toContain('$2.00')
    expect(figures).toContain('new input 4k · cache 4.4M · output 396k')
    await ui.unmount()
  }

  const ui = await $.ui.mount(pane('desktop', 60))
  await ui.press({ key: 'turn:' + (NOW - 1000) })
  expect(await ui.find({ type: 'Text', text: 'UI/UX refresh' })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 't1' })
  expect(await ui.find({ type: 'Text', text: /waiting 1 h/ })).toBeDefined()
  await ui.press({ key: 'done' })
  await ui.press({ key: 'back' })
  expect(await shown(ui as never)).toMatch(/Done 2/)

  await ui.input({ key: 'rule', text: 'Check the code, not docs' })
  expect(await ui.find({ key: 'r:Check the code, not docs' })).toBeDefined()

  await ui.input({ key: 'search', text: 'playwright picking' })
  expect(await ui.find({ key: 't1' })).toBeDefined()
  expect(await ui.find({ key: 't2' })).toBeUndefined()
  await ui.press({ key: 'clear' })
  expect(await ui.find({ key: 't2' })).toBeDefined()

  // Folding a column hides its cards; the index unfolds it again.
  await ui.press({ key: 'toggle:col:done' })
  expect(await ui.find({ key: 't1' })).toBeUndefined()
  // The index shows one section alone; pressing it again shows everything.
  await ui.press({ key: 'nav:col:done' })
  expect(await ui.find({ key: 't1' })).toBeDefined()
  expect(await ui.find({ key: 't2' })).toBeUndefined()
  expect(await ui.find({ key: 'rule' })).toBeUndefined()
  await ui.press({ key: 'nav:col:done' })
  expect(await ui.find({ key: 't2' })).toBeDefined()
  expect(await ui.find({ key: 'rule' })).toBeDefined()
  await ui.press({ key: 'toggle:rules' })
  expect(await ui.find({ key: 'rule' })).toBeUndefined()
  await ui.press({ key: 'fold-all' })
  expect(await ui.find({ key: 't2' })).toBeUndefined()
  await ui.press({ key: 'fold-all' })
  expect(await ui.find({ key: 'rule' })).toBeDefined()

  await ui.press({ key: 'l:billing-api' })
  expect(await ui.find({ type: 'Text', text: /No board for this session on this Mac/ })).toBeDefined()
  await ui.unmount()
})

test('a new board reads the session history into tasks once', async ($, on) => {
  mock.store(on, {})
  mock.clock(on, { now: NOW })
  const read = {
    found: true,
    title: 'acme-web',
    prompts: [
      { at: NOW - 9000, text: 'login goes to a blank page', cost: 1.5, tokens: 100, ms: 1000, asks: false },
      { at: NOW - 7000, text: 'go ahead', cost: 0.5, tokens: 50, ms: 1000, asks: false },
      { at: NOW - 5000, text: 'add a dark mode toggle', cost: 2, tokens: 80, ms: 1000, asks: true },
    ],
    sent: { 'billing-api': 2 },
    received: { 'billing-api': 5 },
  }
  let runs = 0
  on('session.id', () => ({ value: 's2' }))
  on('command.register', () => ({ value: { command: 'tasklane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const used = {
    found: true,
    main: { cost: 3, input: 10, cached: 2000, output: 300, calls: 4, model: 'claude-opus-5-5' },
    agents: [
      { cost: 1, input: 5, cached: 900, output: 100, calls: 2, model: 'claude-sonnet-5-5', id: 'a1', type: 'Explore', description: 'Map the login flow', at: NOW - 8000, ms: 60000, finished: true },
    ],
  }
  on('process.run', (_, e) => {
    // The usage reader looks in the subagents folder; the history reader doesn't.
    const usage = e.argv.join(' ').includes('subagents')
    if (!usage) runs += 1
    return { value: { exitCode: 0, stdout: JSON.stringify(usage ? used : read), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '0 | Fix login redirect\n2 | Dark mode toggle', usage: {} } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...pane('desktop', 120), requestId: 'tasklane' })
  for (let i = 0; i < 50 && !(await ui.find({ key: 'h' + (NOW - 5000) })); i++) await new Promise(r => setTimeout(r, 10))
  expect(await ui.find({ key: 'h' + (NOW - 9000) })).toBeDefined()
  const alts = (await ui.findAll({ type: 'Svg' })).map(n => (n as unknown as { props: { alt: string } }).props.alt)
  expect(alts.find(a => a.startsWith('Session cost'))).toContain('$4.00')
  expect(await ui.find({ key: 'l:billing-api' })).toBeDefined()
  // Main chat and each subagent, the subagent filed under the task in progress when it started.
  for (let i = 0; i < 50 && !(await ui.find({ key: 'ag:a1' })); i++) await new Promise(r => setTimeout(r, 10))
  expect(await ui.find({ type: 'Text', text: /main chat \$3\.00 · 1 subagent \$1\.00/ })).toBeDefined()
  await ui.press({ key: 'ag:a1' })
  expect(await ui.find({ key: 'sa:a1' })).toBeDefined()
  await ui.press({ key: 'back' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(runs).toBe(1)
  await ui.unmount()
})

test('a turn ends every running card, the work shared among them', async ($, on) => {
  const two = { ...SAVED, session: 's3', cards: [card('a', 'First ask', 'running', 0), card('b', 'Asked mid-turn', 'running', 0)], current: 'b', baseline: 0 }
  mock.store(on, { 'board:s3': two })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 's3' }))
  on('session.usage', () => ({ value: { cost: { usd: 3 } } }) as never)
  on('command.register', () => ({ value: { command: 'tasklane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }) as never)
  let asked = ''
  on('model.complete', (_, e) => {
    asked = (e as { prompt: string }).prompt
    return { value: { isAnswered: true, text: '"Pick which bug to fix first."', usage: {} } } as never
  })
  on('process.run', (_, e) => {
    // The row finder answers with the transcript's message ids; the usage reader finds no transcript.
    const rows = e.argv.join(' ').includes('want')
    return { value: { exitCode: 0, stdout: rows ? JSON.stringify({ b: 'msg-b' }) : '{"found": false}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'Which one first?', durationMs: 1000, isAborted: false } as never)
  const ui = await $.ui.mount({ ...pane('desktop', 120) })
  expect(await shown(ui as never)).toMatch(/Running 0/)
  await ui.press({ key: 'a' })
  expect(await ui.find({ type: 'Text', text: '$1.50' })).toBeDefined()
  await ui.press({ key: 'back' })

  // The task in progress is named from what was said and answered; its opening message stays on hover and in its detail.
  for (let i = 0; i < 50 && !asked; i++) await new Promise(r => setTimeout(r, 10))
  expect(asked).toContain('Which one first?')
  expect((await ui.find({ key: 'b' }))?.text).toBe('Pick which bug to fix first')
  expect(await ui.find({ type: 'Text', text: /“Asked mid-turn”/ })).toBeDefined()

  await ui.press({ key: 'b' })
  expect(await ui.find({ type: 'Text', text: /Opened with “Asked mid-turn”/ })).toBeDefined()
  // The desktop can't scroll the chat for a mod; the terminal can, once the transcript holds the opening message.
  expect(await ui.find({ key: 'goto' })).toBeUndefined()
  const term = await $.ui.mount({ ...pane('terminal', 120) })
  for (let i = 0; i < 50 && !(await term.find({ key: 'goto' })); i++) await new Promise(r => setTimeout(r, 10))
  expect(await term.find({ key: 'goto' })).toBeDefined()
  await term.unmount()
  await ui.unmount()
})

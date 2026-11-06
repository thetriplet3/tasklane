import { expect, test } from 'claude-code/testing'

import { bumpLink, emptyBoard, isAgentId, isFollowUp, newCard, parseStarts, pastCards, peerName, statusAfter } from '../hooks/board'

test('status checks and go-aheads stay on the task in progress', async () => {
  for (const t of ['go ahead', 'Okay go ahewad', 'what is the status now?', 'logged in', 'yes please fix', 'how about now'])
    expect(isFollowUp(t)).toBe(true)
  for (const t of ['can we have our own delete dialog?', 'next we have to implement rolling updates', 'yes but first check how the api pages large reads and then port it'])
    expect(isFollowUp(t)).toBe(false)
})

test('a turn ending on a question needs the person', async () => {
  expect(statusAfter('Which fix first?')).toBe('you')
  expect(statusAfter('Merged as #1330.')).toBe('done')
})

test('peer messages and sends count per session, not per agent', async () => {
  expect(peerName('<cross-session-message from="uds:/x.sock" from-name="billing-api">hi')).toBe('billing-api')
  expect(isAgentId('a398ff63843fa58a1')).toBe(true)
  expect(isAgentId('acme-web')).toBe(false)
  const b = { ...emptyBoard('s'), cards: [newCard('t1', 'Cut search calls', 1)], current: 't1' }
  const twice = bumpLink(bumpLink(b, 'acme-web', 'sent'), 'acme-web', 'received')
  expect(twice.links).toEqual([{ name: 'acme-web', sent: 1, received: 1, card: 'Cut search calls' }])
})

test('past messages group into cards where the model says a task starts', async () => {
  const past = (text: string, at: number) => ({ at, text, cost: 1, tokens: 10, ms: 5, asks: false })
  const starts = parseStarts('0 | Fix login redirect\n2 | Dark mode toggle\nnot a line')
  expect(starts.size).toBe(2)
  const cards = pastCards([past('login goes to a blank page', 1), past('go ahead', 2), past('add dark mode', 3), past('also the sidebar', 4)], starts)
  expect(cards.map(c => c.title)).toEqual(['Fix login redirect', 'Dark mode toggle'])
  expect(cards[0]!.fold).toBe(1)
  expect(cards[1]!.msgs.length).toBe(2)
  expect(cards[1]!.cost).toBe(2)
})

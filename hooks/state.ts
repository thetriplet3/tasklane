import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Board } from '../types'
import { emptyBoard } from './board'

export const PANE = 'tasklane'

// The id the chat draws each typed message under, by its opening text: noted while drawing, which may not write state.
// shortcut: lives in the module, so a reload forgets rows until the chat draws them again.
export const ROWS = new Map<string, string>()
export const rowKey = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200)

// Change a tag when its value's fields change: it declines what an earlier version stored.
const board = atom({ plugin: 'tasklane', key: 'board' } as const, emptyBoard(''), { shape: 'board-2' })

// Every change is saved across sessions too, so another session's board can open this one.
// shortcut: whole board per write, capped at 100 cards and 500 turns; move to per-card keys if the 4 MiB store fills.
async function save($: EngineInterface, b: Board) {
  const kept = { ...b, cards: b.cards.slice(-100), turns: b.turns.slice(-500), updated: await $.clock.now() }
  await $.store.set(`board:${b.session}`, kept)
  if (b.name !== '') await $.store.set(`name:${b.name}`, b.session)
}

export async function change($: EngineInterface, fn: (b: Board) => Board) {
  const b = await update($, board, fn)
  await save($, b).catch(() => $.ui.status('Tasklane: could not save the board'))
  return b
}

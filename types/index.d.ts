export type Status = 'you' | 'running' | 'parked' | 'done'

export type Card = {
  id: string
  title: string
  status: Status
  started: number
  since: number
  msgs: string[]
  fold: number
  cost: number
  tokens: number
  // The split of tokens; absent on cards an earlier version saved.
  input?: number
  cached?: number
  output?: number
  ms: number
  // The message that opened the task, and how many messages the model-written title was made from.
  first?: string
  named?: number
  // The chat row of that message, to scroll to; '' where the transcript had none.
  row?: string
}

export type Link = { name: string; sent: number; received: number; card?: string }

export type Turn = { at: number; cost: number; card?: string }

export type Board = {
  session: string
  name: string
  cards: Card[]
  current?: string
  links: Link[]
  rules: string[]
  turns: Turn[]
  baseline: number
  updated: number
  // Whether the messages from before the board loaded were read in.
  imported?: boolean
}

// Token use read from the transcripts: the main chat's, and each subagent's.
export type Usage = { cost: number; input: number; cached: number; output: number; calls: number; model: string }
export type AgentUse = Usage & { id: string; type: string; description: string; at: number; ms: number; finished: boolean }
export type Agents = { main: Usage; agents: AgentUse[]; updated: number }

// `closed` lists the sections and columns the person folded.
export type View = { card?: string; peer?: string; q?: string; closed?: string[]; sort?: 'cost' | 'time' }

declare module 'claude-code' {
  interface PluginState {
    'tasklane': { board: Shaped<Board>; view: Shaped<View>; agents: Shaped<Agents> }
  }
}

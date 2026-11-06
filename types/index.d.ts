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

// `card` is the task's title when the link last moved, kept for boards saved before `cardId`; the view shows the task's current title.
export type Link = { name: string; sent: number; received: number; card?: string; cardId?: string }

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

// What the mod itself is doing: each background read, and what its Haiku calls cost by purpose.
export type JobKind = 'history' | 'usage' | 'names'
export type Job = { state: 'running' | 'done' | 'failed'; step: string; started: number; at: number; ms?: number; runs: number }
export type Purpose = 'sort' | 'name' | 'backlog'
export type Spend = { calls: number; failed: number; input: number; cached: number; written: number; output: number; cost: number; ms: number; last: number }
export type Activity = { jobs: Partial<Record<JobKind, Job>>; spend: Partial<Record<Purpose, Spend>> }

// `closed` lists the sections and columns the person folded.
// `days` lists the Done days the person opened or folded against the default; `more` the days showing every card.
export type View = { card?: string; peer?: string; q?: string; closed?: string[]; sort?: 'cost' | 'time'; days?: string[]; more?: string[] }

declare module 'claude-code' {
  interface PluginState {
    'tasklane': { board: Shaped<Board>; view: Shaped<View>; agents: Shaped<Agents>; activity: Shaped<Activity> }
  }
}

import { atom, update } from 'claude-code'
import type { EngineInterface, ModelCompleteRequest, ModelCompleteResult, ModelUsage } from 'claude-code'

import type { Activity, JobKind, Purpose, Spend } from '../types'

export const NO_ACTIVITY: Activity = { jobs: {}, spend: {} }
const activity = atom({ plugin: 'tasklane', key: 'activity' } as const, NO_ACTIVITY, { shape: 'activity-1' })

// A job's progress: a run starts its clock when it first goes running, and its time is kept when it ends.
export async function job($: EngineInterface, kind: JobKind, state: 'running' | 'done' | 'failed', step: string) {
  const now = await $.clock.now()
  await update($, activity, a => {
    const was = a.jobs[kind]
    const fresh = state === 'running' && was?.state !== 'running'
    const started = fresh || !was ? now : was.started
    const ms = state !== 'running' && was?.state === 'running' ? now - was.started : was?.ms
    return { ...a, jobs: { ...a.jobs, [kind]: { state, step, started, at: now, ms, runs: (was?.runs ?? 0) + (fresh ? 1 : 0) } } }
  })
}

// shortcut: priced as Haiku 5.5 at list prices ($0.10 in, $0.50 out, $0.01 cache read per million); update if 'haiku' resolves to another model.
export const haikuCost = (u: ModelUsage) =>
  ((u.input_tokens ?? 0) * 0.1 + (u.output_tokens ?? 0) * 0.5 + (u.cache_read_input_tokens ?? 0) * 0.01 + (u.cache_creation_input_tokens ?? 0) * 0.125) / 1e6

const NONE: Spend = { calls: 0, failed: 0, input: 0, cached: 0, written: 0, output: 0, cost: 0, ms: 0, last: 0 }

// A Haiku call, its tokens and cost added to its purpose's tally.
export async function ask($: EngineInterface, purpose: Purpose, req: ModelCompleteRequest): Promise<ModelCompleteResult | undefined> {
  const started = await $.clock.now()
  const reply = await $.model.complete(req).catch(() => undefined)
  const now = await $.clock.now()
  const u: ModelUsage | undefined = reply && 'usage' in reply ? (reply.usage as ModelUsage | undefined) : undefined
  await update($, activity, a => {
    const s = a.spend[purpose] ?? NONE
    const next: Spend = {
      calls: s.calls + 1,
      failed: s.failed + (reply?.isAnswered ? 0 : 1),
      input: s.input + (u?.input_tokens ?? 0),
      cached: s.cached + (u?.cache_read_input_tokens ?? 0),
      written: s.written + (u?.cache_creation_input_tokens ?? 0),
      output: s.output + (u?.output_tokens ?? 0),
      cost: s.cost + (u ? haikuCost(u) : 0),
      ms: s.ms + (now - started),
      last: now,
    }
    return { ...a, spend: { ...a.spend, [purpose]: next } }
  })
  return reply
}

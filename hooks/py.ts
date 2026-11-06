import type { EngineInterface } from 'claude-code'

// Interpreters to try in order: macOS and Linux ship python3; Windows usually has python or the py launcher.
const PYTHONS = [['python3'], ['python'], ['py', '-3']]
// The first that answered with JSON, tried first next time.
let found: string[] | undefined

// Runs a reader script and parses its JSON; on failure says why, in a line short enough for the Activity section.
export async function runPy($: EngineInterface, script: string, args: string[], timeoutMs: number): Promise<{ out?: unknown; why: string }> {
  let why = 'No Python found (tried python3, python and py)'
  for (const py of found ? [found, ...PYTHONS.filter(p => p !== found)] : PYTHONS) {
    const ran = await $.process.run([...py, '-I', '-c', script, ...args], { timeoutMs }).catch(() => undefined)
    if (!ran) continue
    try {
      const out: unknown = JSON.parse(ran.stdout)
      found = py
      return { out, why: '' }
    } catch {
      // A Python that ran and failed is the real error; a missing one (Windows' store alias exits 9009) is skipped.
      const last = ran.stderr.trim().split('\n').at(-1)?.trim() ?? ''
      if (ran.exitCode === 9009 || /not found|was not found|No such file/i.test(last)) continue
      why = ran.isStdoutTruncated ? 'The reader’s output was too big to read' : `${py[0]} failed: ${last.slice(0, 160) || `exit ${ran.exitCode}`}`
      break
    }
  }
  return { why }
}

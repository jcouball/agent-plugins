// Spike: keep NODE_V8_COVERAGE away from every process the tests start.
// Node copies it from process.env into a child even when the caller passes its own env,
// and the tests also build their env from a copy of process.env, so strip both.
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const optionsAt = (args) => {
  for (let i = args.length - 1; i >= 1; i -= 1) if (args[i] && typeof args[i] === 'object' && !Array.isArray(args[i])) return i
  return -1
}
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[name]
  childProcess[name] = function (...args) {
    const at = optionsAt(args)
    if (at !== -1 && args[at].env) {
      const env = { ...args[at].env }
      delete env.NODE_V8_COVERAGE
      args[at] = { ...args[at], env }
    }
    const saved = process.env.NODE_V8_COVERAGE
    delete process.env.NODE_V8_COVERAGE
    try {
      return original.apply(this, args)
    } finally {
      if (saved !== undefined) process.env.NODE_V8_COVERAGE = saved
    }
  }
}
syncBuiltinESMExports()

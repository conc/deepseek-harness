/** Pins the scheduler seam to one process-global identity: dsh-agent-loop reads it off ctx.tools. */

import { describe, expect, it } from 'vitest'
import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'

describe('TOOL_RUNTIME_SCHEDULER', () => {
  it('is a registered symbol, so every loaded copy of the module agrees', () => {
    expect(Symbol.keyFor(TOOL_RUNTIME_SCHEDULER)).toBe('@deepseek-ai/dsh-tools.scheduler')
  })
})

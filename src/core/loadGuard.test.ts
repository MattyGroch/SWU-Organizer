import { describe, expect, it } from 'vitest'
import { createLoadCommitGate } from './loadGuard'

describe('load commit gate', () => {
  it('allows only the latest async load to commit', () => {
    const gate = createLoadCommitGate()
    const first = gate.begin()
    const second = gate.begin()

    expect(gate.canCommit(first)).toBe(false)
    expect(gate.canCommit(second)).toBe(true)
  })

  it('invalidates a load when its effect is cancelled', () => {
    const gate = createLoadCommitGate()
    const request = gate.begin()
    gate.cancel(request)

    expect(gate.canCommit(request)).toBe(false)
  })
})

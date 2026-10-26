import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRijOpslag, BULK_SLEUTEL } from '@/lib/use-rij-opslag'

type Status = 'a' | 'b' | 'c'

function setup(bevestigd: Record<string, Status> = { x: 'a', y: 'a' }) {
  const calls: Array<{ k: string; v: Status; resolve: () => void; reject: () => void }> = []
  const opslaan = vi.fn((k: string, v: Status) => new Promise<void>((resolve, reject) => {
    calls.push({ k, v, resolve, reject: () => reject(new Error('serverfout')) })
  }))
  const onFout = vi.fn()
  const hook = renderHook(() => useRijOpslag<Status>({ bevestigd, opslaan, onFout }))
  return { hook, calls, opslaan, onFout }
}

describe('useRijOpslag', () => {
  it('toont de waarde optimistisch en houdt hem na succes', async () => {
    const { hook, calls, onFout } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    expect(hook.result.current.waarden.x).toBe('b')
    expect(hook.result.current.isOnderweg('x')).toBe(true)
    await act(async () => { calls[0].resolve() })
    expect(hook.result.current.waarden.x).toBe('b')
    expect(hook.result.current.isOnderweg('x')).toBe(false)
    expect(hook.result.current.iemandOnderweg).toBe(false)
    expect(onFout).not.toHaveBeenCalled()
  })

  it('twee tikken op dezelfde rij: twee calls in volgorde, laatste is eindstand', async () => {
    const { hook, calls, opslaan } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    act(() => { hook.result.current.zet('x', 'c') })
    expect(opslaan).toHaveBeenCalledTimes(1)
    expect(hook.result.current.waarden.x).toBe('c')
    await act(async () => { calls[0].resolve() })
    expect(opslaan).toHaveBeenCalledTimes(2)
    expect(opslaan).toHaveBeenLastCalledWith('x', 'c')
    await act(async () => { calls[1].resolve() })
    expect(hook.result.current.waarden.x).toBe('c')
  })

  it('wachtende waarde gelijk aan de net opgeslagen waarde geeft geen extra call', async () => {
    const { hook, calls, opslaan } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    act(() => { hook.result.current.zet('x', 'c') })
    act(() => { hook.result.current.zet('x', 'b') })
    await act(async () => { calls[0].resolve() })
    expect(opslaan).toHaveBeenCalledTimes(1)
    expect(hook.result.current.waarden.x).toBe('b')
  })

  it('rij B wordt direct verstuurd terwijl rij A onderweg is', () => {
    const { hook, opslaan } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    act(() => { hook.result.current.zet('y', 'c') })
    expect(opslaan).toHaveBeenCalledTimes(2)
    expect(opslaan).toHaveBeenNthCalledWith(2, 'y', 'c')
  })

  it('fout: rij terug naar bevestigd, wachtende waarde vervalt, onFout(k)', async () => {
    const { hook, calls, opslaan, onFout } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    act(() => { hook.result.current.zet('x', 'c') })
    await act(async () => { calls[0].reject() })
    expect(hook.result.current.waarden.x).toBe('a')
    expect(opslaan).toHaveBeenCalledTimes(1)
    expect(onFout).toHaveBeenCalledWith('x')
    expect(hook.result.current.isOnderweg('x')).toBe(false)
  })

  it('fout na een eerdere succes: terug naar de laatst bevestigde, niet de initiële waarde', async () => {
    const { hook, calls } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    await act(async () => { calls[0].resolve() })
    act(() => { hook.result.current.zet('x', 'c') })
    await act(async () => { calls[1].reject() })
    expect(hook.result.current.waarden.x).toBe('b')
  })

  it('een rij zonder bevestigde waarde verdwijnt bij een fout (onbekend)', async () => {
    const { hook, calls } = setup({})
    act(() => { hook.result.current.zet('nieuw', 'b') })
    await act(async () => { calls[0].reject() })
    expect('nieuw' in hook.result.current.waarden).toBe(false)
  })

  it('zetAlles: optimistisch, bulkOnderweg, en rij-tikken worden genegeerd', async () => {
    const { hook, opslaan } = setup()
    let resolve: () => void = () => {}
    const bulk = vi.fn(() => new Promise<void>((r) => { resolve = r }))
    act(() => { hook.result.current.zetAlles({ x: 'c', y: 'c' }, bulk) })
    expect(hook.result.current.waarden).toEqual({ x: 'c', y: 'c' })
    expect(hook.result.current.bulkOnderweg).toBe(true)
    expect(hook.result.current.iemandOnderweg).toBe(true)
    act(() => { hook.result.current.zet('x', 'b') })
    expect(opslaan).not.toHaveBeenCalled()
    await act(async () => { resolve() })
    expect(hook.result.current.bulkOnderweg).toBe(false)
    expect(hook.result.current.waarden.x).toBe('c')
  })

  it('zetAlles faalt: alles terug naar bevestigd en onFout(BULK_SLEUTEL)', async () => {
    const { hook, onFout } = setup()
    await act(async () => { hook.result.current.zetAlles({ x: 'c', y: 'c' }, () => Promise.reject(new Error('x'))) })
    expect(hook.result.current.waarden).toEqual({ x: 'a', y: 'a' })
    expect(onFout).toHaveBeenCalledWith(BULK_SLEUTEL)
    expect(hook.result.current.bulkOnderweg).toBe(false)
  })

  it('zetAlles wordt genegeerd als een rij onderweg is', () => {
    const { hook } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    const bulk = vi.fn().mockResolvedValue(undefined)
    act(() => { hook.result.current.zetAlles({ x: 'c', y: 'c' }, bulk) })
    expect(bulk).not.toHaveBeenCalled()
  })

  it('synchroniseer neemt serverwaarden over, behalve voor rijen die onderweg zijn', async () => {
    const { hook, calls } = setup()
    act(() => { hook.result.current.zet('x', 'b') })
    act(() => { hook.result.current.synchroniseer({ x: 'c', y: 'c' }) })
    expect(hook.result.current.waarden).toEqual({ x: 'b', y: 'c' })
    await act(async () => { calls[0].reject() })
    // x was onderweg en bleef op zijn eigen bevestigde waarde ('a')
    expect(hook.result.current.waarden.x).toBe('a')
  })
})

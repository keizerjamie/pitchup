import { describe, it, expect, vi, afterEach } from 'vitest'
import { volgOpslag, registreerFlush, wachtOpOpslag, abonneerOpslag, OpslagTimeoutFout } from '@/lib/opslag-wachtrij'

afterEach(() => {
  vi.useRealTimers()
})

function uitgesteld<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('opslag-wachtrij', () => {
  it('resolvet direct met een lege wachtrij', async () => {
    await expect(wachtOpOpslag({ timeoutMs: 1000 })).resolves.toBeUndefined()
  })

  it('wacht op een lopende opslag', async () => {
    const d = uitgesteld()
    volgOpslag(d.promise)
    let klaar = false
    const wacht = wachtOpOpslag({ timeoutMs: 1000 }).then(() => {
      klaar = true
    })
    await Promise.resolve()
    expect(klaar).toBe(false)
    d.resolve()
    await wacht
    expect(klaar).toBe(true)
  })

  it('roept eerst alle flushers aan, en wacht op de opslag die ze starten', async () => {
    const d = uitgesteld()
    const flush = vi.fn(() => {
      volgOpslag(d.promise)
    })
    const afmelden = registreerFlush(flush)
    let klaar = false
    const wacht = wachtOpOpslag({ timeoutMs: 1000 }).then(() => {
      klaar = true
    })
    expect(flush).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(klaar).toBe(false)
    d.resolve()
    await wacht
    afmelden()
    await wachtOpOpslag({ timeoutMs: 1000 })
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('een mislukte opslag blokkeert niet', async () => {
    const d = uitgesteld()
    const gevolgd = volgOpslag(d.promise)
    gevolgd.catch(() => {})
    const wacht = wachtOpOpslag({ timeoutMs: 1000 })
    d.reject(new Error('stuk'))
    await expect(wacht).resolves.toBeUndefined()
  })

  it('gooit een OpslagTimeoutFout als de opslag te lang duurt', async () => {
    vi.useFakeTimers()
    const d = uitgesteld()
    volgOpslag(d.promise)
    const wacht = wachtOpOpslag({ timeoutMs: 10_000 })
    const verwacht = expect(wacht).rejects.toBeInstanceOf(OpslagTimeoutFout)
    await vi.advanceTimersByTimeAsync(10_000)
    await verwacht
    d.resolve()
  })

  it('abonneerOpslag krijgt een seintje bij volgOpslag en stopt na afmelden', async () => {
    const luister = vi.fn()
    const afmelden = abonneerOpslag(luister)
    const d1 = uitgesteld()
    volgOpslag(d1.promise)
    expect(luister).toHaveBeenCalledTimes(1)
    afmelden()
    const d2 = uitgesteld()
    volgOpslag(d2.promise)
    expect(luister).toHaveBeenCalledTimes(1)
    d1.resolve()
    d2.resolve()
    await wachtOpOpslag({ timeoutMs: 1000 })
  })
})

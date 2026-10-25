import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookiesVoorRender, MIN_RESTERENDE_SESSIE_S, zorgVoorRuimeSessie } from '@/lib/pdf/sessie'

const NU = Date.UTC(2026, 9, 25, 12, 0, 0)

type RefreshAntwoord = { data: { session: object | null }; error: unknown }

function client(expiresAt: number | undefined | null, refresh: RefreshAntwoord = { data: { session: {} }, error: null }) {
  const getSession = vi.fn(async () =>
    expiresAt === null
      ? { data: { session: null }, error: null }
      : { data: { session: { expires_at: expiresAt } }, error: null },
  )
  const refreshSession = vi.fn(async () => refresh)
  return { supabase: { auth: { getSession, refreshSession } } as unknown as SupabaseClient, getSession, refreshSession }
}

const seconden = (s: number) => NU / 1000 + s

describe('zorgVoorRuimeSessie', () => {
  it('ruim geldig token: geen verversing', async () => {
    const { supabase, refreshSession } = client(seconden(3600))

    expect(await zorgVoorRuimeSessie(supabase, NU)).toBe(true)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('precies op de grens: geen verversing', async () => {
    const { supabase, refreshSession } = client(seconden(MIN_RESTERENDE_SESSIE_S))

    expect(await zorgVoorRuimeSessie(supabase, NU)).toBe(true)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('net onder de grens (binnen render-venster): ververst', async () => {
    const { supabase, refreshSession } = client(seconden(MIN_RESTERENDE_SESSIE_S - 1))

    expect(await zorgVoorRuimeSessie(supabase, NU)).toBe(true)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('verversen mislukt: false', async () => {
    const { supabase } = client(seconden(5), { data: { session: null }, error: { code: 'x' } })

    expect(await zorgVoorRuimeSessie(supabase, NU)).toBe(false)
  })

  it('geen sessie: false, geen verversing', async () => {
    const { supabase, refreshSession } = client(null)

    expect(await zorgVoorRuimeSessie(supabase, NU)).toBe(false)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('sessie zonder expires_at: true (niets te beoordelen)', async () => {
    const { supabase, refreshSession } = client(undefined)

    expect(await zorgVoorRuimeSessie(supabase, NU)).toBe(true)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('marge dekt de 90 s van supabase-js plus het render-budget van 60 s', () => {
    expect(MIN_RESTERENDE_SESSIE_S).toBeGreaterThanOrEqual(90 + 60)
  })
})

describe('cookiesVoorRender', () => {
  it('laat verwijderde (lege) cookies weg en houdt alleen naam en waarde', () => {
    const uit = cookiesVoorRender([
      { name: 'a', value: '1', path: '/' } as { name: string; value: string },
      { name: 'sb-x-auth-token.1', value: '' },
    ])

    expect(uit).toEqual([{ name: 'a', value: '1' }])
  })
})

// Acceptatietests — Recente vorm (W/G/V) in de "Vorm"-tegel op de
// hoofdpagina (user story: als coach in één oogopslag de vorm van de
// laatste 5 afgelopen wedstrijden zien in app/page.tsx, zonder naar de
// kalender/wedstrijdanalyses te hoeven).
//
// Sinds de opvolgende ronde is de dashboardtegel omgezet van "Aankomende
// events" (label + getal) naar "Vorm" (label + de vorm-strip zelf als
// hoofdelement, of een hint-tekst bij lege staat) — zie app/page.tsx:321-325.
// De i18n-key `statUpcoming` bestaat niet meer; de nieuwe keys zijn
// `statForm` ("Vorm") en `formEmpty` ("Nog geen wedstrijden gespeeld").
//
// ── AC → test-mapping (nummering exact zoals in de goedgekeurde story) ──
//   AC1  → describe('AC1 — vorm-strip in de "Vorm"-tegel')
//   AC2  → describe('AC2 — W bij meer doelpunten voor, kleur --chip-green-fg')
//   AC3  → describe('AC3 — G bij gelijkspel, kleur --chip-amber-fg')
//   AC4  → describe('AC4 — V bij meer doelpunten tegen, kleur --chip-red-fg')
//   AC5  → describe('AC5 — volgorde: meest recent links, ouder naar rechts')
//   AC6  → describe('AC6 — i18n: alle 5 talen tonen hun eigen letters')
//   AC7  → describe('AC7 — kleuren uitsluitend via theme-tokens')
//   AC8  → describe('AC8 — wedstrijd zonder uitslag telt mee als "?"-positie')
//   AC9  → describe('AC9 — niet ingelogd: bestaande /login-redirect blijft werken')
//   AC10 → describe('AC10 — tenant-isolatie: alleen eigen team_id')
//   AC11 → describe('AC11 — cutoff: strikt vóór vandaag')
//   AC12 → describe('AC12 — geen skip/verder-terugzoeken bij ontbrekende uitslag')
//   AC13 → describe('AC13 — alle match_types tellen mee, inclusief friendly')
//   AC14 → describe('AC14 — nooit meer dan 5 tekens, nooit vandaag/later')
//   AC15 → describe('AC15 — minder dan 5 afgelopen wedstrijden: alleen wat er is')
//   AC16 → describe('AC16 — 0 afgelopen wedstrijden: geen strip, wel hint-tekst')
//   AC17 → describe('AC17 — tie-break bij gelijke datum: created_at desc, dan id desc')
//
// ── Testmethode ──
// Dit bestand rendert de ECHTE app/page.tsx (DashboardPage, een async server
// component — gewoon een functie die JSX teruggeeft) rechtstreeks met RTL,
// met uitsluitend @/lib/supabase/server en next/navigation gestubd — zelfde
// precedent als afdrukken-trainingsplan.acceptance.test.tsx (renderPage()) en
// teamindeling.acceptance.test.tsx. Dat bewijst de volledige keten van
// buitenaf: (in-memory) database-rijen → de ECHTE Supabase-querychain in
// app/page.tsx → de ECHTE matchResult() → de ECHTE FormStrip-render, zoals de
// coach hem op het scherm ziet.
//
// De Supabase-mock hieronder is GEEN kopie van scripts/match-form.acceptance
// .test.mjs se `selectRecentForm`-harnas (dat een kant-en-klare uitkomst
// teruggeeft). In plaats daarvan is het een generieke tabel-engine die de
// ECHTE method-chain-aanroepen (.eq/.neq/.gte/.lte/.lt/.in/.order/.limit) die
// app/page.tsx doet, toepast op een gedeelde in-memory rijenset — dus als de
// productiequery een filter/sorteer/limit-stap zou missen of verkeerd om
// zetten, faalt deze test net zo hard als tegen een echte Postgres-database.
//
// getDict() (lib/i18n.ts) is gewrapt in React's cache() — binnen één
// testbestand blijft die daardoor voor de EERSTE aangeroepen locale
// (hier altijd 'nl', want de cookies-mock geeft nooit een locale-cookie
// terug) hangen. Alle page-niveau tests hieronder draaien daarom bewust in
// het Nederlands. AC6 (i18n in de overige 4 talen) wordt apart gedekt door
// de ECHTE, geïmporteerde FormStrip + matchResult rechtstreeks te renderen
// met de en/de/fr/es-dictionaries (zie dat blok voor de volledige motivatie).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { en } from '@/messages/en'
import { de } from '@/messages/de'
import { fr } from '@/messages/fr'
import { es } from '@/messages/es'
import { matchResult } from '@/lib/match-analysis.mjs'
import FormStrip from '@/components/dashboard/FormStrip'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`__redirect__:${to}`)
  }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardPage from '@/app/page'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY_ISO()}T10:00:00`))
})

afterEach(() => {
  vi.useRealTimers()
})

// Vaste "vandaag" (lokale kalenderdag) zodat de tests niet van de systeemklok
// afhangen — todayLocal() (lib/utils.ts) leest new Date(), die we hierboven
// met vi.setSystemTime() vastzetten op precies deze datum.
function TODAY_ISO() {
  return '2026-08-03'
}
const TODAY = TODAY_ISO()
const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

function addDaysFixed(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Row = Record<string, unknown>

function matchRow(overrides: Row = {}): Row {
  return {
    id: 'm',
    team_id: TEAM,
    type: 'match',
    date: addDaysFixed(TODAY, -1),
    time: null,
    location: null,
    match_type: 'league',
    opponent: 'Tegenstander',
    home_away: 'home',
    notes: null,
    doelstelling: null,
    goals_for: null,
    goals_against: null,
    created_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

// ── Generieke Supabase-tabel-engine (zie kopcomment) ──
function tableFactory(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
    let limitN: number | null = null

    function resolveRows(): Row[] {
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const av = a[o.col] as string | number | null | undefined
            const bv = b[o.col] as string | number | null | undefined
            const aNull = av === null || av === undefined
            const bNull = bv === null || bv === undefined
            if (aNull && bNull) continue
            if (aNull) return o.nullsFirst ? -1 : 1
            if (bNull) return o.nullsFirst ? 1 : -1
            if (av! < bv!) return o.ascending ? -1 : 1
            if (av! > bv!) return o.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      return out
    }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return chain
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val)
        return chain
      },
      gt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) > (val as string | number))
        return chain
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) >= (val as string | number))
        return chain
      },
      lte: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) <= (val as string | number))
        return chain
      },
      lt: (col: string, val: unknown) => {
        filters.push((r) => (r[col] as string | number) < (val as string | number))
        return chain
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        orders.push({ col, ascending: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false })
        return chain
      },
      limit: (n: number) => {
        limitN = n
        return chain
      },
      maybeSingle: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      single: () => Promise.resolve({ data: resolveRows()[0] ?? null }),
      // `count` hoort erbij zodra een aanroeper `{ count: 'exact' }` vraagt
      // (app/page.tsx doet dat voor de nulmeting-bestaanscheck). Altijd
      // meesturen is onschadelijk: wie er niet om vroeg leest 'm niet.
      then: (resolve: (v: { data: Row[]; count: number }) => unknown) =>
        resolve({ data: resolveRows(), count: resolveRows().length }),
    }
    return chain
  }
}

// Zelfde tabel-engine als tableFactory(), maar de specifieke vorm-query
// (herkenbaar aan .eq('type', 'match') gecombineerd met .lt('date', …), de
// enige combinatie die app/page.tsx voor de vorm-strip gebruikt) geeft
// { data: null, error } terug — zoals een echte Supabase-DB-fout. De overige
// drie 'events'-queries op dezelfde pagina (upcoming/todo/training) blijven
// gewoon werken, want elke aanroep van from('events') krijgt een eigen,
// verse chain-instantie. Dit bewijst het faalpad uit bevinding 3: de pagina
// crasht niet en toont geen rauwe DB-fout, puur op basis van de bestaande
// `?? []`-fallback in app/page.tsx (regel 76-77) — geen test-workaround.
function tableFactoryVormError(rows: Row[]) {
  const base = tableFactory(rows)
  return () => {
    const chain = base() as Record<string, unknown>
    let sawTypeMatch = false
    let sawDateLt = false
    const origEq = chain.eq as (col: string, val: unknown) => unknown
    const origLt = chain.lt as (col: string, val: unknown) => unknown
    chain.eq = (col: string, val: unknown) => {
      if (col === 'type' && val === 'match') sawTypeMatch = true
      return origEq(col, val)
    }
    chain.lt = (col: string, val: unknown) => {
      sawDateLt = true
      return origLt(col, val)
    }
    const origThen = chain.then as (resolve: (v: { data: Row[] }) => unknown) => unknown
    chain.then = (resolve: (v: { data: Row[] | null; error?: unknown }) => unknown) => {
      if (sawTypeMatch && sawDateLt) {
        return resolve({ data: null, error: { message: 'db error (simulated)' } })
      }
      return origThen(resolve as (v: { data: Row[] }) => unknown)
    }
    return chain
  }
}

function makeSupabaseMock(opts: {
  user?: { id: string } | null
  events?: Row[]
  players?: Row[]
  teamName?: string | null
  vormQueryReturnsError?: boolean
  metingen?: Row[]
} = {}) {
  const user = opts.user === undefined ? { id: TEAM } : opts.user
  const eventsFactory = opts.vormQueryReturnsError
    ? tableFactoryVormError(opts.events ?? [])
    : tableFactory(opts.events ?? [])
  const playersFactory = tableFactory(opts.players ?? [])
  const settingsFactory = tableFactory(
    opts.teamName ? [{ team_id: TEAM, key: 'team_name', value: opts.teamName }] : [],
  )
  const metingenFactory = tableFactory(opts.metingen ?? [])
  const emptyFactory = tableFactory([]) // attendance/lineups/match_ratings/match_events/training_oefeningen/task_overrides
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === 'events') return eventsFactory()
      if (table === 'players') return playersFactory()
      if (table === 'settings') return settingsFactory()
      if (table === 'metingen') return metingenFactory()
      return emptyFactory()
    },
  }
}

async function renderDashboard(opts: {
  user?: { id: string } | null
  events?: Row[]
  players?: Row[]
  teamName?: string | null
  vormQueryReturnsError?: boolean
  metingen?: Row[]
} = {}) {
  vi.mocked(createClient).mockResolvedValue(
    makeSupabaseMock(opts) as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  const el = await DashboardPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

// Vindt de "Vorm"-tegel (StatCard met label t.home.statForm) — role="group"
// komt in de hele component-boom uitsluitend van FormStrip voor (geverifieerd:
// geen enkel ander component gebruikt role="group").
function vormCard(): HTMLElement {
  const label = screen.getByText(nl.home.statForm)
  const card = label.closest('.surface-card')
  if (!card) throw new Error('StatCard "Vorm" niet gevonden')
  return card as HTMLElement
}

function formGroup(): HTMLElement | null {
  return within(vormCard()).queryByRole('group')
}

function chipLetters(group: HTMLElement): string[] {
  return Array.from(group.querySelectorAll('span[aria-label]')).map((el) => el.textContent ?? '')
}

// ═══════════════════════════════════════════════════════════════════════
// AC1 — vorm-strip in de "Vorm"-tegel
// ═══════════════════════════════════════════════════════════════════════
describe('AC1 — vorm-strip in de "Vorm"-tegel', () => {
  it('toont een reeks tekens voor de laatste afgelopen wedstrijden, binnen de echte StatCard-tegel', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: 0 }),
        matchRow({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: 1, goals_against: 1 }),
        matchRow({ id: 'c', date: addDaysFixed(TODAY, -3), goals_for: 0, goals_against: 3 }),
      ],
    })
    const group = formGroup()
    expect(group).not.toBeNull()
    expect(group).toHaveAttribute('aria-label', nl.home.formLabel)
    expect(chipLetters(group!)).toEqual(['W', 'G', 'V'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC2 — W bij meer doelpunten voor, kleur --chip-green-fg
// ═══════════════════════════════════════════════════════════════════════
describe('AC2 — W bij meer doelpunten voor, kleur --chip-green-fg', () => {
  it('goals_for > goals_against → letter W, tekstkleur var(--chip-green-fg)', async () => {
    await renderDashboard({
      events: [matchRow({ id: 'w1', goals_for: 3, goals_against: 1 })],
    })
    const group = formGroup()!
    const chip = group.querySelector('span[aria-label]') as HTMLElement
    expect(chip.textContent).toBe(nl.home.formLetterWin)
    expect(chip).toHaveStyle({ color: 'var(--chip-green-fg)' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC3 — G bij gelijkspel, kleur --chip-amber-fg
// ═══════════════════════════════════════════════════════════════════════
describe('AC3 — G bij gelijkspel, kleur --chip-amber-fg', () => {
  it('goals_for === goals_against → letter G, tekstkleur var(--chip-amber-fg)', async () => {
    await renderDashboard({
      events: [matchRow({ id: 'd1', goals_for: 2, goals_against: 2 })],
    })
    const group = formGroup()!
    const chip = group.querySelector('span[aria-label]') as HTMLElement
    expect(chip.textContent).toBe(nl.home.formLetterDraw)
    expect(chip).toHaveStyle({ color: 'var(--chip-amber-fg)' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC4 — V bij meer doelpunten tegen, kleur --chip-red-fg
// ═══════════════════════════════════════════════════════════════════════
describe('AC4 — V bij meer doelpunten tegen, kleur --chip-red-fg', () => {
  it('goals_for < goals_against → letter V, tekstkleur var(--chip-red-fg)', async () => {
    await renderDashboard({
      events: [matchRow({ id: 'l1', goals_for: 0, goals_against: 1 })],
    })
    const group = formGroup()!
    const chip = group.querySelector('span[aria-label]') as HTMLElement
    expect(chip.textContent).toBe(nl.home.formLetterLoss)
    expect(chip).toHaveStyle({ color: 'var(--chip-red-fg)' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC5 — volgorde: meest recente wedstrijd links, oplopend terug in de tijd
// ═══════════════════════════════════════════════════════════════════════
describe('AC5 — volgorde: meest recent links, ouder naar rechts', () => {
  it('drie wedstrijden met verschillende uitslagen verschijnen in DOM-volgorde nieuwste-eerst (links naar rechts)', async () => {
    await renderDashboard({
      events: [
        // Bewust NIET in datumvolgorde ingevoerd, om te bewijzen dat de
        // ECHTE query sorteert (niet de invoervolgorde doorgeeft).
        matchRow({ id: 'oudste', date: addDaysFixed(TODAY, -3), goals_for: 0, goals_against: 2 }), // loss
        matchRow({ id: 'nieuwste', date: addDaysFixed(TODAY, -1), goals_for: 4, goals_against: 0 }), // win
        matchRow({ id: 'midden', date: addDaysFixed(TODAY, -2), goals_for: 1, goals_against: 1 }), // draw
      ],
    })
    const group = formGroup()!
    expect(chipLetters(group)).toEqual([
      nl.home.formLetterWin, // nieuwste, -1 dag, meest links
      nl.home.formLetterDraw, // -2 dagen
      nl.home.formLetterLoss, // oudste, -3 dagen, meest rechts
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC6 — i18n: alle 5 talen tonen hun eigen letters (NL W/G/V, EN W/D/L,
// DE/FR/ES conform de nieuwe keys)
// ═══════════════════════════════════════════════════════════════════════
describe('AC6 — i18n: alle 5 talen tonen hun eigen letters', () => {
  // NL is al bewezen via de volledige pagina in AC1/AC5 hierboven (de
  // cookies-mock geeft altijd de standaardlocale 'nl' terug, en getDict() is
  // gewrapt in React's cache() — binnen dit testbestand blijft die daardoor
  // vastzitten op de eerst-aangeroepen locale). Voor de overige 4 talen
  // renderen we daarom de ECHTE, geïmporteerde FormStrip rechtstreeks met de
  // ECHTE matchResult()-uitkomsten en de echte dictionary van die taal — dit
  // bewijst dat de i18n-keys uit messages/{en,de,fr,es}.ts daadwerkelijk in
  // de gerenderde tekens terechtkomen, zonder de i18n-cache-beperking van de
  // volledige pagina te raken.
  const items = [
    { id: 'w', result: matchResult({ goals_for: 3, goals_against: 1 }) },
    { id: 'd', result: matchResult({ goals_for: 1, goals_against: 1 }) },
    { id: 'l', result: matchResult({ goals_for: 0, goals_against: 2 }) },
    { id: 'u', result: matchResult({ goals_for: null, goals_against: null }) },
  ]

  it.each([
    ['en', en, ['W', 'D', 'L', '?']],
    ['de', de, ['S', 'U', 'N', '?']],
    ['fr', fr, ['V', 'N', 'D', '?']],
    ['es', es, ['G', 'E', 'P', '?']],
  ] as const)('locale "%s" toont zijn eigen letters uit messages/%s.ts', (_locale, dict, expectedLetters) => {
    const { container } = render(<FormStrip items={items} t={dict} />)
    const chips = container.querySelectorAll('span[aria-label]')
    expect(Array.from(chips).map((c) => c.textContent)).toEqual(expectedLetters)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC7 — kleuren uitsluitend via theme-tokens, geen hardcoded kleuren
// ═══════════════════════════════════════════════════════════════════════
describe('AC7 — kleuren uitsluitend via theme-tokens', () => {
  it('geen enkele hex-kleur in de vorm-strip; elke chip gebruikt exact één van de vier toegestane tokens', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'w', date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: 0 }),
        matchRow({ id: 'd', date: addDaysFixed(TODAY, -2), goals_for: 1, goals_against: 1 }),
        matchRow({ id: 'l', date: addDaysFixed(TODAY, -3), goals_for: 0, goals_against: 1 }),
        matchRow({ id: 'u', date: addDaysFixed(TODAY, -4), goals_for: null, goals_against: null }),
      ],
    })
    const group = formGroup()!
    expect(group.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    const allowedTokens = ['var(--chip-green-fg)', 'var(--chip-amber-fg)', 'var(--chip-red-fg)', 'var(--faint)']
    const chips = Array.from(group.querySelectorAll('span[aria-label]')) as HTMLElement[]
    expect(chips).toHaveLength(4)
    for (const chip of chips) {
      expect(allowedTokens).toContain(chip.style.color)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC8 — wedstrijd zonder uitslag telt mee als positie met "?", neutrale
// kleur, wordt NIET overgeslagen
// ═══════════════════════════════════════════════════════════════════════
describe('AC8 — wedstrijd zonder uitslag telt mee als "?"-positie', () => {
  it('een afgelopen wedstrijd zonder ingevulde uitslag bezet een positie in het midden, kleur --faint op --track', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 }),
        matchRow({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: null, goals_against: null }),
        matchRow({ id: 'c', date: addDaysFixed(TODAY, -3), goals_for: 0, goals_against: 2 }),
      ],
    })
    const group = formGroup()!
    const chips = Array.from(group.querySelectorAll('span[aria-label]')) as HTMLElement[]
    expect(chips).toHaveLength(3) // de lege wedstrijd is niet overgeslagen
    expect(chips[1].textContent).toBe(nl.home.formLetterUnknown)
    expect(chips[1]).toHaveStyle({ color: 'var(--faint)', background: 'var(--track)' })
    expect(chips[1]).toHaveAttribute('aria-label', nl.home.formUnknown)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC9 — niet ingelogd: bestaande /login-redirect blijft werken, ongewijzigd
// ═══════════════════════════════════════════════════════════════════════
describe('AC9 — niet ingelogd: bestaande /login-redirect blijft werken', () => {
  it('zonder ingelogde gebruiker gooit de pagina de bestaande redirect naar /login, vóórdat er iets van de vorm-query draait', async () => {
    await expect(renderDashboard({ user: null })).rejects.toThrow('__redirect__:/login')
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC10 — tenant-isolatie: uitsluitend wedstrijden van het eigen team_id
// ═══════════════════════════════════════════════════════════════════════
describe('AC10 — tenant-isolatie: uitsluitend wedstrijden van het eigen team_id', () => {
  it('wedstrijden van een ander team_id komen nooit in de vorm-strip van het eigen team terecht', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'eigen', team_id: TEAM, date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: 0 }),
        matchRow({ id: 'ander-1', team_id: OTHER_TEAM, date: addDaysFixed(TODAY, -1), goals_for: 9, goals_against: 0 }),
        matchRow({ id: 'ander-2', team_id: OTHER_TEAM, date: addDaysFixed(TODAY, -2), goals_for: 0, goals_against: 9 }),
      ],
    })
    const group = formGroup()!
    const chips = Array.from(group.querySelectorAll('span[aria-label]')) as HTMLElement[]
    // Als de tenant-scoping zou ontbreken, zouden hier 3 tekens staan
    // (inclusief de wedstrijden van team-2). Precies 1 teken, met de
    // uitslag van het EIGEN team, bewijst de scoping.
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toBe(nl.home.formLetterWin)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC11 — cutoff: strikt datum < vandaag; een wedstrijd van vandaag telt pas
// morgen mee, ongeacht ingevulde uitslag
// ═══════════════════════════════════════════════════════════════════════
describe('AC11 — cutoff: strikt vóór vandaag', () => {
  it('een wedstrijd van VANDAAG met ingevulde uitslag telt niet mee; gisteren wel', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'vandaag', date: TODAY, goals_for: 9, goals_against: 0 }), // zou 'W' zijn, moet ontbreken
        matchRow({ id: 'gisteren', date: addDaysFixed(TODAY, -1), goals_for: 0, goals_against: 1 }), // 'V'
      ],
    })
    const group = formGroup()!
    const chips = Array.from(group.querySelectorAll('span[aria-label]')) as HTMLElement[]
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toBe(nl.home.formLetterLoss)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC12 — wedstrijd zonder uitslag telt mee als positie, geen skip/verder-
// terugzoeken naar een oudere wedstrijd MET uitslag
// ═══════════════════════════════════════════════════════════════════════
describe('AC12 — geen skip/verder-terugzoeken bij ontbrekende uitslag', () => {
  it('de 5e (oudste) positie zonder uitslag blijft "?" — een 6e, oudere wedstrijd MET uitslag wordt niet ter vervanging opgehaald', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'm1', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 }),
        matchRow({ id: 'm2', date: addDaysFixed(TODAY, -2), goals_for: 1, goals_against: 0 }),
        matchRow({ id: 'm3', date: addDaysFixed(TODAY, -3), goals_for: 1, goals_against: 0 }),
        matchRow({ id: 'm4', date: addDaysFixed(TODAY, -4), goals_for: 1, goals_against: 0 }),
        matchRow({ id: 'm5-leeg', date: addDaysFixed(TODAY, -5), goals_for: null, goals_against: null }),
        // Ouder dan de 5 die getoond worden, mét uitslag — mag NOOIT verschijnen,
        // ook niet ter vervanging van de lege m5.
        matchRow({ id: 'm6-ouder', date: addDaysFixed(TODAY, -6), goals_for: 5, goals_against: 0 }),
      ],
    })
    const group = formGroup()!
    const chips = Array.from(group.querySelectorAll('span[aria-label]')) as HTMLElement[]
    expect(chips).toHaveLength(5)
    expect(chips.map((c) => c.textContent)).toEqual([
      nl.home.formLetterWin,
      nl.home.formLetterWin,
      nl.home.formLetterWin,
      nl.home.formLetterWin,
      nl.home.formLetterUnknown, // positie bezet door de lege wedstrijd, niet overgeslagen
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC13 — alle wedstrijden tellen mee, inclusief oefenwedstrijden
// (match_type='friendly')
// ═══════════════════════════════════════════════════════════════════════
describe('AC13 — alle match_types tellen mee, inclusief friendly', () => {
  it('league, friendly, cup en een match zonder match_type tellen allemaal mee', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'league', date: addDaysFixed(TODAY, -1), match_type: 'league', goals_for: 1, goals_against: 0 }),
        matchRow({ id: 'friendly', date: addDaysFixed(TODAY, -2), match_type: 'friendly', goals_for: 0, goals_against: 1 }),
        matchRow({ id: 'cup', date: addDaysFixed(TODAY, -3), match_type: 'cup', goals_for: 2, goals_against: 2 }),
        matchRow({ id: 'geen-type', date: addDaysFixed(TODAY, -4), match_type: null, goals_for: 3, goals_against: 1 }),
      ],
    })
    const group = formGroup()!
    const chips = Array.from(group.querySelectorAll('span[aria-label]')) as HTMLElement[]
    expect(chips.map((c) => c.textContent)).toEqual([
      nl.home.formLetterWin,
      nl.home.formLetterLoss,
      nl.home.formLetterDraw,
      nl.home.formLetterWin,
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC14 — nooit meer dan 5 tekens; nooit wedstrijden van vandaag of later
// ═══════════════════════════════════════════════════════════════════════
describe('AC14 — nooit meer dan 5 tekens, nooit vandaag/later', () => {
  it('8 afgelopen wedstrijden + 1 toekomstige → precies de 5 meest recente AFGELOPEN wedstrijden', async () => {
    const past: Row[] = []
    for (let i = 1; i <= 8; i++) {
      past.push(
        matchRow({
          id: `past-${i}`,
          date: addDaysFixed(TODAY, -i),
          // Zo geconstrueerd dat elke wedstrijd een eigen, herkenbare uitslag heeft.
          goals_for: i <= 5 ? 1 : 0,
          goals_against: i <= 5 ? 0 : 1,
        }),
      )
    }
    const future = matchRow({ id: 'toekomst', date: addDaysFixed(TODAY, 3), goals_for: 9, goals_against: 0 })
    await renderDashboard({ events: [...past, future] })

    const group = formGroup()!
    const chips = Array.from(group.querySelectorAll('span[aria-label]')) as HTMLElement[]
    expect(chips).toHaveLength(5) // nooit meer dan 5
    // De 5 meest recente afgelopen (past-1..past-5), allemaal 'W' — de
    // toekomstige wedstrijd ('toekomst', ook een 'W'-score) verschijnt nooit.
    expect(chips.every((c) => c.textContent === nl.home.formLetterWin)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC15 — minder dan 5 afgelopen wedstrijden → toon alleen beschikbare tekens
// ═══════════════════════════════════════════════════════════════════════
describe('AC15 — minder dan 5 afgelopen wedstrijden: alleen wat er is', () => {
  it('3 afgelopen wedstrijden → precies 3 tekens, geen opvulling tot 5', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 }),
        matchRow({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: 0, goals_against: 1 }),
        matchRow({ id: 'c', date: addDaysFixed(TODAY, -3), goals_for: 1, goals_against: 1 }),
      ],
    })
    const group = formGroup()!
    expect(group.querySelectorAll('span[aria-label]')).toHaveLength(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC16 — 0 afgelopen wedstrijden → geen vorm-strip, wél een hint-tekst in de
// "Vorm"-tegel (FormStrip retourneert nog steeds null bij 0 items; dat
// contract blijft ongewijzigd — de tegel zelf toont in dat geval de hint
// t.home.formEmpty in plaats van de strip, zie app/page.tsx:321-325)
// ═══════════════════════════════════════════════════════════════════════
describe('AC16 — 0 afgelopen wedstrijden: geen strip, wel hint-tekst', () => {
  it('geen enkele afgelopen wedstrijd → de vorm-strip (role="group") bestaat niet, maar de hint-tekst en het "Vorm"-label staan wel in de tegel', async () => {
    await renderDashboard({ events: [] })
    expect(formGroup()).toBeNull()
    // Extra: ook geen losse chip-achtige elementen in de tegel zelf.
    expect(within(vormCard()).queryByRole('group')).toBeNull()
    // Wel de hint-tekst zichtbaar in de tegel (lege staat, geen stille tegel).
    expect(within(vormCard()).getByText(nl.home.formEmpty)).toBeInTheDocument()
    // Het "Vorm"-label blijft zichtbaar (vormCard() vindt de tegel er al op,
    // maar we bevestigen het hier expliciet als onderdeel van dit AC).
    expect(within(vormCard()).getByText(nl.home.statForm)).toBeInTheDocument()
  })

  it('wel events, maar geen enkele afgelopen wedstrijd (training + toekomstige match) → nog steeds geen strip, wel hint-tekst', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'training', type: 'training', date: addDaysFixed(TODAY, -1) }),
        matchRow({ id: 'toekomst', date: addDaysFixed(TODAY, 2), goals_for: 1, goals_against: 0 }),
      ],
    })
    expect(formGroup()).toBeNull()
    expect(within(vormCard()).getByText(nl.home.formEmpty)).toBeInTheDocument()
    expect(within(vormCard()).getByText(nl.home.statForm)).toBeInTheDocument()
  })

  // Bevinding 3 (opschoonronde): de vorm-query zelf faalt op DB-niveau
  // ({ data: null, error }) — app/page.tsx vangt dit af met `?? []`
  // (regel 76-77) zodat de strip stilletjes verdwijnt, net als bij 0
  // afgelopen wedstrijden. Dit test bewijst dat faalpad van buitenaf: de
  // pagina rendert zonder te crashen (geen ongevangen rejection/throw),
  // toont nergens de rauwe DB-foutmelding, en valt netjes terug op dezelfde
  // hint-tekst als de andere lege-staat-gevallen in dit AC.
  it('vorm-query geeft { data: null, error } terug (DB-fout) → pagina crasht niet, geen rauwe DB-foutmelding, geen strip maar wel de hint-tekst (zelfde eindresultaat als AC16)', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: 0 }),
        matchRow({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: 1, goals_against: 1 }),
      ],
      vormQueryReturnsError: true,
    })
    // Geen strip — zelfde eindresultaat als 0 afgelopen wedstrijden (AC16).
    expect(formGroup()).toBeNull()
    // Geen rauwe DB-foutmelding zichtbaar op de pagina.
    expect(document.body.textContent).not.toMatch(/db error \(simulated\)/i)
    // Wel de hint-tekst en het label, net als bij de andere lege-staat-cases.
    expect(within(vormCard()).getByText(nl.home.formEmpty)).toBeInTheDocument()
    expect(within(vormCard()).getByText(nl.home.statForm)).toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// AC17 — tie-break bij gelijke datum: created_at desc, dan id desc
// ═══════════════════════════════════════════════════════════════════════
describe('AC17 — tie-break bij gelijke datum: created_at desc, dan id desc', () => {
  it('twee wedstrijden op dezelfde datum → de later aangemaakte (created_at) staat links', async () => {
    const d = addDaysFixed(TODAY, -1)
    await renderDashboard({
      events: [
        matchRow({ id: 'eerst-ingevoerd', date: d, created_at: '2026-08-01T09:00:00Z', goals_for: 0, goals_against: 1 }), // V
        matchRow({ id: 'later-ingevoerd', date: d, created_at: '2026-08-01T17:00:00Z', goals_for: 3, goals_against: 0 }), // W
      ],
    })
    const group = formGroup()!
    expect(chipLetters(group)).toEqual([nl.home.formLetterWin, nl.home.formLetterLoss])
  })

  it('zelfde datum én zelfde created_at → deterministisch op id desc (realistische UUID-ids, zoals events.id in supabase/schema.sql)', async () => {
    const d = addDaysFixed(TODAY, -1)
    const ts = '2026-08-01T12:00:00Z'
    // Geldige UUID-achtige test-ids i.p.v. 'aaa'/'bbb'/'ccc' — bewijst id-desc-
    // ordening net zo ondubbelzinnig (lexicografisch: '...333' > '...222' > '...111'),
    // maar ligt dichter bij een echte productiesituatie (events.id is een UUID).
    const idLow = '11111111-1111-1111-1111-111111111111'
    const idMid = '22222222-2222-2222-2222-222222222222'
    const idHigh = '33333333-3333-3333-3333-333333333333'
    await renderDashboard({
      events: [
        matchRow({ id: idLow, date: d, created_at: ts, goals_for: 1, goals_against: 0 }), // W
        matchRow({ id: idHigh, date: d, created_at: ts, goals_for: 0, goals_against: 1 }), // V
        matchRow({ id: idMid, date: d, created_at: ts, goals_for: 1, goals_against: 1 }), // G
      ],
    })
    const group = formGroup()!
    // id desc: idHigh (...333) > idMid (...222) > idLow (...111) → V, G, W
    expect(chipLetters(group)).toEqual([nl.home.formLetterLoss, nl.home.formLetterDraw, nl.home.formLetterWin])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Vorm-tegel — structuur en presentatie (dekking voor de tegel-restyle in
// deze ronde: van "Aankomende events" (label + getal) naar "Vorm" (label +
// vorm-strip als hoofdelement, of hint-tekst bij lege staat) — zie
// app/page.tsx:321-325. Geen van de bovenstaande, genummerde ACs dekte deze
// nieuwe presentatie-eisen expliciet, dus die krijgen hier eigen tests.
// ═══════════════════════════════════════════════════════════════════════
describe('Vorm-tegel toont het label "Vorm"', () => {
  it('de tegel toont t.home.statForm ("Vorm") als label', async () => {
    await renderDashboard({
      events: [matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 })],
    })
    expect(within(vormCard()).getByText(nl.home.statForm)).toBeInTheDocument()
  })
})

describe('Vorm-strip staat in de hoofdelement-slot (value), niet in een onderschrift', () => {
  it('de FormStrip-container (role="group") is genest binnen de value-wrapper van StatCard (className bevat text-[32px]) — dit bewijst dat de strip het hoofdelement is, niet een bijschrift', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: 0 }),
        matchRow({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: 1, goals_against: 1 }),
      ],
    })
    const group = formGroup()!
    // StatCard.tsx:26 rendert de `value`-prop in een div met className
    // "font-display text-[32px] font-bold text-ink leading-none" — dat is
    // het hoofdelement-slot van de tegel (waar voorheen het grote getal
    // stond). Een voorouder met die exacte class vinden bewijst dat de
    // vorm-strip daadwerkelijk het hoofdelement is geworden, en niet ergens
    // anders in de tegel (bv. als children/onderschrift) is geplakt. We
    // lopen handmatig de ouderketen af (in plaats van closest() met een CSS-
    // selector) om escaping-problemen met de vierkante haken in de
    // Tailwind-arbitrary-value-class te vermijden.
    let ancestor: HTMLElement | null = group.parentElement
    let found = false
    while (ancestor) {
      if (ancestor.classList.contains('text-[32px]')) {
        found = true
        break
      }
      ancestor = ancestor.parentElement
    }
    expect(found).toBe(true)
  })
})

describe('Vorm-tegel gebruikt een inline-SVG-icoon (niet het "insights"-iconfont-ligatuur)', () => {
  it('binnen de tegel staat een <svg>, en geen element met class "ms" en tekstinhoud "insights" (die glyph zit niet in de subset — zie ChartBarIcon.tsx)', async () => {
    await renderDashboard({
      events: [matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 })],
    })
    expect(vormCard().querySelector('svg')).not.toBeNull()
    const brokenGlyph = Array.from(vormCard().querySelectorAll('.ms')).find((el) => el.textContent === 'insights')
    expect(brokenGlyph).toBeUndefined()
  })
})

describe('Vorm-tegel toont geen cijfer meer (het getal is vervangen door de strip)', () => {
  it('happy-path met wedstrijden → de tegel-inhoud bevat geen enkel cijfer (alleen "Vorm" en W/G/V-letters; het icoon is een SVG, geen tekst)', async () => {
    await renderDashboard({
      events: [
        matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 2, goals_against: 0 }),
        matchRow({ id: 'b', date: addDaysFixed(TODAY, -2), goals_for: 1, goals_against: 1 }),
        matchRow({ id: 'c', date: addDaysFixed(TODAY, -3), goals_for: 0, goals_against: 3 }),
      ],
    })
    expect(vormCard().textContent).not.toMatch(/\d/)
  })
})

describe('"Aankomende events" komt nergens meer voor op de pagina', () => {
  it('het oude tegel-label is volledig verdwenen, ook elders op de pagina', async () => {
    await renderDashboard({
      events: [matchRow({ id: 'a', date: addDaysFixed(TODAY, -1), goals_for: 1, goals_against: 0 })],
    })
    expect(screen.queryByText('Aankomende events')).toBeNull()
  })
})

describe('i18n-dekking — statForm en formEmpty in alle 5 dictionaries', () => {
  const dicts = [
    ['nl', nl],
    ['en', en],
    ['de', de],
    ['fr', fr],
    ['es', es],
  ] as const

  it('statForm bestaat en is niet leeg, in alle 5 talen', () => {
    for (const [locale, dict] of dicts) {
      expect(dict.home.statForm, `statForm ontbreekt of is leeg voor locale "${locale}"`).toBeTruthy()
      expect(dict.home.statForm.trim().length).toBeGreaterThan(0)
    }
  })

  it('formEmpty bestaat en is niet leeg, in alle 5 talen', () => {
    for (const [locale, dict] of dicts) {
      expect(dict.home.formEmpty, `formEmpty ontbreekt of is leeg voor locale "${locale}"`).toBeTruthy()
      expect(dict.home.formEmpty.trim().length).toBeGreaterThan(0)
    }
  })

  it('statForm verschilt zinvol per taal (niet alle 5 identiek; EN en DE mogen toevallig allebei "Form" zijn)', () => {
    const values = dicts.map(([, dict]) => dict.home.statForm)
    expect(new Set(values).size).toBeGreaterThan(1)
    expect(nl.home.statForm).toBe('Vorm')
    expect(en.home.statForm).toBe('Form')
    expect(de.home.statForm).toBe('Form')
    expect(fr.home.statForm).toBe('Forme')
    expect(es.home.statForm).toBe('Forma')
  })

  it('formEmpty verschilt zinvol per taal (alle 5 talen hebben een eigen volledige zin)', () => {
    const values = dicts.map(([, dict]) => dict.home.formEmpty)
    expect(new Set(values).size).toBe(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Setup-kaart: periodisering staat uit zolang er geen nulmeting is
//
// De trainingsplanner en de periodiseringspagina waarschuwen hier al voor,
// maar dat zijn plekken die je pas bereikt als je al aan het plannen bent.
// Het dashboard is de enige plek waar je hoe dan ook langskomt.
// ═══════════════════════════════════════════════════════════════════════
describe('setup-kaart nulmeting', () => {
  it('zonder nulmeting staat de kaart op het dashboard, met een link naar /periodisering', async () => {
    await renderDashboard({ metingen: [] })
    expect(screen.getByText(nl.home.setupNulmetingTitle)).toBeInTheDocument()
    const cta = screen.getByText(nl.home.setupNulmetingCta)
    expect(cta.closest('a')).toHaveAttribute('href', '/periodisering')
  })

  it('zodra er één nulmeting is, verdwijnt de kaart — zonder wegklik-status', async () => {
    await renderDashboard({ metingen: [{ team_id: TEAM, event_id: 'm1' }] })
    expect(screen.queryByText(nl.home.setupNulmetingTitle)).toBeNull()
  })

  it('de kaart telt alleen nulmetingen van het eigen team', async () => {
    // Een meting van een ander team mag de kaart niet wegdrukken; de query is
    // op team_id gescoped, deze test bewijst dat de scoping ook echt werkt.
    await renderDashboard({ metingen: [{ team_id: 'ander-team', event_id: 'm9' }] })
    expect(screen.getByText(nl.home.setupNulmetingTitle)).toBeInTheDocument()
  })
})

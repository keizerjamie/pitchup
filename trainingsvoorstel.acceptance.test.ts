// Acceptatietests — F2 "Trainingsvoorstel in één tik + plannen bovenaan op mobiel"
// — server-actions / publieke API.
//
// Dit bestand draait de ECHTE, geëxporteerde server actions stelTrainingVoor,
// wisselOefening (en voor "bewerkbaar met bestaande acties" updateKoppeling) uit
// app/actions/training-plan.ts tegen een tabel-engine die .eq/.in/.gt/.lt/...
// ÉCHT toepast (trainingsvoorstel.tabel-engine.ts). Geheugen.md: de stub-smaak
// in app/actions/*.test.ts negeert filters en bewijst dus niets over tenant of
// bibliotheek-isolatie; daarom hier de filterende engine.
//
// Criteria-nummers (C1..C23) verwijzen naar f2-02-story.md. De UI-kant (C1, C9,
// C10, C13, C15, C16, C20-C22 en de Wissel-flow) staat in
// trainingsvoorstel.acceptance.test.tsx.
//
// Besluit V-A (brief): het voorstel slaat GEEN stap_override op. Criterium 4
// ("stap als stap-override") wordt daarom gelezen als "de stap blijft zichtbaar
// via de periodisering, niet vastgezet": stap_override = null, duur_min wel
// afgeleid uit de actuele stap.
//
// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { stelTrainingVoor, wisselOefening, updateKoppeling } from '@/app/actions/training-plan'
import { berekenDuurUitStap } from '@/lib/periodization-stappen'
import { CYCLUS_CORRECTIE_KEY } from '@/lib/periodization'
import { STANDAARD_SESSIEDUUR_MIN } from '@/lib/sessie-tijdlijn'
import { addDays } from '@/lib/utils'
import { makeEngine, resetIdTeller, type Row, type Fail } from './trainingsvoorstel.tabel-engine'

// ────────────────────────────────────────────────
// Wereld
// ────────────────────────────────────────────────
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const TEAM_A = uid(1) // hoofdtrainer A: user.id === team.id (fase 1)
const TEAM_B = uid(2) // ander team / andere gebruiker
const ASSISTENT = uid(3) // assistent in team A, eigen bibliotheek (oefeningen.team_id = user)
const EVENT_A = uid(10) // training van team A
const EVENT_B = uid(11) // training van team B
const EVENT_MATCH = uid(12) // wedstrijd van team A
const EVENT_DATUM = '2026-11-16'

function owner(id: string): Row {
  return { team_id: id, user_id: id, rol: 'owner' }
}
function assistent(over: Partial<Row> = {}): Row {
  return {
    team_id: TEAM_A,
    user_id: ASSISTENT,
    rol: 'assistent',
    mag_training_bewerken: true,
    ...over,
  }
}

let oefTeller = 100
function oef(eigenaar: string, naam: string, categorie: string, over: Row = {}): Row {
  return {
    id: uid(oefTeller++),
    team_id: eigenaar,
    naam,
    beschrijving: null,
    categorie,
    duur_min: 15,
    breedte_m: null,
    lengte_m: null,
    orientatie: 'vrij',
    veldzone: null,
    teams: [],
    aantal_neutralen: 0,
    diagram: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const METING_CATS = [
  'partijen_groot',
  'partijen_midden',
  'partijen_klein',
  'sprints_weinig_rust',
  'sprints_veel_rust',
] as const

// Nulmetingen waarbij EVENT_DATUM in cyclusweek `week` valt (anker = datum -
// (week-1) weken) en elke categorie `stap` als actuele stap heeft.
function metingen(week: number, stappen: Partial<Record<(typeof METING_CATS)[number], number>> = {}, datum = EVENT_DATUM): Row[] {
  // Week 1 vraagt een meting VÓÓR de trainingsdag (peildatum is exclusief).
  const anker = addDays(datum, week === 1 ? -1 : -(week - 1) * 7)
  return METING_CATS.map((categorie, i) => ({
    id: `m-${i}`,
    team_id: TEAM_A,
    categorie,
    datum: anker,
    stap: stappen[categorie] ?? 1,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
  }))
}

function trainingEvent(id: string, team: string, over: Row = {}): Row {
  return { id, team_id: team, type: 'training', date: EVENT_DATUM, trainingstype: 'vct', ...over }
}

function koppelingRij(id: string, event: string, oefeningId: string, over: Row = {}): Row {
  return {
    id,
    team_id: TEAM_A,
    event_id: event,
    oefening_id: oefeningId,
    volgorde: 0,
    stap_override: null,
    duur_min: null,
    genest_in: null,
    parallel_groep_id: null,
    parallel_spelers: [],
    spelerindeling: [['x']],
    aantallen_override: { 0: 3 },
    created_at: '2026-02-02T00:00:00Z',
    ...over,
  }
}

type WereldOpts = {
  user?: string
  members?: Row[]
  tables?: Record<string, Row[]>
  fail?: Fail[]
}

// Standaardwereld: hoofdtrainer A ingelogd; team B ernaast; week 2 (groot +
// steigerungs aan de beurt); lege koppelingen; bibliotheek apart meegeven.
function wereld(o: WereldOpts = {}) {
  const tables: Record<string, Row[]> = {
    events: [trainingEvent(EVENT_A, TEAM_A), trainingEvent(EVENT_B, TEAM_B), trainingEvent(EVENT_MATCH, TEAM_A, { type: 'match' })],
    categorie_metingen: metingen(2),
    attendance: [],
    training_oefeningen: [],
    oefeningen: [],
    ...(o.tables ?? {}),
  }
  const m = makeEngine({
    user: { id: o.user ?? TEAM_A },
    members: o.members ?? [owner(TEAM_A), owner(TEAM_B)],
    tables,
    fail: o.fail,
  })
  vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
  return m
}

type Engine = ReturnType<typeof wereld>
const inserts = (m: Engine) => m.calls.filter((c) => c.table === 'training_oefeningen' && c.op === 'insert')
const updates = (m: Engine) => m.calls.filter((c) => c.table === 'training_oefeningen' && c.op === 'update')
const koppelingen = (m: Engine, event = EVENT_A) => (m.store.training_oefeningen ?? []).filter((r) => r.event_id === event)
const categorieVan = (m: Engine, oefeningId: unknown) => m.store.oefeningen.find((o) => o.id === oefeningId)?.categorie

let consoleSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  resetIdTeller()
  oefTeller = 100
  // genericError logt serverzijdig; dat mag de testoutput niet vervuilen.
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleSpy.mockRestore())

// ════════════════════════════════════════════════
// C2 / C3 / C6 — happy path: voorstel uit eigen bibliotheek, cyclusweek-categorieën
// ════════════════════════════════════════════════
describe('C2/C3/C6 — stelTrainingVoor vult het lege plan met blokken uit de cyclusweek', () => {
  it('C2+C3: week 2 -> precies één blok partijen_groot en één steigerungs uit de EIGEN bibliotheek, in één insert; niet-aan-de-beurt-categorieën ontbreken', async () => {
    const groot = oef(TEAM_A, 'Groot A', 'partijen_groot')
    const steig = oef(TEAM_A, 'Steigerung A', 'steigerungs')
    const midden = oef(TEAM_A, 'Midden A', 'partijen_midden')
    const warm = oef(TEAM_A, 'Warming A', 'warming_up')
    const m = wereld({ tables: { oefeningen: [midden, warm, steig, groot] } })

    const res = await stelTrainingVoor(EVENT_A)

    expect(res).toEqual({ ok: true, aantal: 2, overgeslagen: [] })
    expect(inserts(m)).toHaveLength(1) // één bulk-insert
    const rijen = inserts(m)[0].payload as Row[]
    expect(Array.isArray(rijen)).toBe(true)
    expect(rijen.map((r) => r.oefening_id).sort()).toEqual([groot.id, steig.id].sort())
    expect(rijen.map((r) => categorieVan(m, r.oefening_id)).sort()).toEqual(['partijen_groot', 'steigerungs'])
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_A}/training-plan`)
  })

  it.each([
    [1, ['partijen_groot', 'steigerungs']],
    [2, ['partijen_groot', 'steigerungs']],
    [3, ['partijen_midden', 'sprints_weinig_rust']],
    [4, ['partijen_midden', 'sprints_weinig_rust']],
    [5, ['partijen_klein', 'sprints_veel_rust']],
    [6, ['partijen_klein', 'sprints_veel_rust']],
  ])('C3: cyclusweek %i -> categorieën %j (zelfde bepaling als de suggestiekaart)', async (week, verwacht) => {
    const bib = [
      'partijen_groot', 'steigerungs', 'partijen_midden', 'sprints_weinig_rust',
      'partijen_klein', 'sprints_veel_rust', 'warming_up', 'overig',
    ].map((c) => oef(TEAM_A, `Oef ${c}`, c))
    const m = wereld({ tables: { oefeningen: bib, categorie_metingen: metingen(week) } })

    const res = await stelTrainingVoor(EVENT_A)

    expect(res.ok).toBe(true)
    const cats = (inserts(m)[0].payload as Row[]).map((r) => categorieVan(m, r.oefening_id)).sort()
    expect(cats).toEqual([...verwacht].sort())
  })

  it('C6: rijen zijn meteen opgeslagen voor DIT team/event met volgorde 0..n-1 en zijn bewerkbaar met de bestaande actie updateKoppeling', async () => {
    const m = wereld({
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot'), oef(TEAM_A, 'Steigerung A', 'steigerungs')] },
    })
    await stelTrainingVoor(EVENT_A)

    const opgeslagen = koppelingen(m)
    expect(opgeslagen).toHaveLength(2)
    expect(opgeslagen.every((r) => r.team_id === TEAM_A && r.event_id === EVENT_A)).toBe(true)
    expect(opgeslagen.map((r) => r.volgorde).sort()).toEqual([0, 1])

    // Bestaande actie op een voorstelblok: duur aanpassen.
    await updateKoppeling(String(opgeslagen[0].id), EVENT_A, { duur_min: 7 })
    expect(koppelingen(m).find((r) => r.id === opgeslagen[0].id)?.duur_min).toBe(7)
  })
})

// ════════════════════════════════════════════════
// C4 / C5 — stap en duur, budget
// ════════════════════════════════════════════════
describe('C4/C5 — stap (via periodisering) en duur, binnen het 90-minutenbudget', () => {
  it('C4 (lezing V-A): stap_override is null (blok volgt periodisering); duur_min volgt de actuele stap (partijen_groot stap 4 = 28 min), steigerungs (geen meting) krijgt eigen duur_min', async () => {
    const m = wereld({
      tables: {
        oefeningen: [
          oef(TEAM_A, 'Groot A', 'partijen_groot', { duur_min: 40 }),
          oef(TEAM_A, 'Steigerung A', 'steigerungs', { duur_min: 12 }),
        ],
        categorie_metingen: metingen(2, { partijen_groot: 4 }),
      },
    })
    await stelTrainingVoor(EVENT_A)

    const rijen = koppelingen(m)
    const groot = rijen.find((r) => categorieVan(m, r.oefening_id) === 'partijen_groot')!
    const steig = rijen.find((r) => categorieVan(m, r.oefening_id) === 'steigerungs')!
    expect(groot.stap_override).toBeNull()
    expect(steig.stap_override).toBeNull() // categorie zonder meting: geen stap, wel in voorstel
    expect(groot.duur_min).toBe(28) // 2 x 13 min + 1 x 2 min rust, NIET de eigen 40 min
    expect(groot.duur_min).toBe(berekenDuurUitStap('partijen_groot', 4))
    expect(steig.duur_min).toBe(12)
  })

  it(`C5: de totale blokduur is nooit meer dan ${STANDAARD_SESSIEDUUR_MIN} minuten; past een categorie niet meer, dan wordt hij overgeslagen en gemeld`, async () => {
    // partijen_groot stap 21 = 15 min x 6 herhalingen + rust > 90 min: past nooit.
    expect(berekenDuurUitStap('partijen_groot', 21)!).toBeGreaterThan(STANDAARD_SESSIEDUUR_MIN)
    const m = wereld({
      tables: {
        oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot'), oef(TEAM_A, 'Steigerung A', 'steigerungs', { duur_min: 20 })],
        categorie_metingen: metingen(2, { partijen_groot: 21 }),
      },
    })
    const res = await stelTrainingVoor(EVENT_A)

    expect(res).toEqual({ ok: true, aantal: 1, overgeslagen: ['partijen_groot'] })
    const som = koppelingen(m).reduce((s, r) => s + Number(r.duur_min ?? 0), 0)
    expect(som).toBeLessThanOrEqual(STANDAARD_SESSIEDUUR_MIN)
  })

  it('C5: een oefening zonder duur_min wordt niet uitgesloten (duur_min null, telt 0 mee)', async () => {
    const m = wereld({
      tables: {
        oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot', { duur_min: null }), oef(TEAM_A, 'Steigerung A', 'steigerungs', { duur_min: null })],
      },
    })
    const res = await stelTrainingVoor(EVENT_A)
    expect(res.ok && res.aantal).toBe(2)
    const steig = koppelingen(m).find((r) => categorieVan(m, r.oefening_id) === 'steigerungs')!
    expect(steig.duur_min).toBeNull()
  })

  it('C5: vol/weinig oefeningen: som van alle opgeslagen duren blijft ≤ 90 bij het standaardweek-voorstel', async () => {
    const m = wereld({
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot', { duur_min: 60 }), oef(TEAM_A, 'Steigerung A', 'steigerungs', { duur_min: 60 })] },
    })
    await stelTrainingVoor(EVENT_A)
    const som = koppelingen(m).reduce((s, r) => s + Number(r.duur_min ?? 0), 0)
    expect(som).toBeLessThanOrEqual(STANDAARD_SESSIEDUUR_MIN)
  })
})

// ════════════════════════════════════════════════
// C8 — voorkeur voor het aantal aanwezigen
// ════════════════════════════════════════════════
describe('C8 — voorkeur voor oefeningen die bij het aantal aanwezigen passen', () => {
  const klein = () => oef(TEAM_A, 'A klein 3v3', 'partijen_groot', { teams: [{ grootte: 3, formaties: [] }, { grootte: 3, formaties: [] }] })
  const groot = () => oef(TEAM_A, 'B groot 6v6', 'partijen_groot', { teams: [{ grootte: 6, formaties: [] }, { grootte: 6, formaties: [] }] })
  const aanwezig = (n: number, status = 'present'): Row[] =>
    Array.from({ length: n }, (_, i) => ({ event_id: EVENT_A, team_id: TEAM_A, player_id: `p${i}`, status }))

  it('12 aanwezigen -> de 6v6 (past) wint van de alfabetisch eerdere 3v3 (past niet)', async () => {
    const k = klein(); const g = groot()
    const m = wereld({ tables: { oefeningen: [k, g], attendance: aanwezig(12) } })
    await stelTrainingVoor(EVENT_A)
    const gekozen = (inserts(m)[0].payload as Row[]).find((r) => categorieVan(m, r.oefening_id) === 'partijen_groot')!
    expect(gekozen.oefening_id).toBe(g.id)
  })

  it('0 aanwezigen -> geen voorkeur: alfabetisch eerste (3v3) wordt gekozen', async () => {
    const k = klein(); const g = groot()
    const m = wereld({ tables: { oefeningen: [g, k], attendance: [] } })
    await stelTrainingVoor(EVENT_A)
    const gekozen = (inserts(m)[0].payload as Row[]).find((r) => categorieVan(m, r.oefening_id) === 'partijen_groot')!
    expect(gekozen.oefening_id).toBe(k.id)
  })

  it('edge: alleen status "present" telt als aanwezig (12 x absent = geen voorkeur)', async () => {
    const k = klein(); const g = groot()
    const m = wereld({ tables: { oefeningen: [k, g], attendance: aanwezig(12, 'absent') } })
    await stelTrainingVoor(EVENT_A)
    const gekozen = (inserts(m)[0].payload as Row[]).find((r) => categorieVan(m, r.oefening_id) === 'partijen_groot')!
    expect(gekozen.oefening_id).toBe(k.id)
  })

  it('tenant: aanwezigheid van een ander event telt niet mee', async () => {
    const k = klein(); const g = groot()
    const vreemd = aanwezig(12).map((a) => ({ ...a, event_id: EVENT_B, team_id: TEAM_B }))
    const m = wereld({ tables: { oefeningen: [k, g], attendance: vreemd } })
    await stelTrainingVoor(EVENT_A)
    const gekozen = (inserts(m)[0].payload as Row[]).find((r) => categorieVan(m, r.oefening_id) === 'partijen_groot')!
    expect(gekozen.oefening_id).toBe(k.id)
  })
})

// ════════════════════════════════════════════════
// C9 — geen nulmeting / geen correctie
// ════════════════════════════════════════════════
describe('C9 — zonder nulmeting en zonder correctie: geen voorstel, geen foutmelding (geen throw)', () => {
  it('geeft { ok:false, error:"geen_cyclusweek" } terug en schrijft niets', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')], categorie_metingen: [] } })
    const res = await stelTrainingVoor(EVENT_A)
    expect(res).toEqual({ ok: false, error: 'geen_cyclusweek' })
    expect(inserts(m)).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════
// C10 — lege bibliotheek (incl. assistent)
// ════════════════════════════════════════════════
describe('C10 — lege bibliotheek', () => {
  it('hoofdtrainer met lege bibliotheek -> lege_bibliotheek, niets geschreven', async () => {
    const m = wereld({ tables: { oefeningen: [] } })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'lege_bibliotheek' })
    expect(inserts(m)).toHaveLength(0)
  })

  it('assistent met lege EIGEN bibliotheek -> lege_bibliotheek, ook al heeft de hoofdtrainer wel oefeningen (A9)', async () => {
    const m = wereld({
      user: ASSISTENT,
      members: [owner(TEAM_A), assistent()],
      tables: { oefeningen: [oef(TEAM_A, 'Groot van de hoofdtrainer', 'partijen_groot')] },
    })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'lege_bibliotheek' })
    expect(inserts(m)).toHaveLength(0)
  })

  it('assistent met eigen bibliotheek -> voorstel uitsluitend uit die eigen oefeningen (team_id van het blok blijft team A)', async () => {
    const eigen = oef(ASSISTENT, 'Eigen groot', 'partijen_groot')
    const chef = oef(TEAM_A, 'AAA groot hoofdtrainer', 'partijen_groot')
    const m = wereld({
      user: ASSISTENT,
      members: [owner(TEAM_A), assistent()],
      tables: { oefeningen: [chef, eigen] },
    })
    const res = await stelTrainingVoor(EVENT_A)
    expect(res.ok).toBe(true)
    const rijen = inserts(m)[0].payload as Row[]
    expect(rijen.map((r) => r.oefening_id)).toEqual([eigen.id])
    expect(rijen.every((r) => r.team_id === TEAM_A)).toBe(true)
  })
})

// ════════════════════════════════════════════════
// C11 — categorie zonder oefening / niets passend
// ════════════════════════════════════════════════
describe('C11 — geen oefening in een te-doen-categorie', () => {
  it('alleen een groot-oefening in week 2 -> alleen dat blok; steigerungs staat in overgeslagen', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] } })
    const res = await stelTrainingVoor(EVENT_A)
    expect(res).toEqual({ ok: true, aantal: 1, overgeslagen: ['steigerungs'] })
    expect(koppelingen(m)).toHaveLength(1)
  })

  it('niets passend (alleen categorieën die niet aan de beurt zijn) -> niets_passend, geen blokken, geen throw', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Midden A', 'partijen_midden'), oef(TEAM_A, 'Overig', 'overig')] } })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'niets_passend' })
    expect(inserts(m)).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════
// C12 — opslag mislukt
// ════════════════════════════════════════════════
describe('C12 — opslag mislukt: generieke melding, plan blijft leeg, alles-of-niets', () => {
  it('insert-fout -> gooit de generieke melding (nooit de ruwe DB-tekst) en er staat niets in het plan', async () => {
    const m = wereld({
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot'), oef(TEAM_A, 'Steigerung A', 'steigerungs')] },
      fail: [{ table: 'training_oefeningen', op: 'insert', message: 'duplicate key geheim-detail' }],
    })
    const fout = await stelTrainingVoor(EVENT_A).then(() => null, (e: unknown) => e as Error)
    expect(fout).toBeInstanceOf(Error)
    expect(fout!.message).toBe(GENERIC_ERROR_MESSAGE)
    expect(fout!.message).not.toContain('geheim-detail')
    expect(koppelingen(m)).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('een mislukte leesquery wordt niet stil als "leeg" behandeld (geen valse geen_cyclusweek/lege_bibliotheek): generieke fout, niets geschreven', async () => {
    const m = wereld({
      tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] },
      fail: [{ table: 'oefeningen', op: 'select', message: 'kapot' }],
    })
    await expect(stelTrainingVoor(EVENT_A)).rejects.toThrow(GENERIC_ERROR_MESSAGE)
    expect(inserts(m)).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════
// C13 — geen bewerkrecht: server weigert
// ════════════════════════════════════════════════
describe('C13 — assistent zonder training-recht: directe serveraanroep geweigerd', () => {
  const zonderRecht = () =>
    wereld({
      user: ASSISTENT,
      members: [owner(TEAM_A), assistent({ mag_training_bewerken: false })],
      tables: {
        oefeningen: [oef(ASSISTENT, 'Eigen groot', 'partijen_groot')],
        training_oefeningen: [koppelingRij(uid(50), EVENT_A, uid(100))],
      },
    })

  it('stelTrainingVoor -> "Geen toegang", niets geschreven', async () => {
    const m = zonderRecht()
    m.store.training_oefeningen.length = 0
    await expect(stelTrainingVoor(EVENT_A)).rejects.toThrow('Geen toegang')
    expect(inserts(m)).toHaveLength(0)
  })

  it('wisselOefening -> "Geen toegang", rij ongewijzigd', async () => {
    const m = zonderRecht()
    const voor = JSON.stringify(m.store.training_oefeningen)
    await expect(wisselOefening(uid(50), EVENT_A, uid(100))).rejects.toThrow('Geen toegang')
    expect(updates(m)).toHaveLength(0)
    expect(JSON.stringify(m.store.training_oefeningen)).toBe(voor)
  })

  it('niet ingelogd -> "Niet ingelogd"', async () => {
    const m = makeEngine({ user: null, members: [], tables: { events: [], oefeningen: [] } })
    vi.mocked(createClient).mockResolvedValue(m.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
    await expect(stelTrainingVoor(EVENT_A)).rejects.toThrow('Niet ingelogd')
  })
})

// ════════════════════════════════════════════════
// C14 / C17 — tenant: ander team, vreemde oefening, client-id's niet vertrouwd
// ════════════════════════════════════════════════
describe('C14/C17 — tenant-isolatie en server kiest zelf', () => {
  it('C14: event van een ander team -> "Event niet gevonden", niets aangemaakt (ook niet in dat andere team)', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] } })
    await expect(stelTrainingVoor(EVENT_B)).rejects.toThrow('Event niet gevonden')
    expect(inserts(m)).toHaveLength(0)
  })

  it('C14: een wedstrijd (geen training) en een onbestaand id -> "Event niet gevonden"', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')] } })
    await expect(stelTrainingVoor(EVENT_MATCH)).rejects.toThrow('Event niet gevonden')
    await expect(stelTrainingVoor(uid(999))).rejects.toThrow('Event niet gevonden')
    expect(inserts(m)).toHaveLength(0)
  })

  it('C14: oefeningen van een andere gebruiker worden nooit gekozen, ook niet als ze alfabetisch voorop staan en perfect passen', async () => {
    const mijn = oef(TEAM_A, 'Zzz mijn groot', 'partijen_groot')
    const mijnS = oef(TEAM_A, 'Zzz mijn steigerung', 'steigerungs')
    const vreemdG = oef(TEAM_B, 'AAA vreemd groot', 'partijen_groot')
    const vreemdS = oef(TEAM_B, 'AAA vreemd steigerung', 'steigerungs')
    const m = wereld({ tables: { oefeningen: [vreemdG, vreemdS, mijn, mijnS] } })
    await stelTrainingVoor(EVENT_A)
    const gekozen = (inserts(m)[0].payload as Row[]).map((r) => r.oefening_id).sort()
    expect(gekozen).toEqual([mijn.id, mijnS.id].sort())
  })

  it('C14: bibliotheek die ALLEEN uit andermans oefeningen bestaat telt als leeg', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_B, 'Vreemd groot', 'partijen_groot')] } })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'lege_bibliotheek' })
    expect(inserts(m)).toHaveLength(0)
  })

  it('C17: de server kiest: extra client-argumenten (vreemde oefening-id, eigen blokken) worden genegeerd', async () => {
    const mijn = oef(TEAM_A, 'Mijn groot', 'partijen_groot')
    const vreemd = oef(TEAM_B, 'Vreemd groot', 'partijen_groot')
    const m = wereld({ tables: { oefeningen: [mijn, vreemd] } })
    const forged = stelTrainingVoor as unknown as (...a: unknown[]) => Promise<unknown>
    await forged(EVENT_A, vreemd.id, [{ oefeningId: vreemd.id }])
    const ids = (inserts(m)[0].payload as Row[]).map((r) => r.oefening_id)
    expect(ids).toEqual([mijn.id])
    expect(ids).not.toContain(vreemd.id)
  })

  it('C14 (wissel): vreemde oefening -> "Oefening niet gevonden", koppeling ongewijzigd', async () => {
    const huidig = oef(TEAM_A, 'Huidig', 'partijen_groot')
    const vreemd = oef(TEAM_B, 'Vreemd', 'partijen_groot')
    const m = wereld({
      tables: { oefeningen: [huidig, vreemd], training_oefeningen: [koppelingRij(uid(50), EVENT_A, String(huidig.id))] },
    })
    await expect(wisselOefening(uid(50), EVENT_A, String(vreemd.id))).rejects.toThrow('Oefening niet gevonden')
    expect(updates(m)).toHaveLength(0)
    expect(koppelingen(m)[0].oefening_id).toBe(huidig.id)
  })

  it('C14 (wissel): koppeling van een ander team/event -> "Koppeling niet gevonden", niets gewijzigd', async () => {
    const huidig = oef(TEAM_A, 'Huidig', 'partijen_groot')
    const nieuw = oef(TEAM_A, 'Nieuw', 'partijen_groot')
    const vreemdeKoppeling = koppelingRij(uid(51), EVENT_B, String(huidig.id), { team_id: TEAM_B })
    const m = wereld({ tables: { oefeningen: [huidig, nieuw], training_oefeningen: [vreemdeKoppeling] } })
    // eigen event + vreemde koppeling
    await expect(wisselOefening(uid(51), EVENT_A, String(nieuw.id))).rejects.toThrow('Koppeling niet gevonden')
    // vreemd event
    await expect(wisselOefening(uid(51), EVENT_B, String(nieuw.id))).rejects.toThrow('Event niet gevonden')
    expect(updates(m)).toHaveLength(0)
    expect(m.store.training_oefeningen[0].oefening_id).toBe(huidig.id)
  })

  it('C14 (wissel): ongeldige id-vorm wordt niet-onthullend afgewezen', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'X', 'partijen_groot')] } })
    await expect(wisselOefening("1; drop table", EVENT_A, uid(100))).rejects.toThrow('Koppeling niet gevonden')
    expect(updates(m)).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════
// C15 — knop alleen bij lege planner (serverkant: geen dubbele blokken)
// ════════════════════════════════════════════════
describe('C15 — alleen bij nul koppelingen; tweede aanroep maakt geen dubbele blokken', () => {
  it('plan al gevuld -> plan_niet_leeg, niets aangevuld', async () => {
    const m = wereld({
      tables: {
        oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')],
        training_oefeningen: [koppelingRij(uid(50), EVENT_A, uid(100))],
      },
    })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'plan_niet_leeg' })
    expect(inserts(m)).toHaveLength(0)
    expect(koppelingen(m)).toHaveLength(1)
  })

  it('dubbeltik (tweede aanroep na de eerste) -> plan_niet_leeg, het plan houdt precies de blokken van de eerste aanroep', async () => {
    const m = wereld({ tables: { oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot'), oef(TEAM_A, 'Steigerung A', 'steigerungs')] } })
    expect((await stelTrainingVoor(EVENT_A)).ok).toBe(true)
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'plan_niet_leeg' })
    expect(koppelingen(m)).toHaveLength(2)
  })

  it('een gevuld plan van een ANDER event van het team blokkeert niet (check is per event)', async () => {
    const m = wereld({
      tables: {
        oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')],
        events: [trainingEvent(EVENT_A, TEAM_A), trainingEvent(uid(13), TEAM_A, { date: '2026-11-09' })],
        training_oefeningen: [koppelingRij(uid(50), uid(13), uid(100))],
      },
    })
    expect((await stelTrainingVoor(EVENT_A)).ok).toBe(true)
    expect(koppelingen(m)).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════
// C16 — teamtactisch
// ════════════════════════════════════════════════
describe('C16 — bij teamtactisch geen voorstel', () => {
  it('server weigert met teamtactisch en schrijft niets', async () => {
    const m = wereld({
      tables: {
        events: [trainingEvent(EVENT_A, TEAM_A, { trainingstype: 'teamtactisch' })],
        oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')],
      },
    })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'teamtactisch' })
    expect(inserts(m)).toHaveLength(0)
  })

  it('een event zonder trainingstype (niet-gemigreerde omgeving) gedraagt zich als vct, net als de pagina', async () => {
    const m = wereld({
      tables: {
        events: [trainingEvent(EVENT_A, TEAM_A, { trainingstype: null })],
        oefeningen: [oef(TEAM_A, 'Groot A', 'partijen_groot')],
      },
    })
    expect((await stelTrainingVoor(EVENT_A)).ok).toBe(true)
    expect(inserts(m)).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════
// C18 — deterministisch, past niets aan
// ════════════════════════════════════════════════
describe('C18 — deterministisch bij gelijke invoer; past geen oefening/bibliotheek aan', () => {
  const bibliotheek = () => [
    oef(TEAM_A, 'Beta groot', 'partijen_groot'),
    oef(TEAM_A, 'Alfa groot', 'partijen_groot'),
    oef(TEAM_A, 'Gamma groot', 'partijen_groot'),
    oef(TEAM_A, 'Steig 2', 'steigerungs'),
    oef(TEAM_A, 'Steig 1', 'steigerungs'),
  ]

  it('twee runs op identieke werelden geven identieke blokken (ook als de bibliotheek in andere volgorde binnenkomt)', async () => {
    const bib = bibliotheek()
    const m1 = wereld({ tables: { oefeningen: structuredClone(bib) } })
    await stelTrainingVoor(EVENT_A)
    const eerste = (inserts(m1)[0].payload as Row[]).map((r) => [r.oefening_id, r.volgorde, r.duur_min, r.stap_override])

    resetIdTeller()
    const m2 = wereld({ tables: { oefeningen: structuredClone(bib).reverse() } })
    await stelTrainingVoor(EVENT_A)
    const tweede = (inserts(m2)[0].payload as Row[]).map((r) => [r.oefening_id, r.volgorde, r.duur_min, r.stap_override])

    expect(tweede).toEqual(eerste)
  })

  it('de bibliotheek (oefeningen-tabel) is na het voorstel byte-voor-byte ongewijzigd en er zijn geen schrijfacties op oefeningen', async () => {
    const m = wereld({ tables: { oefeningen: bibliotheek() } })
    const voor = JSON.stringify(m.store.oefeningen)
    await stelTrainingVoor(EVENT_A)
    expect(JSON.stringify(m.store.oefeningen)).toBe(voor)
    expect(m.calls.filter((c) => c.table === 'oefeningen' && c.op !== 'select')).toHaveLength(0)
  })

  it('geen dubbele oefening binnen één voorstel', async () => {
    const m = wereld({ tables: { oefeningen: bibliotheek() } })
    await stelTrainingVoor(EVENT_A)
    const ids = (inserts(m)[0].payload as Row[]).map((r) => r.oefening_id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ════════════════════════════════════════════════
// C19 — cyclusweek uit dezelfde bepaling als de pagina
// ════════════════════════════════════════════════
describe('C19 — cyclusweek en stappen uit dezelfde bepaling als de pagina (incl. correctie, DST)', () => {
  const alleCats = () =>
    ['partijen_groot', 'steigerungs', 'partijen_midden', 'sprints_weinig_rust', 'partijen_klein', 'sprints_veel_rust']
      .map((c) => oef(TEAM_A, `Oef ${c}`, c))

  it('een actieve handmatige cyclusweek-correctie (week 3) stuurt het voorstel: midden + sprints_weinig_rust i.p.v. groot + steigerungs', async () => {
    const ankerDatum = addDays(EVENT_DATUM, -7) // afgeleid: week 2
    const m = wereld({
      tables: {
        oefeningen: alleCats(),
        categorie_metingen: metingen(2),
        settings: [{ team_id: TEAM_A, key: CYCLUS_CORRECTIE_KEY, value: `3|${EVENT_DATUM}|${ankerDatum}` }],
      },
    })
    await stelTrainingVoor(EVENT_A)
    const cats = (inserts(m)[0].payload as Row[]).map((r) => categorieVan(m, r.oefening_id)).sort()
    expect(cats).toEqual(['partijen_midden', 'sprints_weinig_rust'])
  })

  it('een correctie van een ánder team beïnvloedt dit team niet (settings zijn team-gescoped)', async () => {
    const ankerDatum = addDays(EVENT_DATUM, -7)
    const m = wereld({
      tables: {
        oefeningen: alleCats(),
        categorie_metingen: metingen(2),
        settings: [{ team_id: TEAM_B, key: CYCLUS_CORRECTIE_KEY, value: `3|${EVENT_DATUM}|${ankerDatum}` }],
      },
    })
    await stelTrainingVoor(EVENT_A)
    const cats = (inserts(m)[0].payload as Row[]).map((r) => categorieVan(m, r.oefening_id)).sort()
    expect(cats).toEqual(['partijen_groot', 'steigerungs'])
  })

  it('metingen van een ander team tellen niet: team A zonder metingen -> geen_cyclusweek, ook als team B wel metingen heeft', async () => {
    const m = wereld({
      tables: {
        oefeningen: alleCats(),
        categorie_metingen: metingen(2).map((r) => ({ ...r, team_id: TEAM_B })),
      },
    })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'geen_cyclusweek' })
    expect(inserts(m)).toHaveLength(0)
  })

  it('een meting op de trainingsdag zelf telt niet mee (peildatum exclusief): week blijft onbekend', async () => {
    const opDag = metingen(2).map((r) => ({ ...r, datum: EVENT_DATUM }))
    wereld({ tables: { oefeningen: alleCats(), categorie_metingen: opDag } })
    expect(await stelTrainingVoor(EVENT_A)).toEqual({ ok: false, error: 'geen_cyclusweek' })
  })

  it('DST: nulmeting 25 mrt, training 1 apr (rond de zomertijd-omschakeling) = precies 7 dagen = week 2 (groot + steigerungs)', async () => {
    const m = wereld({
      tables: {
        oefeningen: alleCats(),
        events: [trainingEvent(EVENT_A, TEAM_A, { date: '2026-04-01' })],
        categorie_metingen: metingen(1, {}, '2026-03-25'),
      },
    })
    await stelTrainingVoor(EVENT_A)
    const cats = (inserts(m)[0].payload as Row[]).map((r) => categorieVan(m, r.oefening_id)).sort()
    expect(cats).toEqual(['partijen_groot', 'steigerungs'])
  })
})

// ════════════════════════════════════════════════
// C7 — Wissel: vervangt dat blok op dezelfde plek, andere blokken ongewijzigd
// ════════════════════════════════════════════════
describe('C7 — wisselOefening vervangt het blok ter plekke (V4)', () => {
  function planMetTweeBlokken() {
    const groot1 = oef(TEAM_A, 'Groot 1', 'partijen_groot', { duur_min: 33 })
    const groot2 = oef(TEAM_A, 'Groot 2', 'partijen_groot', { duur_min: 33 })
    const steig = oef(TEAM_A, 'Steigerung', 'steigerungs', { duur_min: 10 })
    const sprint = oef(TEAM_A, 'Sprint', 'sprints_weinig_rust', { duur_min: 9 })
    const k1 = koppelingRij(uid(60), EVENT_A, String(groot1.id), {
      volgorde: 0, stap_override: 25, duur_min: 99, parallel_groep_id: uid(70), parallel_spelers: ['p1'], genest_in: uid(61),
    })
    const k2 = koppelingRij(uid(61), EVENT_A, String(steig.id), { volgorde: 1, duur_min: 10, spelerindeling: [], aantallen_override: null })
    const m = wereld({ tables: { oefeningen: [groot1, groot2, steig, sprint], training_oefeningen: [k1, k2] } })
    return { m, groot1, groot2, steig, sprint, k1, k2 }
  }

  it('wissel binnen dezelfde categorie: alleen oefening_id/duur/indeling veranderen; plek (volgorde), groepering, created_at en stap_override (geclampt) blijven; het andere blok is byte-gelijk', async () => {
    const { m, groot2, k2 } = planMetTweeBlokken()
    const k2Voor = JSON.stringify(m.store.training_oefeningen.find((r) => r.id === k2.id))

    await wisselOefening(uid(60), EVENT_A, String(groot2.id))

    const rij = m.store.training_oefeningen.find((r) => r.id === uid(60))!
    expect(rij.oefening_id).toBe(groot2.id)
    expect(rij.volgorde).toBe(0)
    expect(rij.parallel_groep_id).toBe(uid(70))
    expect(rij.parallel_spelers).toEqual(['p1'])
    expect(rij.genest_in).toBe(uid(61))
    expect(rij.created_at).toBe('2026-02-02T00:00:00Z')
    expect(rij.stap_override).toBe(21) // 25 geclampt op maxStap partijen_groot
    expect(rij.spelerindeling).toEqual([]) // hoort bij de oude oefening
    expect(rij.aantallen_override).toBeNull()
    expect(rij.duur_min).toBe(berekenDuurUitStap('partijen_groot', 21))
    // geen delete+insert: precies één update, geen insert
    expect(updates(m)).toHaveLength(1)
    expect(inserts(m)).toHaveLength(0)
    expect(JSON.stringify(m.store.training_oefeningen.find((r) => r.id === k2.id))).toBe(k2Voor)
    expect(m.store.training_oefeningen).toHaveLength(2)
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_A}/training-plan`)
  })

  it('wissel naar een andere categorie (bv. via aangepast filter): stap_override wordt null, duur is die van de nieuwe oefening (V-A/V-D)', async () => {
    const { m, sprint } = planMetTweeBlokken()
    await wisselOefening(uid(60), EVENT_A, String(sprint.id))
    const rij = m.store.training_oefeningen.find((r) => r.id === uid(60))!
    expect(rij.oefening_id).toBe(sprint.id)
    expect(rij.stap_override).toBeNull()
    expect(rij.duur_min).toBe(9)
  })

  it('dezelfde oefening kiezen is een no-op: geen update, geen revalidatie, teamindeling blijft staan', async () => {
    const { m, groot1 } = planMetTweeBlokken()
    const voor = JSON.stringify(m.store.training_oefeningen)
    await wisselOefening(uid(60), EVENT_A, String(groot1.id))
    expect(updates(m)).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(JSON.stringify(m.store.training_oefeningen)).toBe(voor)
  })

  it('mislukte update -> generieke melding (geen ruwe DB-tekst), rij ongewijzigd', async () => {
    const groot1 = oef(TEAM_A, 'Groot 1', 'partijen_groot')
    const groot2 = oef(TEAM_A, 'Groot 2', 'partijen_groot')
    const m = wereld({
      tables: { oefeningen: [groot1, groot2], training_oefeningen: [koppelingRij(uid(62), EVENT_A, String(groot1.id))] },
      fail: [{ table: 'training_oefeningen', op: 'update', message: 'geheim-detail' }],
    })
    const fout = await wisselOefening(uid(62), EVENT_A, String(groot2.id)).then(() => null, (e: unknown) => e as Error)
    expect(fout?.message).toBe(GENERIC_ERROR_MESSAGE)
    expect(m.store.training_oefeningen[0].oefening_id).toBe(groot1.id)
  })
})

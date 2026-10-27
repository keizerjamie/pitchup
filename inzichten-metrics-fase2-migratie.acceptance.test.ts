// Structuurtest op supabase/inzichten-metrics-fase2.sql en het bijbehorende
// blok 27 in supabase/team-rls-verificatie.sql.
//
// Vitest praat nooit met Postgres: deze test leest de SQL als TEKST en legt de
// tenant-isolatie- en noemerregels vast (zelfde aanpak als
// inzichten-metrics-migratie.acceptance.test.ts). Het gedrag zelf bewijst
// alleen blok 27 in de SQL Editor.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const SIGNATUREN: [string, string, string][] = [
  ['inzichten_speelkansen', 'p_team_id uuid, p_start date, p_end date', 'uuid, date, date'],
  ['inzichten_rating_vorm_per_speler', 'p_team_id uuid, p_start date, p_end date, p_recent int', 'uuid, date, date, int'],
  ['inzichten_training_opkomst_per_speler', 'p_team_id uuid, p_start date, p_end date', 'uuid, date, date'],
  ['inzichten_blessures_per_maand', 'p_team_id uuid, p_start date, p_end date', 'uuid, date, date'],
]
const RPC_NAMEN = SIGNATUREN.map(([naam]) => naam)

// De echte tabellen die deze RPC's mogen lezen; elke andere from/join moet een
// CTE uit dezelfde functie zijn (of `lateral`).
const TEAM_TABELLEN_FASE2 = new Set(['events', 'players', 'attendance', 'lineups', 'match_squad', 'match_ratings'])
const SQL_KEYWORDS = new Set(['where', 'on', 'left', 'right', 'inner', 'cross', 'join', 'group', 'order', 'as'])

const ruw = readFileSync(path.resolve(__dirname, 'supabase', 'inzichten-metrics-fase2.sql'), 'utf8')
// Alleen de uitvoerbare SQL: commentaar eruit, zodat een toelichting nooit een
// ontbrekende regel kan "dekken".
const sql = ruw.replace(/--[^\n]*/g, '')

const verificatie = readFileSync(path.resolve(__dirname, 'supabase', 'team-rls-verificatie.sql'), 'utf8')

interface Functie {
  naam: string
  kop: string
  body: string
}

function functies(): Functie[] {
  const re = /create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)as \$\$([\s\S]*?)\$\$;/g
  return [...sql.matchAll(re)].map((m) => ({ naam: m[1], kop: m[3], body: m[4] }))
}

function functie(naam: string): Functie {
  const f = functies().find((x) => x.naam === naam)
  if (!f) throw new Error(`functie ${naam} niet gevonden`)
  return f
}

// CTE-namen met hun startpositie (`with naam as (` of `), naam as (`).
function ctes(body: string): { naam: string; index: number }[] {
  return [...body.matchAll(/(?:\bwith|\),)\s*(\w+)\s+as\s*\(/g)].map((m) => ({ naam: m[1], index: m.index! }))
}

// Alle from/join-doelen. `is distinct from` is geen from-clausule.
function bronnen(body: string): { doel: string; alias: string | undefined; index: number }[] {
  const re = /(?<!\bdistinct\s+)\b(?:from|join)\s+(?:public\.)?(\w+)(?:\s+(\w+))?/g
  return [...body.matchAll(re)].map((m) => ({ doel: m[1], alias: m[2], index: m.index! }))
}

// Het stuk SQL waar een filter voor een from/join moet staan: vanaf de
// from/join tot de start van de volgende CTE (of het einde van de functie).
// Zo telt een `p.team_id = p_team_id` uit een ándere CTE niet mee.
function bereik(body: string, index: number): string {
  const volgende = ctes(body).map((c) => c.index).filter((i) => i > index)
  return body.slice(index, volgende.length ? Math.min(...volgende) : body.length)
}

function whereVan(body: string): string {
  const i = body.lastIndexOf('where ')
  return body.slice(i)
}

describe('inzichten-metrics-fase2.sql — RPC-vorm', () => {
  it('definieert precies de vier RPC\'s met de exacte signaturen', () => {
    const gevonden = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)]
      .map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()])
    expect(gevonden).toEqual(SIGNATUREN.map(([naam, args]) => [naam, args]))
  })

  it('elke functie is security invoker, met set search_path = public en is_team_member(p_team_id)', () => {
    expect(functies()).toHaveLength(4)
    for (const f of functies()) {
      expect(f.kop, f.naam).toMatch(/language sql stable security invoker set search_path = public/)
      expect(f.body, f.naam).toMatch(/where is_team_member\(p_team_id\)/)
    }
    expect(sql).not.toMatch(/security definer/i)
  })

  it('elke echte tabel heeft een alias met <alias>.team_id = p_team_id in hetzelfde stuk SQL', () => {
    for (const f of functies()) {
      const echte = bronnen(f.body).filter((b) => TEAM_TABELLEN_FASE2.has(b.doel))
      expect(echte.length, f.naam).toBeGreaterThan(0)
      for (const { doel, alias, index } of echte) {
        expect(alias !== undefined && !SQL_KEYWORDS.has(alias.toLowerCase()), `${f.naam}: ${doel} zonder alias`).toBe(true)
        expect(bereik(f.body, index), `${f.naam}: ${doel} ${alias} zonder ${alias}.team_id = p_team_id`)
          .toMatch(new RegExp(`\\b${alias}\\.team_id\\s*=\\s*p_team_id\\b`))
      }
    }
  })

  it('elk ander from/join-doel is een CTE uit dezelfde functie of lateral — geen onbekende tabel', () => {
    for (const f of functies()) {
      const cteNamen = new Set(ctes(f.body).map((c) => c.naam))
      for (const { doel } of bronnen(f.body)) {
        if (TEAM_TABELLEN_FASE2.has(doel) || doel === 'lateral') continue
        expect(cteNamen.has(doel), `${f.naam}: onbekend from/join-doel ${doel}`).toBe(true)
      }
    }
  })

  it('geen enkele functie bevat een limit (AC-A14: niets wordt stil afgekapt)', () => {
    expect(sql).not.toMatch(/\blimit\b/i)
  })

  it('revoke en grant per signatuur, en een schema-reload', () => {
    for (const [naam, , typen] of SIGNATUREN) {
      const sig = `${naam}\\(${typen}\\)`
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig}\\s+from public, anon;`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${sig}\\s+to authenticated;`))
    }
    expect(sql).toMatch(/notify pgrst, 'reload schema';/)
  })

  it('bevat geen tabel-, kolom- of policywijziging', () => {
    expect(sql).not.toMatch(/create table/i)
    expect(sql).not.toMatch(/alter table/i)
    expect(sql).not.toMatch(/create policy/i)
    expect(sql).not.toMatch(/create index/i)
  })
})

describe('inzichten_speelkansen — noemer, basis en tenant-grens (W2, W3, O2, O6)', () => {
  const body = () => functie('inzichten_speelkansen').body

  it('het player_id uit de JSONB loopt via players met teamfilter, zonder uuid-cast', () => {
    expect(body()).toMatch(/join players p on p\.id::text = pos\.elem ->> 'player_id'/)
    expect(body()).toMatch(/jsonb_typeof\(l\.positions\) = 'array'/)
    expect(body()).not.toMatch(/::\s*uuid\b/)
    const basis = bereik(body(), body().indexOf('from lineups l'))
    expect(basis).toMatch(/\bp\.team_id = p_team_id\b/)
    expect(basis).toMatch(/\bl\.team_id = p_team_id\b/)
  })

  it('alleen wedstrijden, en unknown-rijen tellen niet als voorkomen (O6)', () => {
    expect(body()).toMatch(/e\.type = 'match'/)
    expect(body()).toMatch(/a\.status <> 'unknown'/)
  })

  it('eerste én laatste voorkomen komen uit selectie, opstelling en aanwezigheid samen', () => {
    expect(body()).toMatch(/min\(w\.date\) as eerste, max\(w\.date\) as laatste/)
    expect(body()).toMatch(/from selectie s\s+union select b\.event_id, b\.player_id from basis b\s+union select a\.event_id, a\.player_id from aanwezigheid a/)
  })

  it('noemer = alleen wedstrijden MET selectie binnen het venster', () => {
    const noemer = bereik(body(), body().indexOf('noemer_wedstrijden as ('))
    expect(noemer).toMatch(/w\.date >= p_start/)
    expect(noemer).toMatch(/exists \(select 1 from selectie s where s\.event_id = w\.id\)/)
  })

  it('noemer vanaf het eerste voorkomen; voor een inactieve speler t/m het laatste (O2)', () => {
    expect(body()).toMatch(
      /left join noemer_wedstrijden nw\s+on nw\.date >= f\.eerste\s+and \(p\.active is distinct from false or nw\.date <= f\.laatste\)/,
    )
  })

  it('selectie en basis tellen alleen binnen noemer-wedstrijden', () => {
    expect(body()).toMatch(/count\(nw\.id\) filter \(where exists \(\s*select 1 from selectie s where s\.event_id = nw\.id and s\.player_id = p\.id\)\)/)
    expect(body()).toMatch(/count\(nw\.id\) filter \(where exists \(\s*select 1 from basis b where b\.event_id = nw\.id and b\.player_id = p\.id\)\)/)
  })

  it('filtert BEWUST de rijen niet op active of type (W3); p.active staat alleen in de O2-grens', () => {
    const zonderO2 = body().replace(/\(p\.active is distinct from false or nw\.date <= f\.laatste\)/, '')
    expect(zonderO2).not.toMatch(/p\.active/)
    expect(body()).not.toMatch(/p\.type\s*=\s*'regular'/)
    expect(body()).toMatch(/\(p\.type = 'guest'\)/)
  })
})

describe('de andere drie RPC\'s', () => {
  it('inzichten_rating_vorm_per_speler: actieve vaste spelers, recent via p_recent', () => {
    const body = functie('inzichten_rating_vorm_per_speler').body
    expect(body).toMatch(/p\.active = true/)
    expect(body).toMatch(/p\.type = 'regular'/)
    expect(body).toMatch(/e\.type = 'match'/)
    expect(body).toMatch(/x\.volgnummer <= greatest\(p_recent, 1\)/)
    expect(body).toMatch(/order by e\.date desc, e\.id desc/)
  })

  it('inzichten_training_opkomst_per_speler: alleen trainingen, afwezig = absent + injured, geen active-filter', () => {
    const body = functie('inzichten_training_opkomst_per_speler').body
    expect(body).toMatch(/e\.type = 'training'/)
    expect(body).toMatch(/a\.status in \('absent', 'injured'\)/)
    expect(body).toMatch(/a\.status = 'present'/)
    expect(body).not.toMatch(/p\.active/)
    expect(body).toMatch(/\(p\.type = 'guest'\)/)
  })

  it('inzichten_blessures_per_maand: filters in de ON, niet in de WHERE; verschillende vaste spelers', () => {
    const body = functie('inzichten_blessures_per_maand').body
    expect(body).toMatch(/left join attendance a on a\.event_id = e\.id and a\.team_id = p_team_id and a\.status = 'injured'/)
    expect(body).toMatch(/left join players p on p\.id = a\.player_id and p\.team_id = p_team_id and p\.type = 'regular'/)
    expect(whereVan(body)).not.toMatch(/\b[ap]\./)
    expect(body).toMatch(/count\(distinct p\.id\)/)
    expect(body).toMatch(/e\.type <> 'meting'/)
    expect(body).toMatch(/to_char\(e\.date, 'YYYY-MM'\)/)
  })
})

describe('team-rls-verificatie.sql — blok 27', () => {
  const start = verificatie.indexOf('-- ── Blok 27')
  const rollback = verificatie.search(/^rollback;/m)
  const blok27 = verificatie.slice(start, rollback)

  it('staat vóór de rollback, na blok 26', () => {
    expect(start).toBeGreaterThan(verificatie.indexOf('-- ── Blok 26'))
    expect(start).toBeLessThan(rollback)
  })

  it('roept alle vier RPC\'s met TEAM_B aan en eist 0 rijen', () => {
    for (const naam of RPC_NAMEN) {
      expect(blok27).toContain(`from ${naam}('TEAM_B_UUID'`)
      expect(blok27).toContain(`LEK: ${naam} geeft % rijen van TEAM_B`)
    }
  })

  it('controleert de vreemde speler in de opstelling, de vreemde blessure, O2 en anon', () => {
    expect(blok27).toMatch(/jsonb_build_object\('player_id', v_vreemd::text/)
    expect(blok27).toMatch(/where player_id = v_vreemd/)
    expect(blok27).toMatch(/values \('TEAM_A_UUID', v_m1, v_vreemd, 'injured'\)/)
    expect(blok27).toMatch(/KAPOT \(O2\)/)
    expect(blok27).toMatch(/has_function_privilege\('anon', 'public\.inzichten_rating_vorm_per_speler\(uuid, date, date, int\)'/)
  })
})

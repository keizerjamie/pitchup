// Structuurtest op supabase/inzichten-metrics.sql en het bijbehorende blok 26
// in supabase/team-rls-verificatie.sql.
//
// Vitest praat nooit met Postgres: deze test leest de SQL als TEKST en legt de
// tenant-isolatie-regels vast die anders alleen bij het handmatig draaien van
// het verificatiescript boven water komen (zelfde testsmaak als de
// M6-structuurtest in assistent-fase1-fundament.acceptance.test.ts). Het
// gedrag zelf (RLS, CHECKs, 42501) bewijst alleen blok 26 in de SQL Editor.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { MAX_SEIZOEN_WEDSTRIJDEN } from '@/lib/inzichten'
import { TEGENDOELPUNT_SOORTEN } from '@/lib/match-analysis.mjs'
import { TEAM_TABELLEN } from '@/lib/team-opruimen'

const RPC_NAMEN = [
  'inzichten_wedstrijd_uitslagen',
  'inzichten_speler_momenten',
  'inzichten_doelpunten_per_minuut',
  'inzichten_tegendoelpunten',
]

const ruw = readFileSync(path.resolve(__dirname, 'supabase', 'inzichten-metrics.sql'), 'utf8')
// Alleen de uitvoerbare SQL: commentaar (ook achter een regel) eruit, zodat
// een toelichting nooit een ontbrekende regel kan "dekken".
const sql = ruw.replace(/--[^\n]*/g, '')

const verificatie = readFileSync(path.resolve(__dirname, 'supabase', 'team-rls-verificatie.sql'), 'utf8')

interface Functie {
  naam: string
  kop: string
  body: string
}

function functies(): Functie[] {
  const re = /create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)as \$\$([\s\S]*?)\$\$;/g
  const lijst: Functie[] = []
  for (const m of sql.matchAll(re)) lijst.push({ naam: m[1], kop: m[3], body: m[4] })
  return lijst
}

function functie(naam: string): Functie {
  const f = functies().find((x) => x.naam === naam)
  if (!f) throw new Error(`functie ${naam} niet gevonden`)
  return f
}

const SQL_KEYWORDS = new Set(['where', 'on', 'left', 'right', 'inner', 'join', 'group', 'order', 'limit'])

describe('inzichten-metrics.sql — RPC-vorm', () => {
  it('definieert precies de vier RPC\'s, elk met (p_team_id uuid, p_start date, p_end date)', () => {
    const re = /create or replace function public\.(\w+)\(([^)]*)\)/g
    const gevonden = [...sql.matchAll(re)].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()])
    expect(gevonden).toEqual(RPC_NAMEN.map((n) => [n, 'p_team_id uuid, p_start date, p_end date']))
  })

  it('elke functie is security invoker, met set search_path = public en is_team_member(p_team_id)', () => {
    for (const f of functies()) {
      expect(f.kop, f.naam).toMatch(/language sql stable security invoker set search_path = public/)
      expect(f.body, f.naam).toMatch(/where is_team_member\(p_team_id\)/)
    }
    expect(sql).not.toMatch(/security definer/i)
  })

  it('elke alias uit from/join heeft een <alias>.team_id = p_team_id in dezelfde functie', () => {
    for (const f of functies()) {
      const aliassen = [...f.body.matchAll(/\b(?:from|join)\s+(?:public\.)?(\w+)\s+(\w+)/g)].map((m) => ({ tabel: m[1], alias: m[2] }))
      expect(aliassen.length, f.naam).toBeGreaterThan(0)
      for (const { tabel, alias } of aliassen) {
        // Elke tabel MOET een alias hebben: zonder alias botsen events.type en
        // players.type stil (inzichten-team-id.sql, kopcommentaar).
        expect(SQL_KEYWORDS.has(alias.toLowerCase()), `${f.naam}: ${tabel} zonder alias`).toBe(false)
        expect(f.body, `${f.naam}: ${alias}.team_id`).toMatch(new RegExp(`\\b${alias}\\.team_id\\s*=\\s*p_team_id\\b`))
      }
    }
  })

  it('de lineups-join heeft het team-filter in de ON-clausule (left join blijft left join)', () => {
    const body = functie('inzichten_wedstrijd_uitslagen').body
    expect(body).toMatch(/left join lineups l on l\.event_id = e\.id and l\.team_id = p_team_id/)
    // Niet (ook) in de WHERE: dan zou het stil een inner join worden.
    const where = body.slice(body.indexOf('where'))
    expect(where).not.toMatch(/\bl\.team_id\b/)
  })

  it(`inzichten_wedstrijd_uitslagen kapt af op MAX_SEIZOEN_WEDSTRIJDEN + 1 (= ${MAX_SEIZOEN_WEDSTRIJDEN + 1})`, () => {
    const body = functie('inzichten_wedstrijd_uitslagen').body
    expect(body).toMatch(new RegExp(`\\blimit ${MAX_SEIZOEN_WEDSTRIJDEN + 1};`))
    expect(body).toMatch(/e\.goals_for is not null/)
    expect(body).toMatch(/e\.goals_against is not null/)
  })

  it('alle vier filteren op wedstrijden binnen het venster', () => {
    for (const f of functies()) {
      expect(f.body, f.naam).toMatch(/e\.type = 'match'/)
      expect(f.body, f.naam).toMatch(/e\.date >= p_start and e\.date <= p_end/)
    }
  })

  it('inzichten_speler_momenten filtert BEWUST niet op active of type (V2)', () => {
    const body = functie('inzichten_speler_momenten').body
    expect(body).not.toMatch(/p\.active/)
    expect(body).not.toMatch(/p\.type\s*=\s*'regular'/)
    expect(body).toMatch(/\(p\.type = 'guest'\)/)
  })

  it('revoke en grant per signatuur, en een schema-reload', () => {
    for (const naam of RPC_NAMEN) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${naam}\\(uuid, date, date\\)\\s+from public, anon;`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${naam}\\(uuid, date, date\\)\\s+to authenticated;`))
    }
    expect(sql).toMatch(/notify pgrst, 'reload schema';/)
  })
})

describe('inzichten-metrics.sql — tabel tegendoelpunten', () => {
  it('heeft RLS aan en precies drie policies (select, insert, delete) — geen update', () => {
    expect(sql).toMatch(/alter table public\.tegendoelpunten enable row level security;/)
    const policies = sql.match(/create policy[\s\S]*?;/g) ?? []
    expect(policies).toHaveLength(3)
    expect(policies.map((p) => p.match(/for (\w+)/)![1])).toEqual(['select', 'insert', 'delete'])
    expect(sql).not.toMatch(/for (update|all)\b/i)
  })

  it('lezen via is_team_member, schrijven via can_edit(team_id, \'wedstrijd\')', () => {
    const policies = sql.match(/create policy[\s\S]*?;/g) ?? []
    expect(policies[0]).toMatch(/using \(is_team_member\(team_id\)\)/)
    expect(policies[1]).toMatch(/can_edit\(team_id, 'wedstrijd'\)/)
    expect(policies[2]).toMatch(/using \(can_edit\(team_id, 'wedstrijd'\)\)/)
  })

  it('de insert-policy eist een wedstrijd van hetzelfde team', () => {
    const insert = (sql.match(/create policy[\s\S]*?;/g) ?? [])[1]
    expect(insert).toMatch(/e\.id = tegendoelpunten\.event_id/)
    expect(insert).toMatch(/e\.team_id = tegendoelpunten\.team_id/)
    expect(insert).toMatch(/e\.type = 'match'/)
  })

  it('de soort-CHECK is gelijk aan TEGENDOELPUNT_SOORTEN, en minute volgt isValidMinute (0..130 of null)', () => {
    const m = sql.match(/check \(soort in \(([^)]*)\)\)/)
    expect(m).not.toBeNull()
    expect(m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual([...TEGENDOELPUNT_SOORTEN])
    expect(sql).toMatch(/check \(minute is null or minute between 0 and 130\)/)
  })

  it('team_id en event_id zijn verplicht en cascaden, created_at is timestamptz', () => {
    expect(sql).toMatch(/team_id\s+uuid not null references public\.teams\(id\) on delete cascade/)
    expect(sql).toMatch(/event_id\s+uuid not null references public\.events\(id\) on delete cascade/)
    expect(sql).toMatch(/created_at timestamptz not null default now\(\)/)
    expect(sql).toMatch(/create index if not exists idx_tegendoelpunten_team\s+on public\.tegendoelpunten\(team_id\);/)
  })

  it('staat in TEAM_TABELLEN, vóór events', () => {
    expect(TEAM_TABELLEN).toContain('tegendoelpunten')
    expect(TEAM_TABELLEN.indexOf('tegendoelpunten')).toBeLessThan(TEAM_TABELLEN.indexOf('events'))
  })
})

describe('team-rls-verificatie.sql — dekking van tegendoelpunten', () => {
  it('blok 2 controleert tegendoelpunten van een vreemd team', () => {
    const blok2 = verificatie.slice(verificatie.indexOf('-- ── Blok 2'), verificatie.indexOf('-- ── Blok 3'))
    expect(blok2).toMatch(/from tegendoelpunten\s+where team_id = 'TEAM_B_UUID'/)
    expect(blok2).toMatch(/LEK: niet-lid ziet tegendoelpunten/)
  })

  it('blok 26 staat vóór de rollback en roept alle vier RPC\'s met TEAM_B aan', () => {
    const start = verificatie.indexOf('-- ── Blok 26')
    expect(start).toBeGreaterThan(-1)
    const rollback = verificatie.search(/^rollback;/m)
    expect(start).toBeLessThan(rollback)
    const blok26 = verificatie.slice(start, rollback)
    for (const naam of RPC_NAMEN) {
      expect(blok26).toContain(`from ${naam}('TEAM_B_UUID'`)
    }
    // c: assistent zonder recht; d/f: 42501; e: 23514 en een update die niets raakt.
    expect(blok26).toContain('mag_wedstrijd_bewerken = false')
    expect(blok26).toMatch(/exception when insufficient_privilege/)
    expect(blok26).toMatch(/exception when check_violation/)
    expect(blok26).toMatch(/update tegendoelpunten set/)
  })
})

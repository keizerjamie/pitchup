// Structuurtest op supabase/inzichten-metrics-fase3a.sql (2 lees-RPC's) en het
// bijbehorende blok 29 in supabase/team-rls-verificatie.sql.
//
// Vitest praat nooit met Postgres: deze test leest de SQL als TEKST en legt de
// tenant-isolatie-, limiet- en uitzonderingsregels vast (zelfde aanpak als
// inzichten-metrics-fase2b-migratie.acceptance.test.ts, waarvan de helpers
// functies/bronnen hier terugkomen). Het gedrag zelf bewijst alleen blok 29 in
// de SQL Editor.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { MAX_FASE3_RIJEN } from '@/lib/inzichten'

const ARGS = 'p_team_id uuid, p_start date, p_end date'
const TYPEN = 'uuid, date, date'
const KOPPELINGEN = 'inzichten_training_koppelingen'
const DISCIPLINE = 'inzichten_invul_discipline'

// Tabellen met een team_id = teams.id: elke alias erop moet zelf gefilterd zijn.
const TEAM_TABELLEN = new Set(['events', 'training_oefeningen', 'match_ratings', 'match_events', 'task_overrides'])
// De BEWUSTE uitzondering: oefeningen.team_id is de eigenaar-user.
const TOEGESTAAN = new Set([...TEAM_TABELLEN, 'oefeningen'])
const SQL_KEYWORDS = new Set(['where', 'on', 'left', 'right', 'inner', 'cross', 'join', 'group', 'order', 'as', 'limit'])

const ruw = readFileSync(path.resolve(__dirname, 'supabase', 'inzichten-metrics-fase3a.sql'), 'utf8')
// Alleen de uitvoerbare SQL: commentaar eruit, zodat een toelichting nooit een
// ontbrekende regel kan "dekken".
const sql = ruw.replace(/--[^\n]*/g, '')

const verificatie = readFileSync(path.resolve(__dirname, 'supabase', 'team-rls-verificatie.sql'), 'utf8')

function functies(): { naam: string; args: string; kop: string; body: string }[] {
  const re = /create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)as \$\$([\s\S]*?)\$\$;/g
  return [...sql.matchAll(re)].map((m) => ({ naam: m[1], args: m[2].replace(/\s+/g, ' ').trim(), kop: m[3], body: m[4] }))
}

function functie(naam: string) {
  const f = functies().find((x) => x.naam === naam)
  if (!f) throw new Error(`functie ${naam} niet gevonden`)
  return f
}

// Alle from/join-doelen. `is distinct from` is geen from-clausule.
function bronnen(b: string): { doel: string; alias: string | undefined; index: number; isJoin: boolean }[] {
  const re = /(?<!\bdistinct\s+)\b(from|join)\s+(?:public\.)?(\w+)(?:\s+(\w+))?/g
  return [...b.matchAll(re)].map((m) => ({ isJoin: m[1] === 'join', doel: m[2], alias: m[3], index: m.index! }))
}

// Het eigen stuk SQL van één bron, op dezelfde haakjesdiepte:
// - een join: zijn ON-clausule, tot de volgende join/where/order/limit;
// - een from: tot het sluitende haakje van de subquery (of het einde van de
//   functie), dus inclusief zijn where.
// Een filter in een andere subquery of in de ON van een andere join telt zo
// nooit mee — en omdat de aliassen per functie uniek zijn, kan ook een
// filter op een andere alias in hetzelfde stuk geen ontbrekende maskeren.
function segment(b: string, bron: { index: number; isJoin: boolean }): string {
  let diepte = 0
  const stop = bron.isJoin ? /^\s*\b(?:left\s+join|join|where|order|group|limit)\b/ : null
  for (let i = bron.index + 1; i < b.length; i++) {
    const c = b[i]
    if (c === '(') diepte++
    else if (c === ')') {
      if (diepte === 0) return b.slice(bron.index, i)
      diepte--
    } else if (stop && diepte === 0 && /\s/.test(c) && stop.test(b.slice(i))) {
      return b.slice(bron.index, i)
    }
  }
  return b.slice(bron.index)
}

// De where-clausule van de hoofdquery: van `where` tot `order by`.
const hoofdWhere = (b: string) => b.slice(b.search(/\bwhere\b/), b.search(/\border by\b/))

const teamFilter = (alias: string) => new RegExp(`\\b${alias}\\.team_id\\s*=\\s*p_team_id\\b`)

describe('inzichten-metrics-fase3a.sql — vorm', () => {
  it('definieert precies twee functies met de exacte signaturen', () => {
    expect(functies().map((f) => [f.naam, f.args])).toEqual([
      [KOPPELINGEN, ARGS],
      [DISCIPLINE, ARGS],
    ])
    expect([...sql.matchAll(/create or replace function/g)]).toHaveLength(2)
  })

  it('exacte returns table (...) van beide functies', () => {
    expect(functie(KOPPELINGEN).kop.replace(/\s+/g, ' ')).toMatch(
      /returns table \(event_id uuid, datum date, trainingstype text, koppeling_id uuid, volgorde int, aangemaakt timestamptz, parallel_groep_id uuid, koppeling_duur_min int, oefening_duur_min int, categorie text, stap_override int, oefening_leesbaar boolean, totaal int\)/,
    )
    expect(functie(DISCIPLINE).kop.replace(/\s+/g, ' ')).toMatch(
      /returns table \(event_id uuid, soort text, datum date, goals_for int, goals_against int, doelstelling text, aantal_ratings int, aantal_momenten int, aantal_oefeningen int, handmatig boolean, totaal int\)/,
    )
  })

  it('security invoker, stable, set search_path = public en where is_team_member(p_team_id); nergens security definer', () => {
    for (const f of functies()) {
      expect(f.kop, f.naam).toMatch(/language sql stable security invoker set search_path = public/)
      expect(f.body, f.naam).toMatch(/where is_team_member\(p_team_id\)/)
    }
    expect(sql).not.toMatch(/security definer/i)
  })

  it('alleen lezen: geen tabel, kolom, policy, index of schrijfopdracht', () => {
    expect(sql).not.toMatch(/\bcreate\s+table\b/i)
    expect(sql).not.toMatch(/\balter\s+table\b/i)
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i)
    expect(sql).not.toMatch(/\bcreate\s+(unique\s+)?index\b/i)
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate)\b/i)
  })

  it('revoke voor public/anon, grant aan authenticated, en een schema-reload', () => {
    for (const naam of [KOPPELINGEN, DISCIPLINE]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${naam}\\(${TYPEN}\\) from public, anon;`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${naam}\\(${TYPEN}\\) to authenticated;`))
    }
    expect(sql).toMatch(/notify pgrst, 'reload schema';/)
  })
})

describe('inzichten-metrics-fase3a.sql — tenant-isolatie per alias', () => {
  it.each([KOPPELINGEN, DISCIPLINE])('%s: alleen toegestane tabellen, elk met een eigen, unieke alias', (naam) => {
    const lijst = bronnen(functie(naam).body)
    for (const { doel, alias } of lijst) {
      expect(TOEGESTAAN.has(doel), `onbekend from/join-doel ${doel}`).toBe(true)
      expect(alias !== undefined && !SQL_KEYWORDS.has(alias.toLowerCase()), `${doel} zonder alias`).toBe(true)
    }
    const aliassen = lijst.map((b) => b.alias)
    expect(new Set(aliassen).size, `dubbele alias in ${naam}: ${aliassen.join(', ')}`).toBe(aliassen.length)
  })

  it('de verwachte bronnen per functie', () => {
    const lijst = (naam: string) => bronnen(functie(naam).body).map((b) => `${b.doel} ${b.alias}`).sort()
    expect(lijst(KOPPELINGEN)).toEqual(['events e', 'oefeningen oef', 'training_oefeningen k'])
    expect(lijst(DISCIPLINE)).toEqual(['events e', 'match_events me', 'match_ratings r', 'task_overrides tov', 'training_oefeningen k'])
  })

  it.each([KOPPELINGEN, DISCIPLINE])('%s: elke alias op een teamtabel heeft <alias>.team_id = p_team_id in zijn eigen segment', (naam) => {
    const body = functie(naam).body
    for (const bron of bronnen(body).filter((b) => TEAM_TABELLEN.has(b.doel))) {
      expect(segment(body, bron), `${bron.doel} ${bron.alias} zonder ${bron.alias}.team_id = p_team_id`).toMatch(
        teamFilter(bron.alias!),
      )
    }
  })

  it('het segment is echt per alias: een filter in een andere subquery of ON telt niet mee', () => {
    // Zelftest van de helper: zonder r.team_id faalt r, ook al staat me.team_id ernaast.
    const nep = `select (select count(*) from match_ratings r where r.event_id = e.id)::int,
                 (select count(*) from match_events me where me.event_id = e.id and me.team_id = p_team_id)::int
                 from events e left join training_oefeningen k on k.event_id = e.id where e.team_id = p_team_id and k.team_id = p_team_id`
    const per = Object.fromEntries(bronnen(nep).map((b) => [b.alias, segment(nep, b)]))
    expect(per.r).not.toMatch(teamFilter('r'))
    expect(per.me).toMatch(teamFilter('me'))
    expect(per.k).not.toMatch(teamFilter('k')) // in de where, niet in de ON
    expect(per.e).toMatch(teamFilter('e'))
  })

  it('k.team_id = p_team_id staat in de ON van de left join, niet in de where (training zonder koppeling blijft)', () => {
    const body = functie(KOPPELINGEN).body
    expect(body).toMatch(/left join training_oefeningen k on k\.event_id = e\.id and k\.team_id = p_team_id/)
    expect(hoofdWhere(body)).toMatch(/e\.team_id = p_team_id/)
    expect(hoofdWhere(body)).not.toMatch(/\bk\./)
  })
})

describe('inzichten-metrics-fase3a.sql — bewuste uitzondering oefeningen (EIGENAAR-USER)', () => {
  const body = () => functie(KOPPELINGEN).body

  it('precies één bron oefeningen oef, als left join op de koppeling', () => {
    const oef = bronnen(sql).filter((b) => b.doel === 'oefeningen')
    expect(oef.map((b) => b.alias)).toEqual(['oef'])
    expect(body()).toMatch(/left join oefeningen oef on oef\.id = k\.oefening_id\s/)
  })

  it('de uitvoerbare SQL filtert oefeningen NIET op team_id', () => {
    expect(sql).not.toMatch(/\boef\.team_id\b/)
  })

  it('de uitzondering staat gedocumenteerd in het commentaar', () => {
    expect(ruw).toContain('EIGENAAR-USER')
    expect(ruw).toMatch(/BEWUSTE UITZONDERING: oefeningen wordt NIET op team_id gefilterd/)
  })

  it('leesbaarheid gaat als vlag mee, nooit stil weg', () => {
    expect(body()).toMatch(/\(oef\.id is not null\)/)
  })
})

describe('inzichten-metrics-fase3a.sql — limiet, venster en afbeeldingen', () => {
  it('beide functies: limit 901 en totaal = count(*) over (); gebonden aan MAX_FASE3_RIJEN', () => {
    expect(MAX_FASE3_RIJEN + 1).toBe(901)
    for (const f of functies()) {
      expect(f.body, f.naam).toMatch(new RegExp(`\\blimit ${MAX_FASE3_RIJEN + 1};\\s*$`))
      expect(f.body, f.naam).toMatch(/\(count\(\*\) over \(\)\)::int/)
    }
    expect(sql.match(/\blimit\s+\d+/g)).toEqual(['limit 901', 'limit 901'])
  })

  it('RPC 1: alleen trainingen, venster inclusief, GEEN filter op trainingstype', () => {
    const body = functie(KOPPELINGEN).body
    expect(body).toMatch(/\be\.type = 'training'/)
    expect(body).toMatch(/e\.date >= p_start and e\.date <= p_end/)
    expect(hoofdWhere(body)).toMatch(/e\.type = 'training'/)
    expect(hoofdWhere(body)).not.toMatch(/trainingstype/)
    expect(body).toMatch(/order by e\.date, e\.id, k\.volgorde, k\.created_at, k\.id/)
  })

  it('RPC 2: wedstrijden en trainingen, venster inclusief, exacte task_type-afbeelding', () => {
    const body = functie(DISCIPLINE).body
    expect(body).toMatch(/\be\.type in \('match', 'training'\)/)
    expect(body).toMatch(/e\.date >= p_start and e\.date <= p_end/)
    expect(body).toMatch(/tov\.task_type = case e\.type when 'match' then 'analysis' else 'training_plan' end/)
    expect(body).toMatch(/case when e\.type = 'training' then e\.doelstelling end/)
    expect(body).toMatch(/order by e\.date, e\.id/)
  })

  it('geen date_trunc: de ISO-week wordt in TS bepaald', () => {
    expect(sql).not.toMatch(/date_trunc/i)
  })
})

describe('team-rls-verificatie.sql — blok 29', () => {
  const rollback = verificatie.search(/^rollback;/m)
  const start = verificatie.indexOf('-- ── Blok 29')
  const blok29 = verificatie.slice(start, rollback)

  it('staat na blok 28 en vóór de rollback', () => {
    expect(start).toBeGreaterThan(verificatie.indexOf('-- ── Blok 28'))
    expect(start).toBeLessThan(rollback)
  })

  it('kop en voetcommentaar noemen blok 29', () => {
    const kop = verificatie.slice(0, verificatie.indexOf('begin;'))
    expect(kop).toMatch(/\* blok 29\s+— vereist supabase\/inzichten-metrics-fase3a\.sql/)
    expect(verificatie.slice(rollback)).toMatch(/fase 3a \(2 lees-RPC's[^)]*\) in blok\s+(-- )?29/)
  })

  it('testdata in maart 1990 (jan./feb. zijn bezet door blok 27/28) met eerst de opzetcheck', () => {
    expect(blok29).toMatch(/v_start date := date '1990-03-01'/)
    expect(blok29).toContain('FOUT IN DE OPZET: TEAM_A heeft al events in maart 1990')
    expect(blok29).toContain('INZICHTEN-METRICS FASE 3A ONTBREEKT')
  })

  it('dekt vreemd team, vreemde koppeling, M6-oefening, discipline, niet-lid, anon en alleen-lezen', () => {
    for (const naam of [KOPPELINGEN, DISCIPLINE]) {
      expect(blok29).toContain(`from ${naam}('TEAM_B_UUID'`)
      expect(blok29).toContain(`LEK: ${naam} geeft % rijen van TEAM_B`)
      expect(blok29).toMatch(new RegExp(`has_function_privilege\\('anon', 'public\\.${naam}\\(${TYPEN}\\)', 'execute'\\)`))
    }
    expect(blok29).toMatch(/values \('TEAM_B_UUID', v_t1, v_o1, 3, 45\)/)
    expect(blok29).toContain('LEK: een koppeling van TEAM_B telt mee')
    expect(blok29).toMatch(/values \(gen_random_uuid\(\), 'RLS-29 teamgenoot', 'partijen_klein', 15\)/)
    expect(blok29).toContain('KAPOT: oefening van teamgenoot niet leesbaar — staat M6 er nog?')
    expect(blok29).toContain('LEK: een task_override van TEAM_B telt mee als handmatig afgevinkt')
    expect(blok29).toContain('LEK: een niet-lid krijgt % rijen')
    expect(blok29).toContain('BUITENSTAANDER_UUID')
    expect(blok29).toContain('KAPOT: de fase-3a-RPC\'\'s hebben geschreven')
    expect(blok29).toMatch(/p\.provolatile = 's' and not p\.prosecdef/)
  })

  it('gebruikt geen check_violation (de telling van blok 28 loopt tot de rollback)', () => {
    expect(blok29).not.toMatch(/exception when check_violation/)
  })
})

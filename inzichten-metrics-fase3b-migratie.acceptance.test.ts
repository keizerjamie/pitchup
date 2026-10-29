// Structuurtest op supabase/inzichten-metrics-fase3b.sql (tabel
// training_evaluaties + 1 lees-RPC) en het bijbehorende blok 30 in
// supabase/team-rls-verificatie.sql, plus de vermelding in blok 2 en blok 22.
//
// Vitest praat nooit met Postgres: deze test leest de SQL als TEKST en legt de
// tenant-isolatie-, limiet- en CHECK-regels vast (zelfde aanpak en helpers
// functies/bronnen/segment als inzichten-metrics-fase3a-migratie.acceptance.
// test.ts). Het gedrag zelf bewijzen alleen blok 2, 22 en 30 in de SQL Editor.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { MAX_FASE3_RIJEN } from '@/lib/inzichten'
import { RPE_MAX, RPE_MIN, TRAINING_OORDELEN } from '@/lib/training-evaluatie'
import { TEAM_TABELLEN } from '@/lib/team-opruimen'

const ARGS = 'p_team_id uuid, p_start date, p_end date'
const TYPEN = 'uuid, date, date'
const RPC = 'inzichten_training_evaluaties'

// Tabellen met een team_id = teams.id: elke alias erop moet zelf gefilterd zijn.
const TEAM_TABELLEN_SQL = new Set(['events', 'training_evaluaties'])
const SQL_KEYWORDS = new Set(['where', 'on', 'left', 'right', 'inner', 'cross', 'join', 'group', 'order', 'as', 'limit'])

const ruw = readFileSync(path.resolve(__dirname, 'supabase', 'inzichten-metrics-fase3b.sql'), 'utf8')
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

function bronnen(b: string): { doel: string; alias: string | undefined; index: number; isJoin: boolean }[] {
  const re = /(?<!\bdistinct\s+)\b(from|join)\s+(?:public\.)?(\w+)(?:\s+(\w+))?/g
  return [...b.matchAll(re)].map((m) => ({ isJoin: m[1] === 'join', doel: m[2], alias: m[3], index: m.index! }))
}

// Het eigen stuk SQL van één bron (zie de fase-3a-structuurtest): een join tot
// de volgende join/where/order/limit, een from tot het einde van zijn query.
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

const hoofdWhere = (b: string) => b.slice(b.search(/\bwhere\b/), b.search(/\border by\b/))
const teamFilter = (alias: string) => new RegExp(`\\b${alias}\\.team_id\\s*=\\s*p_team_id\\b`)

// De create table-definitie (tot de sluitende `);`).
const tabel = (() => {
  const m = sql.match(/create table if not exists public\.training_evaluaties \(([\s\S]*?)\n\);/)
  if (!m) throw new Error('create table training_evaluaties niet gevonden')
  return m[1]
})()
const kolom = (naam: string) => tabel.split('\n').find((r) => new RegExp(`^\\s*${naam}\\s`).test(r)) ?? ''

// Policies: naam, commando en de rest van het statement tot de puntkomma.
function policies(): { naam: string; cmd: string; tekst: string }[] {
  const re = /create policy "([^"]+)" on public\.training_evaluaties\s+for (select|insert|update|delete)([\s\S]*?);/g
  return [...sql.matchAll(re)].map((m) => ({ naam: m[1], cmd: m[2], tekst: m[3].replace(/\s+/g, ' ') }))
}
const policy = (cmd: string) => policies().find((p) => p.cmd === cmd)!
const EVENTCHECK = [
  /can_edit\(team_id, 'training'\)/,
  /e\.id = training_evaluaties\.event_id/,
  /e\.team_id = training_evaluaties\.team_id/,
  /e\.type = 'training'/,
]

describe('inzichten-metrics-fase3b.sql — functie', () => {
  it('definieert precies één functie met de exacte signatuur', () => {
    expect(functies().map((f) => [f.naam, f.args])).toEqual([[RPC, ARGS]])
    expect([...sql.matchAll(/create or replace function/g)]).toHaveLength(1)
  })

  it('exacte returns table (...)', () => {
    expect(functie(RPC).kop.replace(/\s+/g, ' ')).toMatch(
      /returns table \(event_id uuid, datum date, doelstelling text, rpe int, oordeel text, totaal int\)/,
    )
  })

  it('security invoker, stable, set search_path = public en where is_team_member(p_team_id); nergens security definer', () => {
    const f = functie(RPC)
    expect(f.kop).toMatch(/language sql stable security invoker set search_path = public/)
    expect(f.body).toMatch(/where is_team_member\(p_team_id\)/)
    expect(sql).not.toMatch(/security definer/i)
  })

  it('alleen de verwachte bronnen, elk met een eigen alias', () => {
    const lijst = bronnen(functie(RPC).body)
    for (const { doel, alias } of lijst) {
      expect(TEAM_TABELLEN_SQL.has(doel), `onbekend from/join-doel ${doel}`).toBe(true)
      expect(alias !== undefined && !SQL_KEYWORDS.has(alias.toLowerCase()), `${doel} zonder alias`).toBe(true)
    }
    expect(lijst.map((b) => `${b.doel} ${b.alias}`).sort()).toEqual(['events e', 'training_evaluaties te'])
  })

  it('elke alias heeft <alias>.team_id = p_team_id in zijn eigen segment', () => {
    const body = functie(RPC).body
    for (const bron of bronnen(body)) {
      expect(segment(body, bron), `${bron.doel} ${bron.alias}`).toMatch(teamFilter(bron.alias!))
    }
  })

  it('te.team_id = p_team_id staat in de ON van de left join, niet in de where (training zonder evaluatie blijft)', () => {
    const body = functie(RPC).body
    expect(body).toMatch(/left join training_evaluaties te on te\.event_id = e\.id and te\.team_id = p_team_id/)
    expect(hoofdWhere(body)).toMatch(/e\.team_id = p_team_id/)
    expect(hoofdWhere(body)).not.toMatch(/\bte\./)
  })

  it('alleen trainingen, venster inclusief, deterministische volgorde', () => {
    const body = functie(RPC).body
    expect(hoofdWhere(body)).toMatch(/e\.type = 'training'/)
    expect(body).toMatch(/e\.date >= p_start and e\.date <= p_end/)
    expect(body).toMatch(/order by e\.date, e\.id/)
    expect(sql).not.toMatch(/date_trunc/i)
  })

  it('limit 901 en totaal = count(*) over (); gebonden aan MAX_FASE3_RIJEN', () => {
    expect(MAX_FASE3_RIJEN + 1).toBe(901)
    expect(functie(RPC).body).toMatch(new RegExp(`\\blimit ${MAX_FASE3_RIJEN + 1};\\s*$`))
    expect(functie(RPC).body).toMatch(/\(count\(\*\) over \(\)\)::int/)
    expect(sql.match(/\blimit\s+\d+/g)).toEqual(['limit 901'])
  })
})

describe('inzichten-metrics-fase3b.sql — tabel', () => {
  it('één rij per training (unique event_id), FK-cascade naar teams en events, geen speler-kolom', () => {
    expect(tabel).toMatch(/constraint training_evaluaties_event_key unique \(event_id\)/)
    expect(kolom('team_id')).toMatch(/uuid not null references public\.teams\(id\)\s+on delete cascade/)
    expect(kolom('event_id')).toMatch(/uuid not null references public\.events\(id\)\s+on delete cascade/)
    expect(sql).not.toMatch(/player_id/)
    expect(kolom('created_at')).toMatch(/timestamptz not null default now\(\)/)
  })

  it('rpe smallint nullable met between RPE_MIN and RPE_MAX', () => {
    expect([RPE_MIN, RPE_MAX]).toEqual([1, 10])
    expect(kolom('rpe')).toMatch(/^\s*rpe\s+smallint\b/)
    expect(kolom('rpe')).not.toMatch(/not null/)
    expect(kolom('rpe')).toMatch(new RegExp(`check \\(rpe between ${RPE_MIN} and ${RPE_MAX}\\)`))
  })

  it('oordeel text nullable met exact de lijst TRAINING_OORDELEN', () => {
    expect(kolom('oordeel')).toMatch(/^\s*oordeel\s+text\b/)
    expect(kolom('oordeel')).not.toMatch(/not null/)
    const m = kolom('oordeel').match(/check \(oordeel in \(([^)]*)\)\)/)
    expect(m, 'CHECK op oordeel').not.toBeNull()
    expect(m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual([...TRAINING_OORDELEN])
    expect(m![1]).toBe("'ja', 'deels', 'nee'")
  })

  it('geen CHECK "minstens één niet-null" (zou wissen zonder delete onmogelijk maken)', () => {
    expect(tabel).not.toMatch(/is not null/)
    expect(tabel.match(/\bcheck\b/g)).toHaveLength(2)
  })

  it('index op team_id en RLS aan', () => {
    expect(sql).toMatch(/create index if not exists idx_training_evaluaties_team on public\.training_evaluaties\(team_id\);/)
    expect(sql).toMatch(/alter table public\.training_evaluaties enable row level security;/)
  })
})

describe('inzichten-metrics-fase3b.sql — policies', () => {
  it('precies vier: select, insert, update en delete, elk eerst gedropt (idempotent)', () => {
    expect(policies().map((p) => p.cmd)).toEqual(['select', 'insert', 'update', 'delete'])
    for (const p of policies()) {
      expect(sql).toContain(`drop policy if exists "${p.naam}"`)
    }
    expect([...sql.matchAll(/create policy/g)]).toHaveLength(4)
  })

  it('select = is_team_member(team_id)', () => {
    expect(policy('select').tekst).toMatch(/using \(is_team_member\(team_id\)\)/)
  })

  it('insert én update with check: recht training + het event is een training van hetzelfde team', () => {
    const insert = policy('insert').tekst
    expect(insert).toMatch(/with check \(/)
    const update = policy('update').tekst
    const updateCheck = update.slice(update.indexOf('with check'))
    expect(updateCheck.length).toBeGreaterThan(10)
    for (const re of EVENTCHECK) {
      expect(insert, `insert ${re}`).toMatch(re)
      expect(updateCheck, `update with check ${re}`).toMatch(re)
    }
    expect(update).toMatch(/using \(can_edit\(team_id, 'training'\)\)/)
  })

  it('delete alleen op recht training (opruimen moet altijd kunnen)', () => {
    expect(policy('delete').tekst).toMatch(/using \(can_edit\(team_id, 'training'\)\)/)
  })

  it("geen ander onderdeel dan 'training' (R4): geen 'aanwezigheid', 'spelers' of 'wedstrijd'", () => {
    expect(sql).not.toMatch(/'aanwezigheid'|'spelers'|'wedstrijd'|'agenda'/)
    expect([...sql.matchAll(/can_edit\(team_id, '(\w+)'\)/g)].map((m) => m[1]).every((o) => o === 'training')).toBe(true)
  })

  it('productregels (toekomst, doelstelling) staan NIET in de SQL', () => {
    expect(sql).not.toMatch(/doelstelling\s*(<>|!=|is not null)/)
    expect(sql).not.toMatch(/current_date|now\(\)\s*[<>]/)
    expect(ruw).toMatch(/BEWUST in de app/)
  })
})

describe('inzichten-metrics-fase3b.sql — afsluiting', () => {
  it('revoke voor public/anon, grant aan authenticated, commit en schema-reload', () => {
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${RPC}\\(${TYPEN}\\) from public, anon;`))
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${RPC}\\(${TYPEN}\\) to authenticated;`))
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(sql).toMatch(/notify pgrst, 'reload schema';/)
  })
})

describe('team-rls-verificatie.sql — blok 2, 22 en 30', () => {
  const rollback = verificatie.search(/^rollback;/m)
  const start = verificatie.indexOf('-- ── Blok 30')
  const blok30 = verificatie.slice(start, rollback)

  it('blok 2 controleert training_evaluaties van een vreemd team', () => {
    const blok2 = verificatie.slice(verificatie.indexOf('-- ── Blok 2:'), verificatie.indexOf('-- ── Blok 3:'))
    expect(blok2).toMatch(/select count\(\*\) into n from training_evaluaties where team_id = 'TEAM_B_UUID';/)
    expect(blok2).toContain('LEK: niet-lid ziet trainingsevaluaties van een vreemd team')
  })

  it('beide blok-22-lussen noemen training_evaluaties, direct na speelminuten, gelijk aan TEAM_TABELLEN', () => {
    const blok22 = verificatie.slice(verificatie.indexOf('-- ── Blok 22'), verificatie.indexOf('-- ── Blok 23'))
    const lussen = [...blok22.matchAll(/foreach v_tabel in array array\[([^\]]+)\]/g)]
      .map((m) => m[1].split(',').map((t) => t.trim().replace(/^'|'$/g, '')))
      .filter((l) => l.includes('events'))
    expect(lussen).toHaveLength(2)
    for (const l of lussen) {
      expect(l).toEqual([...TEAM_TABELLEN])
      expect(l.indexOf('training_evaluaties')).toBe(l.indexOf('speelminuten') + 1)
    }
  })

  it('blok 30 staat na blok 29 en vóór de rollback', () => {
    expect(start).toBeGreaterThan(verificatie.indexOf('-- ── Blok 29'))
    expect(start).toBeLessThan(rollback)
  })

  it('kop en voet noemen blok 30; de bestaande blok-29-regels zijn intact', () => {
    const kop = verificatie.slice(0, verificatie.indexOf('begin;'))
    expect(kop).toMatch(/\* blok 30\s+— vereist supabase\/inzichten-metrics-fase3b\.sql/)
    expect(kop).toMatch(/\* blok 29\s+— vereist supabase\/inzichten-metrics-fase3a\.sql/)
    expect(kop.replace(/\n--\s*/g, ' ')).toMatch(/noemen ook blok 2 en blok 22 de tabel training_evaluaties/)
    const voet = verificatie.slice(rollback)
    expect(voet).toMatch(/fase 3b \(tabel training_evaluaties \+ 1 RPC\) in blok\s+(-- )?30/)
    expect(voet).toMatch(/fase 3a \(2 lees-RPC's[^)]*\) in blok\s+(-- )?29/)
  })

  it('testdata in april 1990 met eerst de migratie- en opzetcheck', () => {
    expect(blok30).toMatch(/v_start date := date '1990-04-01'/)
    expect(blok30).toContain('INZICHTEN-METRICS FASE 3B ONTBREEKT')
    expect(blok30).toContain('FOUT IN DE OPZET: TEAM_A heeft al events in april 1990')
    expect(blok30).toMatch(/to_regclass\('public\.training_evaluaties'\)/)
    expect(blok30).toMatch(new RegExp(`to_regprocedure\\('public\\.${RPC}\\(${TYPEN}\\)'\\)`))
    expect(blok30.indexOf('FOUT IN DE OPZET: TEAM_A heeft al events')).toBeLessThan(blok30.indexOf('insert into events'))
  })

  it('assistent met Spelers en Aanwezigheid, zonder Training (R4)', () => {
    expect(blok30).toMatch(/set mag_training_bewerken = false, mag_spelers_bewerken = true, mag_aanwezigheid_bewerken = true/)
    expect(blok30).toMatch(/values \('TEAM_A_UUID', 'ASSISTENT_A_UUID', 'assistent', true, true, false\)/)
  })

  it('dekt a–l met de LEK- en KAPOT-meldingen', () => {
    for (const tekst of [
      'LEK: OWNER_A ziet % trainingsevaluaties van TEAM_B', // a
      'LEK: OWNER_A ziet een trainingsevaluatie op een training van TEAM_B', // a
      `LEK: ${RPC} geeft % rijen van TEAM_B`, // b
      'KAPOT: een wedstrijd staat in inzichten_training_evaluaties', // b
      "KAPOT: inzichten_training_evaluaties(TEAM_A, april 1990) geeft % rijen (verwacht 3", // b
      'KAPOT: T2 zonder evaluatie', // b
      'LEK: een assistent zonder trainingsrecht kon een RPE vastleggen', // c
      'LEK: een assistent zonder trainingsrecht kon een trainingsevaluatie wijzigen', // c
      'LEK: een assistent zonder trainingsrecht kon een trainingsevaluatie verwijderen', // c
      'LEK: OWNER_A kon een evaluatie aan een training van TEAM_B hangen', // d
      'LEK: een RPE kon aan een wedstrijd gehangen worden', // e
      'KAPOT: rpe 0 werd geaccepteerd', // f
      'KAPOT: rpe 11 werd geaccepteerd', // f
      'KAPOT: oordeel misschien werd geaccepteerd', // f
      'KAPOT: een tweede rij voor dezelfde training werd geaccepteerd', // g
      'KAPOT (R.9): de RPE-upsert', // h
      'KAPOT (R.9): de oordeel-upsert', // h
      'KAPOT: een herstel overschreef een bestaande RPE', // h
      'LEK: een update kon een evaluatie naar een training van TEAM_B verplaatsen', // i
      'LEK: een update kon een evaluatie naar een wedstrijd verplaatsen', // i
      'LEK: een update kon een evaluatie naar TEAM_B verplaatsen', // i
      'KAPOT: na het verwijderen van de training staan er nog', // j
      'LEK: een niet-lid krijgt % rijen uit inzichten_training_evaluaties(TEAM_A)', // k
      'LEK: anon mag inzichten_training_evaluaties uitvoeren', // l
    ]) {
      expect(blok30, tekst).toContain(tekst)
    }
    expect(blok30).toContain(`from ${RPC}('TEAM_B_UUID'`)
    expect(blok30).toContain('BUITENSTAANDER_UUID')
    expect(blok30).toMatch(/on conflict \(event_id\) do update set rpe = excluded\.rpe;/)
    expect(blok30).toMatch(/on conflict \(event_id\) do update set oordeel = excluded\.oordeel;/)
    expect(blok30).toMatch(/and rpe is null;/)
    expect(blok30).toMatch(/delete from events where id = v_t3;/)
    expect(blok30).toMatch(new RegExp(`has_function_privilege\\('anon', 'public\\.${RPC}\\(${TYPEN}\\)', 'execute'\\)`))
    expect(blok30).toMatch(/p\.provolatile = 's' and not p\.prosecdef/)
    expect((blok30.match(/exception when insufficient_privilege then/g) ?? []).length).toBe(6)
  })

  it("vangt CHECK-fouten met sqlstate '23514' en NIET met check_violation (ook niet in commentaar)", () => {
    expect((blok30.match(/exception when sqlstate '23514' then/g) ?? []).length).toBe(3)
    expect(blok30).not.toMatch(/check_violation/)
  })
})

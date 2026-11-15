// Structuurtest op supabase/trainer-zelfreview.sql (tabel trainer_zelfreviews
// + 1 lees-RPC) en het bijbehorende blok 31 in supabase/team-rls-verificatie.sql,
// plus de vermelding in blok 2 en blok 22.
//
// Vitest praat nooit met Postgres: deze test leest de SQL als TEKST en legt de
// privacy-, tenant-isolatie-, limiet- en CHECK-regels vast (zelfde aanpak en
// helpers als inzichten-metrics-fase3b-migratie.acceptance.test.ts). Het gedrag
// zelf bewijzen alleen blok 2, 22 en 31 in de SQL Editor.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { MAX_FASE3_RIJEN } from '@/lib/inzichten'
import { TEAM_TABELLEN } from '@/lib/team-opruimen'
import {
  ZELFREVIEW_MEENEEM_MAX,
  ZELFREVIEW_SCORE_MAX,
  ZELFREVIEW_SCORE_MIN,
  ZELFREVIEW_STELLINGEN,
  kolomVoor,
} from '@/lib/trainer-zelfreview'

const ARGS = 'p_team_id uuid, p_start date, p_end date'
const TYPEN = 'uuid, date, date'
const RPC = 'inzichten_eigen_zelfreviews'
const TABEL = 'trainer_zelfreviews'

const TEAM_TABELLEN_SQL = new Set(['events', TABEL])
const SQL_KEYWORDS = new Set(['where', 'on', 'left', 'right', 'inner', 'cross', 'join', 'group', 'order', 'as', 'limit'])

const ruw = readFileSync(path.resolve(__dirname, 'supabase', 'trainer-zelfreview.sql'), 'utf8')
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

// Het eigen stuk SQL van één bron: een join tot de volgende join/where/order/
// limit, een from tot het einde van zijn query.
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

const tabel = (() => {
  const m = sql.match(/create table if not exists public\.trainer_zelfreviews \(([\s\S]*?)\n\);/)
  if (!m) throw new Error('create table trainer_zelfreviews niet gevonden')
  return m[1]
})()
const kolom = (naam: string) => tabel.split('\n').find((r) => new RegExp(`^\\s*${naam}\\s`).test(r)) ?? ''

function policies(): { naam: string; cmd: string; tekst: string }[] {
  const re = /create policy "([^"]+)" on public\.trainer_zelfreviews\s+for (select|insert|update|delete|all)([\s\S]*?);/g
  return [...sql.matchAll(re)].map((m) => ({ naam: m[1], cmd: m[2], tekst: m[3].replace(/\s+/g, ' ') }))
}
const policy = (cmd: string) => policies().find((p) => p.cmd === cmd)!
const SCHRIJFCHECK = [
  /user_id = auth\.uid\(\)/,
  /can_edit\(team_id, 'training'\)/,
  /e\.id = trainer_zelfreviews\.event_id/,
  /e\.team_id = trainer_zelfreviews\.team_id/,
  /e\.type = 'training'/,
  /e\.date <= \(now\(\) at time zone 'Europe\/Amsterdam'\)::date/,
]

describe('trainer-zelfreview.sql — tabel', () => {
  it('vijf score-kolommen = ZELFREVIEW_STELLINGEN, smallint not null, check between MIN and MAX', () => {
    expect([ZELFREVIEW_SCORE_MIN, ZELFREVIEW_SCORE_MAX]).toEqual([1, 5])
    const scoreKolommen = tabel.split('\n').map((r) => r.match(/^\s*(score_\w+)\s/)?.[1]).filter(Boolean)
    expect(scoreKolommen).toEqual(ZELFREVIEW_STELLINGEN.map(kolomVoor))
    for (const stelling of ZELFREVIEW_STELLINGEN) {
      const k = kolomVoor(stelling)
      expect(kolom(k), k).toMatch(new RegExp(`^\\s*${k}\\s+smallint not null\\b`))
      expect(kolom(k), k).toMatch(new RegExp(`check \\(${k} between ${ZELFREVIEW_SCORE_MIN} and ${ZELFREVIEW_SCORE_MAX}\\)`))
    }
  })

  it('meeneem text nullable met char_length <= ZELFREVIEW_MEENEEM_MAX', () => {
    expect(ZELFREVIEW_MEENEEM_MAX).toBe(1000)
    expect(kolom('meeneem')).toMatch(/^\s*meeneem\s+text\b/)
    expect(kolom('meeneem')).not.toMatch(/not null/)
    expect(kolom('meeneem')).toContain(`check (meeneem is null or char_length(meeneem) <= ${ZELFREVIEW_MEENEEM_MAX})`)
  })

  it('unique (event_id, user_id) en index (team_id, user_id)', () => {
    expect(tabel).toMatch(/constraint trainer_zelfreviews_event_user_key unique \(event_id, user_id\)/)
    expect(sql).toMatch(
      /create index if not exists idx_trainer_zelfreviews_team_user on public\.trainer_zelfreviews\(team_id, user_id\);/,
    )
  })

  it('drie FK-cascades: teams, events en het lidmaatschap (team_id, user_id) → team_members; geen FK naar auth.users', () => {
    expect(kolom('team_id')).toMatch(/uuid not null references public\.teams\(id\)\s+on delete cascade/)
    expect(kolom('event_id')).toMatch(/uuid not null references public\.events\(id\)\s+on delete cascade/)
    expect(kolom('user_id')).toMatch(/^\s*user_id\s+uuid not null,$/)
    expect(tabel.replace(/\s+/g, ' ')).toMatch(
      /foreign key \(team_id, user_id\) references public\.team_members\(team_id, user_id\) on delete cascade/,
    )
    expect(sql).not.toMatch(/auth\.users/)
    expect(tabel.match(/on delete cascade/g)).toHaveLength(3)
  })

  it('created_at en updated_at timestamptz not null default now() (UTC)', () => {
    expect(kolom('created_at')).toMatch(/timestamptz not null default now\(\)/)
    expect(kolom('updated_at')).toMatch(/timestamptz not null default now\(\)/)
  })

  it('geen speler-kolom en geen verwijzing naar training_evaluaties (AC9)', () => {
    expect(sql).not.toMatch(/player_id/)
    expect(sql).not.toMatch(/training_evaluaties/)
  })
})

describe('trainer-zelfreview.sql — policies (privé per trainer)', () => {
  it('RLS aan; precies select, insert en update, elk eerst gedropt (idempotent); GEEN delete-policy', () => {
    expect(sql).toMatch(/alter table public\.trainer_zelfreviews enable row level security;/)
    expect(policies().map((p) => p.cmd)).toEqual(['select', 'insert', 'update'])
    for (const p of policies()) expect(sql).toContain(`drop policy if exists "${p.naam}"`)
    expect([...sql.matchAll(/create policy/g)]).toHaveLength(3)
    expect(sql).not.toMatch(/for delete|for all/)
  })

  it('select = alleen de eigen rij (user_id = auth.uid()) en lid van het team; geen recht nodig (V5)', () => {
    expect(policy('select').tekst).toMatch(/using \(user_id = auth\.uid\(\) and is_team_member\(team_id\)\)/)
    expect(policy('select').tekst).not.toMatch(/can_edit/)
  })

  it('insert én update with check: eigen user_id, recht training, training van hetzelfde team, niet in de toekomst (NL)', () => {
    const insert = policy('insert').tekst
    const update = policy('update').tekst
    const updateCheck = update.slice(update.indexOf('with check'))
    expect(insert).toMatch(/with check \(/)
    expect(updateCheck.length).toBeGreaterThan(10)
    for (const re of SCHRIJFCHECK) {
      expect(insert, `insert ${re}`).toMatch(re)
      expect(updateCheck, `update with check ${re}`).toMatch(re)
    }
    expect(update).toMatch(/using \(user_id = auth\.uid\(\) and can_edit\(team_id, 'training'\)\)/)
  })

  it("geen ander onderdeel dan 'training'", () => {
    expect([...sql.matchAll(/can_edit\(team_id, '(\w+)'\)/g)].map((m) => m[1]).every((o) => o === 'training')).toBe(true)
    expect(sql).not.toMatch(/'aanwezigheid'|'spelers'|'wedstrijd'|'agenda'/)
  })
})

describe('trainer-zelfreview.sql — RPC', () => {
  it('precies één functie met de exacte signatuur en returns table (zonder meeneem)', () => {
    expect(functies().map((f) => [f.naam, f.args])).toEqual([[RPC, ARGS]])
    expect(functie(RPC).kop.replace(/\s+/g, ' ')).toMatch(
      /returns table \(event_id uuid, datum date, score_uitleg int, score_organisatie int, score_coaching int, score_sfeer int, score_tijdsbewaking int, totaal int\)/,
    )
    expect(functie(RPC).body).not.toMatch(/meeneem/)
  })

  it('security invoker, stable, search_path public, is_team_member(p_team_id); nergens security definer', () => {
    const f = functie(RPC)
    expect(f.kop).toMatch(/language sql stable security invoker set search_path = public/)
    expect(f.body).toMatch(/where is_team_member\(p_team_id\)/)
    expect(sql).not.toMatch(/security definer/i)
  })

  it('alleen de eigen zelfreviews: z.user_id = auth.uid() in de where', () => {
    expect(hoofdWhere(functie(RPC).body)).toMatch(/z\.user_id = auth\.uid\(\)/)
  })

  it('alleen de verwachte bronnen, elk met alias en <alias>.team_id = p_team_id in het eigen segment', () => {
    const body = functie(RPC).body
    const lijst = bronnen(body)
    for (const { doel, alias } of lijst) {
      expect(TEAM_TABELLEN_SQL.has(doel), `onbekend from/join-doel ${doel}`).toBe(true)
      expect(alias !== undefined && !SQL_KEYWORDS.has(alias.toLowerCase()), `${doel} zonder alias`).toBe(true)
    }
    expect(lijst.map((b) => `${b.doel} ${b.alias}`).sort()).toEqual(['events e', 'trainer_zelfreviews z'])
    for (const bron of lijst) expect(segment(body, bron), `${bron.doel} ${bron.alias}`).toMatch(teamFilter(bron.alias!))
  })

  it('alleen trainingen, venster inclusief, deterministische volgorde', () => {
    const body = functie(RPC).body
    expect(hoofdWhere(body)).toMatch(/e\.type = 'training'/)
    expect(body).toMatch(/e\.date >= p_start and e\.date <= p_end/)
    expect(body).toMatch(/order by e\.date, e\.id/)
  })

  it('limit 901 = MAX_FASE3_RIJEN + 1 en totaal = count(*) over ()', () => {
    expect(MAX_FASE3_RIJEN + 1).toBe(901)
    expect(functie(RPC).body).toMatch(new RegExp(`\\blimit ${MAX_FASE3_RIJEN + 1};\\s*$`))
    expect(functie(RPC).body).toMatch(/\(count\(\*\) over \(\)\)::int/)
    expect(sql.match(/\blimit\s+\d+/g)).toEqual(['limit 901'])
  })

  it('revoke voor public/anon, grant aan authenticated, begin/commit en schema-reload', () => {
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${RPC}\\(${TYPEN}\\) from public, anon;`))
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${RPC}\\(${TYPEN}\\) to authenticated;`))
    expect(sql).toMatch(/^begin;/m)
    expect(sql).toMatch(/^commit;/m)
    expect(sql).toMatch(/notify pgrst, 'reload schema';/)
  })
})

describe('TEAM_TABELLEN — trainer_zelfreviews bewust NIET (privé, cascade)', () => {
  it('staat niet in TEAM_TABELLEN en het waarom staat bij de constante', () => {
    expect(TEAM_TABELLEN as readonly string[]).not.toContain(TABEL)
    const bron = readFileSync(path.resolve(__dirname, 'lib', 'team-opruimen.ts'), 'utf8')
    expect(bron).toMatch(/`trainer_zelfreviews` staat hier BEWUST OOK NIET in/)
  })
})

describe('team-rls-verificatie.sql — blok 2, 22 en 31', () => {
  const rollback = verificatie.search(/^rollback;/m)
  const start = verificatie.indexOf('-- ── Blok 31')
  const blok31 = verificatie.slice(start, rollback)
  const blok22 = verificatie.slice(verificatie.indexOf('-- ── Blok 22'), verificatie.indexOf('-- ── Blok 23'))

  it('blok 2 controleert trainer_zelfreviews van een vreemd team', () => {
    const blok2 = verificatie.slice(verificatie.indexOf('-- ── Blok 2:'), verificatie.indexOf('-- ── Blok 3:'))
    expect(blok2).toMatch(/select count\(\*\) into n from trainer_zelfreviews where team_id = 'TEAM_B_UUID';/)
    expect(blok2).toContain('LEK: niet-lid ziet trainer-zelfreviews van een vreemd team')
  })

  it('blok 22: zelfreview van de assistent in het wegwerpteam, onzichtbaar voor de owner, weg na delete teams; NIET in de lussen', () => {
    expect(blok22).toMatch(/insert into trainer_zelfreviews \(team_id, user_id, event_id/)
    expect(blok22).toContain("values (v_team, 'ASSISTENT_A_UUID', v_event, 4, 4, 4, 4, 4);")
    expect(blok22).toContain('LEK: de hoofdtrainer ziet % zelfreview(s) van zijn assistent')
    expect(blok22).toContain('KAPOT: na deleteTeam staan er nog % zelfreview(s)')
    expect(blok22.indexOf('KAPOT: na deleteTeam staan er nog % zelfreview(s)')).toBeGreaterThan(
      blok22.indexOf('delete from teams where id = v_team;'),
    )
    const lussen = [...blok22.matchAll(/foreach v_tabel in array array\[([^\]]+)\]/g)].map((m) => m[1])
    for (const l of lussen) expect(l).not.toContain(TABEL)
  })

  it('blok 31 staat na blok 30, is het laatste blok en staat vóór de rollback', () => {
    expect(start).toBeGreaterThan(verificatie.indexOf('-- ── Blok 30'))
    expect(start).toBeLessThan(rollback)
    expect(blok31.match(/^do \$\$/gm)).toHaveLength(1)
  })

  it('kop en voet noemen blok 31', () => {
    const kop = verificatie.slice(0, verificatie.indexOf('begin;'))
    expect(kop).toMatch(/\* blok 31\s+— vereist supabase\/trainer-zelfreview\.sql/)
    expect(kop.replace(/\n--\s*/g, ' ')).toMatch(/noemen ook blok 2 en blok 22 de tabel trainer_zelfreviews/)
    expect(verificatie.slice(rollback)).toMatch(/trainer-zelfreview \(tabel trainer_zelfreviews \+ 1 RPC\) in blok 31/)
  })

  it('testdata in mei 1990 met eerst de migratie- en opzetcheck', () => {
    expect(blok31).toMatch(/v_start date := date '1990-05-01'/)
    expect(blok31).toContain('TRAINER-ZELFREVIEW ONTBREEKT')
    expect(blok31).toMatch(/to_regclass\('public\.trainer_zelfreviews'\)/)
    expect(blok31).toMatch(new RegExp(`to_regprocedure\\('public\\.${RPC}\\(${TYPEN}\\)'\\)`))
    expect(blok31).toContain('FOUT IN DE OPZET: TEAM_A heeft al events in mei 1990')
    expect(blok31.indexOf('FOUT IN DE OPZET: TEAM_A heeft al events')).toBeLessThan(blok31.indexOf('insert into events'))
    expect(blok31).toMatch(/v_vandaag date := \(now\(\) at time zone 'Europe\/Amsterdam'\)::date/)
  })

  it('dekt (a)–(j) met de LEK- en KAPOT-meldingen', () => {
    for (const tekst of [
      'LEK: een assistent ziet % zelfreview(s) van de hoofdtrainer', // a
      'LEK: de hoofdtrainer ziet % zelfreview(s) van zijn assistent', // a
      'LEK: OWNER_A ziet % zelfreview(s) van TEAM_B', // a
      'LEK: de hoofdtrainer kon de zelfreview van zijn assistent wijzigen', // a
      'LEK: een assistent zonder trainingsrecht kon een zelfreview maken', // b
      'LEK: een assistent zonder trainingsrecht kon zijn zelfreview wijzigen', // b
      'KAPOT (V5): een assistent zonder trainingsrecht ziet zijn eigen zelfreview niet meer', // b
      'LEK: een niet-lid krijgt % rijen uit inzichten_eigen_zelfreviews(TEAM_A)', // c
      'LEK: een niet-lid kon een zelfreview in TEAM_A maken', // c
      'LEK: OWNER_A kon een zelfreview op naam van zijn assistent maken', // d
      'LEK: OWNER_A kon zijn eigen zelfreview op naam van zijn assistent zetten', // d
      'LEK: een zelfreview kon aan een training van morgen gehangen worden', // e
      'LEK: een zelfreview kon aan een wedstrijd gehangen worden', // e
      'LEK: OWNER_A kon een zelfreview aan een training van TEAM_B hangen', // e
      'LEK: OWNER_A kon een zelfreview in TEAM_B maken', // e
      'KAPOT: score 0 werd geaccepteerd', // f
      'KAPOT: score 6 werd geaccepteerd', // f
      'KAPOT: een tekst van 1001 tekens werd geaccepteerd', // f
      'KAPOT: een tweede zelfreview van dezelfde trainer op dezelfde training werd geaccepteerd', // g
      'KAPOT: een zelfreview kon verwijderd worden', // g
      `LEK: ${RPC} geeft % rijen van TEAM_B`, // h
      'LEK: de RPC geeft OWNER_A de scores van zijn assistent', // h
      'LEK: de RPC geeft ASSISTENT_A de scores van de hoofdtrainer', // h
      'KAPOT: na het verwijderen van de training staan er nog % zelfreviews', // i
      'KAPOT: na het verwijderen van het lidmaatschap staan er nog % zelfreviews van de assistent', // i
      `LEK: anon mag ${RPC} uitvoeren`, // j
      'KAPOT: trainer_zelfreviews heeft een delete-policy', // j
    ]) {
      expect(blok31, tekst).toContain(tekst)
    }
    expect(blok31).toMatch(/v_vandaag \+ 1/)
    expect(blok31).toMatch(/repeat\('x', 1001\)/)
    expect(blok31).toMatch(/on conflict \(event_id, user_id\) do update/)
    expect(blok31).toMatch(/set mag_training_bewerken = false/)
    expect(blok31).toMatch(/delete from team_members where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID'/)
    expect(blok31).toMatch(new RegExp(`has_function_privilege\\('anon', 'public\\.${RPC}\\(${TYPEN}\\)', 'execute'\\)`))
    expect(blok31).toMatch(/p\.provolatile = 's' and not p\.prosecdef/)
    expect(blok31).toContain('BUITENSTAANDER_UUID')
  })

  it("vangt RLS op sqlstate '42501' en CHECKs op sqlstate '23514' zonder de getelde patronen van blok 28 en 30", () => {
    // Blok 28 telt `exception when check_violation then` en blok 30 telt
    // `exception when insufficient_privilege then` en
    // `exception when sqlstate '23514' then` in hun stuk tot de rollback —
    // dat stuk omvat blok 31. Die drie regels mogen hier dus niet voorkomen.
    expect(blok31).not.toMatch(/check_violation/)
    expect(blok31).not.toMatch(/exception when insufficient_privilege then/)
    expect(blok31).not.toMatch(/exception when sqlstate '23514' then/)
    expect((blok31.match(/exception when sqlstate '42501' then/g) ?? []).length).toBe(9)
    expect((blok31.match(/exception\s*\n\s*when sqlstate '23514' then/g) ?? []).length).toBe(3)
  })
})

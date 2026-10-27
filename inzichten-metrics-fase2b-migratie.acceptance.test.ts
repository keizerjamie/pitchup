// Structuurtest op supabase/inzichten-metrics-fase2b.sql (tabel speelminuten +
// lees-RPC) en de bijbehorende blokken 2 en 28 in
// supabase/team-rls-verificatie.sql.
//
// Vitest praat nooit met Postgres: deze test leest de SQL als TEKST en legt de
// tenant-isolatie-, noemer- en grensregels vast (zelfde aanpak als
// inzichten-metrics-fase2-migratie.acceptance.test.ts). Het gedrag zelf
// bewijst alleen blok 28 in de SQL Editor.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { MAX_WISSELS, isValidSpeelminuten, isValidWissels } from '@/lib/match-analysis.mjs'

const RPC = 'inzichten_speelminuten_per_speler'
const ARGS = 'p_team_id uuid, p_start date, p_end date'
const TYPEN = 'uuid, date, date'

// De echte tabellen die de RPC mag lezen; elke andere from/join moet een CTE
// uit dezelfde functie zijn.
const ECHTE_TABELLEN = new Set(['speelminuten', 'events', 'players'])
const SQL_KEYWORDS = new Set(['where', 'on', 'left', 'right', 'inner', 'cross', 'join', 'group', 'order', 'as'])

const ruw = readFileSync(path.resolve(__dirname, 'supabase', 'inzichten-metrics-fase2b.sql'), 'utf8')
// Alleen de uitvoerbare SQL: commentaar eruit, zodat een toelichting nooit een
// ontbrekende regel kan "dekken".
const sql = ruw.replace(/--[^\n]*/g, '')

const verificatie = readFileSync(path.resolve(__dirname, 'supabase', 'team-rls-verificatie.sql'), 'utf8')

function functies(): { naam: string; kop: string; body: string }[] {
  const re = /create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)as \$\$([\s\S]*?)\$\$;/g
  return [...sql.matchAll(re)].map((m) => ({ naam: m[1], kop: m[3], body: m[4] }))
}

const body = () => functies()[0].body

// CTE-namen met hun startpositie (`with naam as (` of `), naam as (`).
function ctes(b: string): { naam: string; index: number }[] {
  return [...b.matchAll(/(?:\bwith|\),)\s*(\w+)\s+as\s*\(/g)].map((m) => ({ naam: m[1], index: m.index! }))
}

// Alle from/join-doelen. `is distinct from` is geen from-clausule.
function bronnen(b: string): { doel: string; alias: string | undefined; index: number }[] {
  const re = /(?<!\bdistinct\s+)\b(?:from|join)\s+(?:public\.)?(\w+)(?:\s+(\w+))?/g
  return [...b.matchAll(re)].map((m) => ({ doel: m[1], alias: m[2], index: m.index! }))
}

// Vanaf de from/join tot de start van de volgende CTE (of het einde van de
// functie): zo telt een teamfilter uit een ándere CTE niet mee.
function bereik(b: string, index: number): string {
  const volgende = ctes(b).map((c) => c.index).filter((i) => i > index)
  return b.slice(index, volgende.length ? Math.min(...volgende) : b.length)
}

function policies(): string[] {
  return sql.match(/create policy[\s\S]*?;/g) ?? []
}

function policy(naam: string): string {
  const p = policies().find((x) => x.includes(`"speelminuten: ${naam}"`))
  if (!p) throw new Error(`policy ${naam} niet gevonden`)
  return p
}

// Het deel van een policy na `with check (`: daar moet de event- én spelercheck staan.
function withCheck(p: string): string {
  const i = p.indexOf('with check')
  expect(i, 'with check').toBeGreaterThan(-1)
  return p.slice(i)
}

describe('inzichten-metrics-fase2b.sql — tabel speelminuten', () => {
  it('maakt de tabel met FK\'s met cascade naar teams, events en players', () => {
    expect(sql).toMatch(/create table if not exists public\.speelminuten \(/)
    expect(sql).toMatch(/team_id\s+uuid not null references public\.teams\(id\)\s+on delete cascade/)
    expect(sql).toMatch(/event_id\s+uuid not null references public\.events\(id\)\s+on delete cascade/)
    expect(sql).toMatch(/player_id\s+uuid not null references public\.players\(id\)\s+on delete cascade/)
    expect(sql).toMatch(/created_at timestamptz not null default now\(\)/)
  })

  it('minuten 0..130 en wissels 0..99, beide verplicht; één rij per (event, speler)', () => {
    expect(sql).toMatch(/minuten\s+smallint not null constraint speelminuten_minuten_check check \(minuten between 0 and 130\)/)
    expect(sql).toMatch(/wissels\s+smallint not null constraint speelminuten_wissels_check check \(wissels between 0 and 99\)/)
    expect(sql).toMatch(/unique \(event_id, player_id\)/)
  })

  it('de SQL-grenzen zijn gebonden aan de app-validatie (lib/match-analysis.mjs)', () => {
    expect(MAX_WISSELS).toBe(99)
    expect(isValidWissels(99) && !isValidWissels(100)).toBe(true)
    expect(isValidSpeelminuten(130) && !isValidSpeelminuten(131)).toBe(true)
    expect(isValidSpeelminuten(0) && !isValidSpeelminuten(-1) && isValidWissels(0) && !isValidWissels(-1)).toBe(true)
  })

  it('indexen op team_id en player_id, en RLS staat aan', () => {
    expect(sql).toMatch(/create index if not exists idx_speelminuten_team\s+on public\.speelminuten\(team_id\);/)
    expect(sql).toMatch(/create index if not exists idx_speelminuten_player on public\.speelminuten\(player_id\);/)
    expect(sql).toMatch(/alter table public\.speelminuten enable row level security;/)
  })

  it('raakt geen andere tabel of policy', () => {
    expect([...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])).toEqual(['speelminuten'])
    expect([...sql.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1])).toEqual(['speelminuten'])
    for (const p of policies()) expect(p).toMatch(/on public\.speelminuten/)
  })
})

describe('inzichten-metrics-fase2b.sql — RLS-policies', () => {
  it('precies vier policies: select, insert, update en delete', () => {
    expect(policies()).toHaveLength(4)
    expect(policy('lid mag lezen')).toMatch(/for select using \(is_team_member\(team_id\)\)/)
    expect(policy('recht mag maken')).toMatch(/for insert with check \(/)
    expect(policy('recht mag wijzigen')).toMatch(/for update using \(can_edit\(team_id, 'wedstrijd'\)\)\s+with check \(/)
    expect(policy('recht mag wissen')).toMatch(/for delete using \(can_edit\(team_id, 'wedstrijd'\)\);/)
  })

  it('elke policy wordt eerst gedropt (idempotent)', () => {
    for (const naam of ['lid mag lezen', 'recht mag maken', 'recht mag wijzigen', 'recht mag wissen']) {
      expect(sql).toMatch(new RegExp(`drop policy if exists "speelminuten: ${naam}"\\s+on public\\.speelminuten;`))
    }
  })

  it.each(['recht mag maken', 'recht mag wijzigen'])(
    '"%s": with check eist recht, een WEDSTRIJD van hetzelfde team én een speler van hetzelfde team',
    (naam) => {
      const check = withCheck(policy(naam))
      expect(check).toMatch(/can_edit\(team_id, 'wedstrijd'\)/)
      expect(check).toMatch(/from public\.events e\s+where e\.id = speelminuten\.event_id/)
      expect(check).toMatch(/\be\.team_id = speelminuten\.team_id\b/)
      expect(check).toMatch(/\be\.type = 'match'/)
      expect(check).toMatch(/from public\.players p\s+where p\.id = speelminuten\.player_id/)
      expect(check).toMatch(/\bp\.team_id = speelminuten\.team_id\b/)
    },
  )

  it('delete heeft BEWUST geen event- of spelercheck: opruimen moet altijd kunnen (O2)', () => {
    expect(policy('recht mag wissen')).not.toMatch(/exists/)
  })
})

describe('inzichten-metrics-fase2b.sql — RPC-vorm', () => {
  it('definieert precies één functie met de exacte signatuur en returnvorm', () => {
    const gevonden = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)]
      .map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()])
    expect(gevonden).toEqual([[RPC, ARGS]])
    expect(functies()).toHaveLength(1)
    expect(functies()[0].kop).toMatch(
      /returns table \(player_id uuid, naam text, gast boolean, wedstrijden int, minuten int, wissels int, noemer int\)/,
    )
  })

  it('security invoker, set search_path = public en is_team_member(p_team_id); nergens security definer', () => {
    const [f] = functies()
    expect(f.kop).toMatch(/language sql stable security invoker set search_path = public/)
    expect(f.body).toMatch(/where is_team_member\(p_team_id\)/)
    expect(sql).not.toMatch(/security definer/i)
  })

  it('elke alias op speelminuten/events/players heeft <alias>.team_id = p_team_id in hetzelfde stuk SQL', () => {
    const echte = bronnen(body()).filter((b) => ECHTE_TABELLEN.has(b.doel))
    expect(echte.map((b) => `${b.doel} ${b.alias}`).sort()).toEqual(['events e', 'players p', 'players pl', 'speelminuten sm'])
    for (const { doel, alias, index } of echte) {
      expect(alias !== undefined && !SQL_KEYWORDS.has(alias.toLowerCase()), `${doel} zonder alias`).toBe(true)
      expect(bereik(body(), index), `${doel} ${alias} zonder ${alias}.team_id = p_team_id`)
        .toMatch(new RegExp(`\\b${alias}\\.team_id\\s*=\\s*p_team_id\\b`))
    }
  })

  it('elk ander from/join-doel is een CTE uit dezelfde functie', () => {
    const cteNamen = new Set(ctes(body()).map((c) => c.naam))
    for (const { doel } of bronnen(body())) {
      if (ECHTE_TABELLEN.has(doel)) continue
      expect(cteNamen.has(doel), `onbekend from/join-doel ${doel}`).toBe(true)
    }
  })

  it('geen limit: hooguit één rij per speler, er kan niets stil worden afgekapt (AC-K.7)', () => {
    expect(sql).not.toMatch(/\blimit\b/i)
  })

  it('revoke voor public/anon, grant aan authenticated, en een schema-reload', () => {
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${RPC}\\(${TYPEN}\\) from public, anon;`))
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${RPC}\\(${TYPEN}\\) to authenticated;`))
    expect(sql).toMatch(/notify pgrst, 'reload schema';/)
  })
})

describe('inzichten_speelminuten_per_speler — noemer, venster en spelers (M3, M4, AC-K.4)', () => {
  it('alleen wedstrijden binnen het venster', () => {
    const rijen = bereik(body(), body().indexOf('from speelminuten sm'))
    expect(rijen).toMatch(/\be\.type = 'match'/)
    expect(rijen).toMatch(/e\.date >= p_start and e\.date <= p_end/)
  })

  it('noemer = verschillende wedstrijden MET een rij; geen rijen bij noemer 0 (AC-K.9)', () => {
    expect(body()).toMatch(/count\(distinct r\.event_id\)::int as n from rijen r/)
    expect(body()).toMatch(/\bnm\.n > 0\b/)
  })

  it('per speler: aantal wedstrijden, som minuten en som wissels', () => {
    expect(body()).toMatch(/count\(\*\)::int as wedstrijden, sum\(r\.minuten\)::int as minuten, sum\(r\.wissels\)::int as wissels/)
    expect(body()).toMatch(/group by r\.player_id/)
    expect(body()).toMatch(/coalesce\(ps\.wedstrijden, 0\), ps\.minuten, ps\.wissels, nm\.n/)
  })

  it('spelers met een rij altijd (ook gast/inactief), zonder rij alleen actieve vaste spelers', () => {
    expect(body()).toMatch(/\(ps\.player_id is not null or \(p\.active is distinct from false and p\.type = 'regular'\)\)/)
    expect(body()).toMatch(/\(p\.type = 'guest'\)/)
    expect(body()).toMatch(/order by p\.name, p\.id/)
  })
})

describe('team-rls-verificatie.sql — blok 2, 22 en 28', () => {
  const rollback = verificatie.search(/^rollback;/m)
  const start = verificatie.indexOf('-- ── Blok 28')
  const blok28 = verificatie.slice(start, rollback)

  it('blok 2 controleert dat een niet-lid geen speelminuten van een vreemd team ziet', () => {
    const blok2 = verificatie.slice(verificatie.indexOf('-- ── Blok 2:'), verificatie.indexOf('-- ── Blok 3'))
    expect(blok2).toMatch(/select count\(\*\) into n from speelminuten\s+where team_id = 'TEAM_B_UUID';/)
    expect(blok2).toContain('LEK: niet-lid ziet speelminuten van een vreemd team')
  })

  it('beide lussen in blok 22 noemen speelminuten', () => {
    const blok22 = verificatie.slice(verificatie.indexOf('-- ── Blok 22'), verificatie.indexOf('-- ── Blok 23'))
    const lussen = [...blok22.matchAll(/foreach v_tabel in array array\[([^\]]+)\]/g)].map((m) => m[1])
    expect(lussen.filter((l) => l.includes("'speelminuten'"))).toHaveLength(2)
  })

  it('blok 28 staat na blok 27 en vóór de rollback', () => {
    expect(start).toBeGreaterThan(verificatie.indexOf('-- ── Blok 27'))
    expect(start).toBeLessThan(rollback)
  })

  it('blok 28 gebruikt testdata in januari 1990 en controleert eerst op echte speelminuten', () => {
    expect(blok28).toMatch(/v_start date := date '1990-01-01'/)
    expect(blok28).toContain('FOUT IN DE OPZET: TEAM_A heeft al speelminuten in januari 1990')
  })

  it('blok 28 dekt lezen, RPC, rechten, vreemde ids, CHECKs, uniciteit, updates, cascade en anon', () => {
    expect(blok28).toContain('LEK: OWNER_A ziet % speelminuten van TEAM_B')
    expect(blok28).toContain(`from ${RPC}('TEAM_B_UUID'`)
    expect(blok28).toContain(`LEK: ${RPC} geeft % rijen van TEAM_B`)
    expect(blok28).toMatch(/r\.wedstrijden <> 2 or r\.minuten <> 135 or r\.wissels <> 3 or r\.noemer <> 2/)
    expect(blok28).toContain('KAPOT: een inactieve speler zonder rij staat in de RPC')
    expect(blok28).toContain('LEK: een assistent zonder wedstrijdrecht kon speelminuten vastleggen')
    expect(blok28).toContain('LEK: een assistent zonder wedstrijdrecht kon speelminuten wijzigen')
    expect(blok28).toContain('LEK: een assistent zonder wedstrijdrecht kon speelminuten verwijderen')
    expect(blok28).toContain('LEK: OWNER_A kon speelminuten aan een wedstrijd van TEAM_B hangen')
    expect(blok28).toContain('LEK: OWNER_A kon speelminuten voor een speler van TEAM_B vastleggen')
    expect(blok28).toContain('LEK: speelminuten konden aan een training gehangen worden')
    expect((blok28.match(/exception when check_violation then/g) ?? []).length).toBe(4)
    expect(blok28).toMatch(/exception when unique_violation then/)
    expect(blok28).toMatch(/on conflict \(event_id, player_id\) do update set minuten = excluded\.minuten, wissels = excluded\.wissels;/)
    expect(blok28).toContain('LEK: een update kon speelminuten naar een wedstrijd van TEAM_B verplaatsen')
    expect(blok28).toContain('LEK: een update kon speelminuten aan een speler van TEAM_B hangen')
    expect(blok28).toMatch(/delete from players where id = v_inactief_met;/)
    expect(blok28).toMatch(/delete from events where id = v_m1;/)
    expect(blok28).toMatch(new RegExp(`has_function_privilege\\('anon', 'public\\.${RPC}\\(${TYPEN}\\)', 'execute'\\)`))
  })
})

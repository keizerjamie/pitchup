// Structuurtest op supabase/inzichten-inactieve-spelers.sql: create or replace
// van inzichten_aanwezigheid en inzichten_training_opkomst_per_maand met
// `and p.active = true` erbij, plus de waarschuwingen in de twee oudere
// bestanden die deze functies terug zouden zetten (blessure-status.sql en
// inzichten-team-id.sql).
//
// Vitest praat nooit met Postgres: deze test leest de SQL als TEKST (zelfde
// aanpak als inzichten-metrics-fase3b-migratie.acceptance.test.ts). Het gedrag
// zelf bewijzen alleen de VÓÓR/NÁ-controles in het SQL-bestand.

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const ARGS = 'p_team_id uuid, p_start date, p_end date'
const AANWEZIGHEID = 'inzichten_aanwezigheid'
const MAAND = 'inzichten_training_opkomst_per_maand'
const NAMEN = [AANWEZIGHEID, MAAND]

const lees = (bestand: string) => readFileSync(path.resolve(__dirname, 'supabase', bestand), 'utf8')
// Alleen de uitvoerbare SQL: commentaar eruit, zodat een toelichting nooit een
// ontbrekende regel kan "dekken".
const zonderCommentaar = (s: string) => s.replace(/--[^\n]*/g, '')

const ruw = lees('inzichten-inactieve-spelers.sql')
const sql = zonderCommentaar(ruw)
const blessureRuw = lees('blessure-status.sql')
const blessureSql = zonderCommentaar(blessureRuw)
const teamIdRuw = lees('inzichten-team-id.sql')

type Functie = { naam: string; args: string; kop: string; body: string }

function functies(bron: string): Functie[] {
  const re = /create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)as \$\$([\s\S]*?)\$\$;/g
  return [...bron.matchAll(re)].map((m) => ({ naam: m[1], args: m[2].replace(/\s+/g, ' ').trim(), kop: m[3], body: m[4] }))
}

function functie(naam: string, bron = sql): Functie {
  const f = functies(bron).find((x) => x.naam === naam)
  if (!f) throw new Error(`functie ${naam} niet gevonden`)
  return f
}

const aantal = (s: string, re: RegExp) => [...s.matchAll(re)].length
const plat = (s: string) => s.replace(/\s+/g, '')
const ACTIVE_REGEL = /\n\s*and p\.active = true[ \t]*(?=\n)/

describe('inzichten-inactieve-spelers.sql — functies', () => {
  it('1. precies twee create or replace function, met de exacte namen en signatuur', () => {
    expect(aantal(sql, /create or replace function/g)).toBe(2)
    expect(functies(sql).map((f) => [f.naam, f.args])).toEqual([
      [AANWEZIGHEID, ARGS],
      [MAAND, ARGS],
    ])
    expect(aantal(sql, /\bfunction\b/g)).toBe(2)
  })

  it('2. exacte returns table', () => {
    expect(functie(AANWEZIGHEID).kop.replace(/\s+/g, ' ').trim()).toMatch(/^returns table \(aanwezig int, afwezig int\)/)
    expect(functie(MAAND).kop.replace(/\s+/g, ' ').trim()).toMatch(/^returns table \(maand text, aanwezig int, afwezig int\)/)
  })

  it('3. language sql stable security invoker set search_path = public; nergens security definer', () => {
    for (const naam of NAMEN) {
      expect(functie(naam).kop).toMatch(/language sql stable security invoker set search_path = public/)
    }
    expect(ruw).not.toMatch(/security definer/i)
  })

  it('4. is_team_member(p_team_id), bronnen attendance a / events e / players p, elk met <alias>.team_id = p_team_id', () => {
    for (const naam of NAMEN) {
      const body = functie(naam).body
      expect(body).toMatch(/where is_team_member\(p_team_id\)/)
      const bronnen = [...body.matchAll(/\b(from|join)\s+(?:public\.)?(\w+)\s+(\w+)/g)].map((m) => `${m[2]} ${m[3]}`)
      expect(bronnen).toEqual(['attendance a', 'events e', 'players p'])
      for (const alias of ['a', 'e', 'p']) {
        expect(body, `${naam}: ${alias}.team_id`).toMatch(new RegExp(`\\b${alias}\\.team_id = p_team_id\\b`))
      }
    }
  })

  it('5. per functie precies één p.active = true en één p.type = \'regular\'; geen kale active of e.active', () => {
    for (const naam of NAMEN) {
      const body = functie(naam).body
      expect(aantal(body, /\bp\.active = true\b/g), naam).toBe(1)
      expect(aantal(body, /\bp\.type = 'regular'/g), naam).toBe(1)
    }
    expect(aantal(sql, /\bp\.active\b/g)).toBe(2)
    // Elke `active` in de uitvoerbare SQL hoort bij alias p.
    expect(aantal(sql, /\bactive\b/g)).toBe(2)
    expect(sql).not.toMatch(/(?<!\bp\.)\bactive\b/)
    expect(sql).not.toMatch(/\be\.active\b/)
  })

  it('6. afwezig-filter, event-type, datumgrenzen en group/order by', () => {
    for (const naam of NAMEN) {
      const body = functie(naam).body
      expect(body).toMatch(/count\(\*\) filter \(where a\.status = 'present'\)::int/)
      expect(body).toMatch(/count\(\*\) filter \(where a\.status in \('absent', 'injured'\)\)::int/)
      expect(body).toMatch(/\band e\.date >= p_start\b/)
      expect(body).toMatch(/\band e\.date <= p_end\b/)
    }
    const aanwezig = functie(AANWEZIGHEID).body
    expect(aanwezig).toMatch(/\band e\.type <> 'meting'/)
    expect(aanwezig).not.toMatch(/e\.type = 'training'/)
    expect(aanwezig).not.toMatch(/group by|order by/)

    const maand = functie(MAAND).body
    expect(maand).toMatch(/\band e\.type = 'training'/)
    expect(maand).not.toMatch(/'meting'/)
    expect(maand).toMatch(/to_char\(e\.date, 'YYYY-MM'\) as maand/)
    expect(maand).toMatch(/group by 1\s+order by 1;?\s*$/)
  })

  it('7. geen drop function/grant/revoke; wel begin, commit en notify pgrst', () => {
    expect(sql).not.toMatch(/\bdrop\s+function\b/i)
    expect(sql).not.toMatch(/\bgrant\b/i)
    expect(sql).not.toMatch(/\brevoke\b/i)
    expect(sql).toMatch(/^begin;$/m)
    expect(sql).toMatch(/^commit;$/m)
    expect(sql).toMatch(/^notify pgrst, 'reload schema';$/m)
    expect(sql.indexOf('begin;')).toBeLessThan(sql.indexOf('create or replace function'))
    expect(sql.lastIndexOf('commit;')).toBeGreaterThan(sql.lastIndexOf('$$;'))
    expect(sql.indexOf("notify pgrst, 'reload schema';")).toBeGreaterThan(sql.lastIndexOf('commit;'))
  })

  it('8. body-pariteit met blessure-status.sql: identiek op de regel and p.active = true na', () => {
    for (const naam of NAMEN) {
      const nieuw = functie(naam)
      const oud = functie(naam, blessureSql)
      expect(nieuw.args).toBe(oud.args)
      expect(plat(nieuw.kop)).toBe(plat(oud.kop))
      // De bron blessure-status.sql heeft (bewust) geen active-filter in deze twee.
      expect(oud.body).not.toMatch(/\bactive\b/)
      expect(nieuw.body).toMatch(ACTIVE_REGEL)
      expect(plat(nieuw.body.replace(ACTIVE_REGEL, ''))).toBe(plat(oud.body))
      // Op dezelfde plek als in inzichten_aanwezigheid_per_speler: direct na
      // het team-filter op players.
      expect(nieuw.body).toMatch(/and p\.team_id = p_team_id\s*\n\s*and p\.active = true\s*\n\s*and p\.type = 'regular'/)
    }
  })
})

describe('waarschuwingen tegen stil terugzetten', () => {
  it('9a. de kop van blessure-status.sql noemt inzichten-inactieve-spelers.sql', () => {
    const kop = blessureRuw.slice(0, blessureRuw.search(/^begin;$/m))
    expect(kop).toMatch(/supabase\/inzichten-inactieve-spelers\.sql/)
  })

  it('9b. de herstelinstructie in inzichten-team-id.sql noemt inzichten-inactieve-spelers.sql', () => {
    const kop = teamIdRuw.slice(0, teamIdRuw.search(/^begin;$/m))
    const herstel = kop.slice(kop.indexOf('Moet dit bestand toch ooit opnieuw'))
    expect(herstel).toMatch(/blessure-status\.sql nogmaals/)
    expect(herstel).toMatch(/supabase\/inzichten-inactieve-spelers\.sql/)
  })

  it('9c. de nieuwe migratie noemt beide oude bestanden onder NIET MEER DRAAIEN', () => {
    const start = ruw.indexOf('NIET MEER DRAAIEN NA DIT BESTAND')
    expect(start).toBeGreaterThan(-1)
    const blok = ruw.slice(start, ruw.indexOf('-- TENANT', start))
    expect(blok).toMatch(/supabase\/inzichten-team-id\.sql/)
    expect(blok).toMatch(/supabase\/blessure-status\.sql/)
  })
})

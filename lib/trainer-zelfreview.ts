// Pure validatie en constanten voor de privé trainer-zelfreview per training
// (tabel `trainer_zelfreviews`, supabase/trainer-zelfreview.sql).
//
// Bewust géén 'use server': dit bestand exporteert constanten en synchrone
// helpers, en wordt gedeeld door de server action
// (app/actions/trainer-zelfreview.ts), de pagina's, de componenten en de pure
// functies in lib/inzichten.ts. Zelfde rol als lib/training-evaluatie.ts.
//
// De SQL-CHECKs zijn aan deze constanten gebonden door de structuurtest
// trainer-zelfreview-migratie.acceptance.test.ts:
//   score_<stelling> between 1 and 5          = ZELFREVIEW_SCORE_MIN..MAX,
//                                               één kolom per ZELFREVIEW_STELLINGEN
//   char_length(meeneem) <= 1000              = ZELFREVIEW_MEENEEM_MAX

// De vijf vaste stellingen, in weergavevolgorde. De teksten staan in
// messages/* (event.zelfreviewStellingen); hier alleen de sleutels.
export const ZELFREVIEW_STELLINGEN = ['uitleg', 'organisatie', 'coaching', 'sfeer', 'tijdsbewaking'] as const
export type ZelfreviewStelling = (typeof ZELFREVIEW_STELLINGEN)[number]

export const ZELFREVIEW_SCORE_MIN = 1
export const ZELFREVIEW_SCORE_MAX = 5

// Maximale lengte van "Wat neem ik mee?" NA trim. Gemeten in UTF-16-eenheden
// (String.length), net als `maxLength` op een textarea; dat is nooit minder
// dan char_length() in Postgres, dus wat hier door komt haalt ook de CHECK.
export const ZELFREVIEW_MEENEEM_MAX = 1000

// Vanaf zoveel zelfreviews in het venster toont de Inzichten-kaart een trend.
export const ZELFREVIEW_TREND_MIN = 3

export type ZelfreviewScores = Record<ZelfreviewStelling, number>

// Een geldige, genormaliseerde zelfreview: vijf scores en een getrimde tekst
// of null.
export interface ZelfreviewWaarden {
  scores: ZelfreviewScores
  meeneem: string | null
}

// Geheel getal ZELFREVIEW_SCORE_MIN..MAX. Een string ('3'), decimaal, NaN of
// null valt af: de waarde gaat ongewijzigd naar een smallint-kolom.
export function isZelfreviewScore(waarde: unknown): waarde is number {
  return (
    typeof waarde === 'number' &&
    Number.isInteger(waarde) &&
    waarde >= ZELFREVIEW_SCORE_MIN &&
    waarde <= ZELFREVIEW_SCORE_MAX
  )
}

// Normaliseert het optionele tekstveld: trim, en leeg ('' of alleen witruimte)
// wordt null. null/undefined → null. Te lang (na trim) of een ander type dan
// string → undefined (= ongeldig).
export function normaliseerMeeneem(waarde: unknown): string | null | undefined {
  if (waarde === null || waarde === undefined) return null
  if (typeof waarde !== 'string') return undefined
  const tekst = waarde.trim()
  if (tekst === '') return null
  return tekst.length <= ZELFREVIEW_MEENEEM_MAX ? tekst : undefined
}

// Volledige validatie van de invoer van saveTrainerZelfreview. Exact de vijf
// sleutels van ZELFREVIEW_STELLINGEN moeten een geldige score hebben; extra
// sleutels worden genegeerd (en NIET doorgegeven). null = ongeldig.
export function valideerZelfreview(invoer: unknown): ZelfreviewWaarden | null {
  if (!invoer || typeof invoer !== 'object') return null
  const { scores, meeneem } = invoer as { scores?: unknown; meeneem?: unknown }
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return null

  const schoon = {} as ZelfreviewScores
  for (const stelling of ZELFREVIEW_STELLINGEN) {
    const score = (scores as Record<string, unknown>)[stelling]
    if (!isZelfreviewScore(score)) return null
    schoon[stelling] = score
  }

  const tekst = normaliseerMeeneem(meeneem)
  if (tekst === undefined) return null
  return { scores: schoon, meeneem: tekst }
}

// De databasekolom van een stelling: 'uitleg' → 'score_uitleg'.
export function kolomVoor<S extends ZelfreviewStelling>(stelling: S): `score_${S}` {
  return `score_${stelling}`
}

// Een gelezen rij (score_*-kolommen + meeneem) als ZelfreviewWaarden, of null
// als er geen rij is of één van de scores ongeldig is ("geen review"). De
// tekst wordt net zo genormaliseerd als bij opslaan; een onbruikbare tekst
// wordt null, de scores blijven dan staan.
export function zelfreviewUitRij(rij: unknown): ZelfreviewWaarden | null {
  if (!rij || typeof rij !== 'object') return null
  const r = rij as Record<string, unknown>
  const scores = {} as ZelfreviewScores
  for (const stelling of ZELFREVIEW_STELLINGEN) {
    const score = r[kolomVoor(stelling)]
    if (!isZelfreviewScore(score)) return null
    scores[stelling] = score
  }
  return { scores, meeneem: normaliseerMeeneem(r.meeneem) ?? null }
}

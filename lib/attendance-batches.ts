// Batching van attendance-query's per groep events. Pure helpers, geen
// Supabase-afhankelijkheid.
//
// Waarom: PostgREST levert per request hooguit 1000 rijen (max-rows). Een
// kalender die alle attendance van een team in één query ophaalt, wordt bij
// een paar honderd events stilzwijgend afgekapt — en dan tonen de oudste
// events een te lage of geen teller. Per event bestaan er hooguit zoveel
// attendance-rijen als het team spelers heeft (UNIQUE(event_id, player_id)),
// dus een batch van floor(1000 / aantalSpelers) events past gegarandeerd.

// Bovengrens van een batch, gelijk aan ID_CHUNK in app/actions/attendance.ts:
// een `.in()`-lijst met honderden uuid's loopt tegen de URL-lengtegrens aan.
export const MAX_EVENTS_PER_BATCH = 50

// PostgREST max-rows: het maximum aantal rijen per response.
export const MAX_RIJEN_PER_REQUEST = 1000

// Vaste batchgrootte als het aantal spelers onbekend is (spelersquery gefaald):
// klein genoeg dat een batch bij elk realistisch team ruim onder de 1000 blijft.
export const TERUGVAL_BATCH_GROOTTE = 10

// Aantal events per attendance-query zodat (events × spelers) nooit boven de
// 1000 rijen uitkomt. Altijd minstens 1, nooit meer dan MAX_EVENTS_PER_BATCH.
// Een onbruikbare invoer (NaN, negatief) valt terug op 1 speler.
export function eventBatchGrootte(aantalSpelers: number): number {
  const spelers = Number.isFinite(aantalSpelers) ? Math.max(1, Math.floor(aantalSpelers)) : 1
  return Math.min(MAX_EVENTS_PER_BATCH, Math.max(1, Math.floor(MAX_RIJEN_PER_REQUEST / spelers)))
}

// Knipt een lijst in opeenvolgende stukken van `grootte`. Behoudt de volgorde
// en muteert de invoer niet. Een ongeldige grootte (< 1, NaN) wordt 1.
export function inBatches<T>(items: readonly T[], grootte: number): T[][] {
  const stap = Number.isFinite(grootte) ? Math.max(1, Math.floor(grootte)) : 1
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += stap) batches.push(items.slice(i, i + stap))
  return batches
}

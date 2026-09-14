// Tab-validatie voor het spelersprofiel (/players/[id]). Spiegelt PERIODES/
// isPeriode (lib/inzichten.ts) — dezelfde vorm voor een andere whitelist.

export const PROFIEL_TABS = ['info', 'aanwezigheid', 'statistieken'] as const
export type ProfielTab = (typeof PROFIEL_TABS)[number]

// Standaardtab. Ook de terugval bij een onbekende, ontbrekende of dubbele
// (`?tab=a&tab=b` → string[]) waarde: Info is de veiligste, minst verrassende
// keuze en een tikfout in de URL hoort nooit een fout te veroorzaken.
export const PROFIEL_TAB_STANDAARD: ProfielTab = 'info'

export function isProfielTab(waarde: unknown): waarde is ProfielTab {
  return typeof waarde === 'string' && (PROFIEL_TABS as readonly string[]).includes(waarde)
}

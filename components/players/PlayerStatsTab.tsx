import Link from 'next/link'
import type { Dict } from '@/messages/nl'
import type { SpelerStatistieken } from '@/lib/inzichten'
import { formatDate } from '@/lib/utils'

// Statistieken-tab (AC14-AC18). Vormkeuze uit de brief: geen grafiek — vier
// tellingen + één gemiddelde + een korte reeks is "magnitude van enkele
// waarden", een stat-tegel/hero-getal, geen plot. Zelfde precedent als
// components/inzichten/TopWorstAanwezigheid.tsx.
interface Props {
  stats: SpelerStatistieken | null
  // true = het laden van de statistieken is mislukt (bv. GENERIC_ERROR_MESSAGE
  // bij een RPC-/DB-fout). Losgetrokken van `stats === null`: die betekent
  // UITSLUITEND "geen seizoen ingesteld" (validator-bevinding). Bij een fout
  // tonen we een generieke melding, nooit de rauwe actionfout.
  statsError: boolean
  excludedHint: boolean
  t: Dict
}

// Lokale kopie van de pagina-brede lege staat uit app/inzichten/page.tsx
// (LegeStaat, niet geëxporteerd — bewust niet verhuisd, dat raakt een pagina
// buiten scope). Zelfde visuele vorm.
function LegeStaat({ titel, hint, actieHref, actieLabel }: { titel: string; hint: string; actieHref: string; actieLabel: string }) {
  return (
    <div className="surface-card p-10 text-center flex flex-col items-center gap-3">
      <span className="ms text-[40px] text-faint">calendar_month</span>
      <p className="text-ink font-bold">{titel}</p>
      <p className="text-faint text-sm">{hint}</p>
      <Link
        href={actieHref}
        className="mt-1 h-11 rounded-xl px-5 flex items-center gap-2 text-sm font-bold text-white"
        style={{ background: 'var(--brand-btn)' }}
      >
        {actieLabel}
      </Link>
    </div>
  )
}

// Generieke fouttoestand (validator-bevinding): een RPC-/DB-fout in
// getSpelerStatistieken mag nooit de hele profielpagina laten omkiepen (er is
// geen app/error.tsx) — alleen deze tab toont een nette, niet-onthullende
// melding. Geen CTA-knop: in tegenstelling tot "geen seizoen" is hier geen
// zinvolle vervolgstap voor de gebruiker.
function FoutStaat({ tekst }: { tekst: string }) {
  return (
    <div className="surface-card p-10 text-center flex flex-col items-center gap-3">
      <span className="ms text-[40px] text-faint">error_outline</span>
      <p className="text-ink font-bold">{tekst}</p>
    </div>
  )
}

function StatTegel({ icon, iconColor, value, label }: { icon: string; iconColor: string; value: number; label: string }) {
  return (
    <div className="bg-surface-sunken rounded-xl p-3 flex flex-col gap-1.5">
      <span className="ms text-[18px]" aria-hidden="true" style={{ color: iconColor }}>{icon}</span>
      <span className="font-display text-[24px] tabular-nums text-ink leading-none">{value}</span>
      <span className="text-[11.5px] font-semibold text-faint">{label}</span>
    </div>
  )
}

export default function PlayerStatsTab({ stats, statsError, excludedHint, t }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {excludedHint && (
        <div className="surface-card p-4 text-[13px] font-semibold text-faint flex items-center gap-2.5">
          <span className="ms text-[18px] text-faint flex-shrink-0" aria-hidden="true">info</span>
          {t.players.statsExcludedHint}
        </div>
      )}

      {statsError ? (
        <FoutStaat tekst={t.players.statsLoadError} />
      ) : stats === null ? (
        <LegeStaat
          titel={t.insights.noSeason}
          hint={t.insights.noSeasonHint}
          actieHref="/settings"
          actieLabel={t.insights.goToSettings}
        />
      ) : (
        <>
          <div className="surface-card p-5 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-semibold text-faint">{t.players.statsAttendanceLabel}</span>
              {stats.aanwezigheidPercentage === null ? (
                <span className="text-[13px] font-bold text-muted mt-1">{t.players.statsAttendanceEmpty}</span>
              ) : (
                <>
                  <span className="font-display text-[32px] tabular-nums text-ink leading-none">
                    {stats.aanwezigheidPercentage}%
                  </span>
                  <span className="text-[12px] font-semibold text-faint">
                    {t.players.statsAttendanceDetail
                      .replace('{aanwezig}', String(stats.aanwezig))
                      .replace('{totaal}', String(stats.aanwezig + stats.afwezig))}
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-semibold text-faint">{t.players.statsRatingLabel}</span>
              {stats.gemiddeldeRating === null ? (
                <span className="text-[13px] font-bold text-muted mt-1">{t.insights.spelerEmpty}</span>
              ) : (
                <span className="font-display text-[32px] tabular-nums text-ink leading-none">
                  {stats.gemiddeldeRating.toFixed(1)}
                </span>
              )}
            </div>
          </div>

          {stats.ratingReeks.length > 0 && (
            <div className="surface-card p-5">
              <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-faint mb-2">
                {t.players.statsRatingSeriesLabel}
              </h3>
              <ol className="flex flex-col gap-1.5">
                {stats.ratingReeks.map((punt) => (
                  <li key={punt.event_id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink font-semibold min-w-0 leading-snug">
                      {formatDate(punt.datum, t.browserLocale)} · {punt.tegenstander ?? '—'}
                    </span>
                    <span className="text-faint font-semibold whitespace-nowrap tabular-nums">{punt.rating}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTegel icon="sports_soccer" iconColor="var(--brand-accent)" value={stats.tellingen.doelpunten} label={t.players.statsGoals} />
            <StatTegel icon="handshake" iconColor="var(--primary-strong)" value={stats.tellingen.assists} label={t.players.statsAssists} />
            <StatTegel icon="style" iconColor="var(--chip-amber-fg)" value={stats.tellingen.geel} label={t.players.statsYellow} />
            <StatTegel icon="style" iconColor="var(--chip-red-fg)" value={stats.tellingen.rood} label={t.players.statsRed} />
          </div>
        </>
      )}
    </div>
  )
}

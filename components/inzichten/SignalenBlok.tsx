import type { Dict } from '@/messages/nl'
import type { Signaal, SignaalToon } from '@/lib/inzichten'
import { vulSignaalIn } from '@/lib/signaal-tekst'

// De "wat valt op"-laag: dezelfde cijfers als de grafieken eronder, maar
// uitgeschreven als Nederlandse zinnen met een oordeel erin. Dit is de laag
// die de pagina eerder helemaal miste — een grafiek toont dát de opkomst 71%
// is, deze regel zegt dat dat onder de norm ligt en hoeveel het gezakt is.
//
// Volledig regelgebaseerd (lib/inzichten.ts: bepaalSignalen) — geen model,
// geen externe aanroep, dus altijd dezelfde uitkomst bij dezelfde data.
//
// Het blok rendert niets bij nul signalen (tenzij `onvolledig`): de aanroeper hoeft daar niet zelf
// op te controleren, maar krijgt dan ook geen lege kaart met "geen
// bijzonderheden" — dat is een regel tekst die niets toevoegt.

const TOON_STIJL: Record<SignaalToon, { bg: string; teken: string }> = {
  zorg: { bg: 'var(--chip-red-fg)', teken: '!' },
  letop: { bg: 'var(--warning-text)', teken: '↓' },
  goed: { bg: 'var(--brand-accent)', teken: '↑' },
}

export default function SignalenBlok({
  signalen,
  onvolledig = false,
  t,
}: {
  signalen: Signaal[]
  // Een deel van de signalen kon niet worden berekend (falende of afgekapte
  // bron). Dan blijft het blok ook bij nul signalen staan, met alleen de melding.
  onvolledig?: boolean
  t: Dict
}) {
  if (signalen.length === 0 && !onvolledig) return null

  return (
    <div data-conclusielaag="signalen" className="surface-card overflow-hidden">
      <div className="px-5 py-3.5 flex items-baseline justify-between gap-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        {/* whitespace-nowrap: "Wat valt op" brak op mobiel over twee regels
            naast de ondertitel (designronde 3). */}
        <h2 className="font-display text-[16px] font-bold text-ink whitespace-nowrap">{t.insights.signalenTitle}</h2>
        <p className="text-[11px] font-semibold text-faint text-right">{t.insights.signalenSubtitle}</p>
      </div>
      <ul className="flex flex-col">
        {signalen.map((signaal, i) => {
          const stijl = TOON_STIJL[signaal.toon]
          return (
            <li
              key={signaal.id}
              className="px-5 py-3 grid grid-cols-[auto_1fr] gap-3 items-start"
              style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}
            >
              <span
                aria-hidden="true"
                className="w-[22px] h-[22px] rounded-[7px] grid place-items-center text-[12px] font-black mt-px"
                // Tekstkleur is bewust `--surface` en niet wit: de
                // achtergrondtokens draaien in dark mode om naar hun lichte
                // variant (--chip-red-fg wordt #fca5a5, --brand-accent wordt
                // #4ade80). Witte tekst daarop haalt geen enkele
                // contrastverhouding. --surface is precies het token dat
                // andersom meebeweegt: wit op licht thema, donkergroen op
                // donker thema — dus altijd het tegenovergestelde van de
                // badgekleur.
                style={{ background: stijl.bg, color: 'var(--surface)' }}
              >
                {stijl.teken}
              </span>
              <p className="text-[13.5px] font-semibold text-ink leading-snug">
                {vulSignaalIn(t, signaal)}
              </p>
            </li>
          )
        })}
      </ul>
      {onvolledig && (
        // Meta-melding, geen signaal: geen badge, geen statuskleur, geen alert.
        <p
          className="px-5 py-3 text-[12px] font-semibold text-faint"
          style={signalen.length > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}
        >
          {t.insights.signalenOnvolledig}
        </p>
      )}
    </div>
  )
}

'use client'

// Uitnodigingslink genereren/tonen/kopiëren, in de Staf-sectie op
// Instellingen (brief §4.3). Twee toestanden:
//   - geen actieve link: knop "Uitnodigingslink genereren" + de AC 1-uitleg
//     dat de app zelf niets verstuurt.
//   - actieve link: "er staat een link open tot <datum>" + "Nieuwe link
//     genereren" (met waarschuwing dat de oude direct vervalt).
// Direct ná genereren komt daar één keer een read-only veld met de VOLLE
// URL bij — na een herlaad is dat weg (het token is alleen gehasht
// opgeslagen, zie de backend-samenvatting fase 2 §1) en toont de kaart
// alleen nog de vervaldatum.
import { useState, useSyncExternalStore, useTransition } from 'react'
import { createInvite } from '@/app/actions/team-invites'
import { useDict } from '@/lib/i18n-context'
import { useReducedMotion } from '@/lib/use-reduced-motion'

// Crossfade-duur voor de kopieerknop-labelwissel (blur maskeert het
// overlappen van twee teksten) en hoe lang "Gekopieerd" blijft staan.
const COPY_LABEL_CROSSFADE_MS = 200
const COPY_SUCCESS_HOLD_MS = 1600

interface Props {
  initialActiveInvite: { verlooptOp: string } | null
}

function formatteerVervaldatum(iso: string, locale: string): string {
  // Uitsluitend TONEN in de browsertijdzone — de geldigheidsbeslissing zelf
  // valt in de database (accept_team_invite, `now()`), nooit hier.
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

// Zelfde `useSyncExternalStore`-mounted-truc als lib/use-reduced-motion.ts en
// het `mounted`-patroon in components/TeamSwitcher.tsx (er zit geen externe
// store achter — leeg subscribe, snapshot false/true — het is uitsluitend een
// hydratie-veilige manier om "we zijn ná mount" te weten zonder een
// setState-in-effect, wat react-hooks/set-state-in-effect afkeurt).
//
// `activeInvite` komt uit `initialActiveInvite` (StafSection, server) en
// wordt dus ook bij de eerste server-render al gevuld — die render gebeurt in
// de servertijdzone (UTC op Vercel), terwijl de client daarna in de
// browsertijdzone formatteert: twee verschillende teksten voor dezelfde
// DOM-node, met rond middernacht zelfs een andere dag (validatiebevinding 4).
// Vóór mount tonen server én de EERSTE client-render dezelfde placeholder,
// dus geen hydratiemismatch; ná mount (`mounted === true`, uitsluitend
// client-side) verschijnt de echte, lokale tijd.
const emptySubscribe = () => () => {}

function VervalLabel({ iso }: { iso: string }) {
  const t = useDict()
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  if (!mounted) return <>…</>
  return <>{formatteerVervaldatum(iso, t.browserLocale)}</>
}

function CopyButton({ url }: { url: string }) {
  const t = useDict()
  const reduceMotion = useReducedMotion()
  const [state, setState] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [labelKey, setLabelKey] = useState(0)

  async function handleCopy() {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        setLabelKey((k) => k + 1)
        setState('copied')
        setTimeout(() => setState('idle'), COPY_SUCCESS_HOLD_MS)
        return
      } catch {
        // Valt door naar de fallback hieronder.
      }
    }
    // Fallback: navigator.clipboard ontbreekt (niet-https, oudere iOS) of
    // faalde — selecteer de tekst zodat de gebruiker zelf kan kopiëren.
    const input = document.getElementById('invite-link-url') as HTMLInputElement | null
    input?.select()
    setLabelKey((k) => k + 1)
    setState('fallback')
  }

  const label = state === 'copied' ? t.staf.copied : state === 'fallback' ? t.staf.copyFailed : t.staf.copy

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex-shrink-0 active:scale-[0.97] transition-transform"
      style={{ background: 'var(--primary)' }}
    >
      <span
        key={labelKey}
        style={
          reduceMotion
            ? undefined
            : { display: 'inline-block', animation: `invite-copy-label-in ${COPY_LABEL_CROSSFADE_MS}ms ease-out` }
        }
      >
        {label}
      </span>
    </button>
  )
}

export default function InviteLinkCard({ initialActiveInvite }: Props) {
  const t = useDict()
  const [isPending, startTransition] = useTransition()
  const [activeInvite, setActiveInvite] = useState(initialActiveInvite)
  const [link, setLink] = useState<{ url: string; verlooptOp: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const heeftActieveLink = activeInvite !== null

  function handleGenerate() {
    setError(null)
    startTransition(async () => {
      try {
        const resultaat = await createInvite()
        setLink(resultaat)
        setActiveInvite({ verlooptOp: resultaat.verlooptOp })
      } catch {
        // Nooit err.message: Next saneert server-action-fouten in productie
        // sowieso al tot een generieke Engelse tekst, dus een eigen, vaste
        // i18n-melding is de enige betrouwbare optie (validatiebevinding 8,
        // patroon RechtenToggles.tsx).
        setError(t.auth.genericError)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[14px] font-bold text-ink">{t.staf.inviteTitle}</h3>
        <p className="text-[12.5px] text-faint mt-0.5">{t.staf.inviteHint}</p>
      </div>

      {link && (
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-link-url" className="text-[11px] font-bold text-faint uppercase tracking-wide">
            {t.staf.linkLabel}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="invite-link-url"
              type="text"
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-[var(--border-soft)] bg-surface-sunken text-ink text-[13px] font-mono"
            />
            <CopyButton url={link.url} />
          </div>
          <p className="text-[12px] text-faint">{t.staf.linkOnceHint}</p>
        </div>
      )}

      {!link && heeftActieveLink && activeInvite && (
        <p className="text-[13px] font-medium text-muted">
          {t.staf.activeInviteExists} <VervalLabel iso={activeInvite.verlooptOp} />
        </p>
      )}
      {link && (
        <p className="text-[12px] text-faint">
          {t.staf.expiresOn} <VervalLabel iso={link.verlooptOp} />
        </p>
      )}

      {error && <p className="text-[12.5px] font-semibold text-danger">{error}</p>}

      <div className="flex flex-col gap-1.5">
        {heeftActieveLink && <p className="text-[12px] text-faint">{t.staf.regenerateWarning}</p>}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          className="self-start px-4 py-2.5 rounded-xl text-sm font-bold border disabled:opacity-50 active:scale-[0.98] transition"
          style={{ borderColor: 'var(--border-soft)', color: 'var(--ink)' }}
        >
          {heeftActieveLink ? t.staf.regenerateLink : t.staf.generateLink}
        </button>
      </div>
    </div>
  )
}

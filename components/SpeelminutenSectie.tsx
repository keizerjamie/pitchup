'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { POSITION_ABBREVIATIONS, type Player, type Speelminuten } from '@/lib/types'
import { isValidSpeelminuten, isValidWissels } from '@/lib/match-analysis.mjs'
import { saveSpeelminuten, deleteSpeelminuten, herstelSpeelminuten } from '@/app/actions/speelminuten'
import { useDict } from '@/lib/i18n-context'
import { useToast } from '@/components/ui/Toast'

type Waarde = { minuten: number; wissels: number }
type Opgeslagen = Record<string, Waarde>

const MELDING_KLASSE = 'bg-panel-red border border-panel-red-edge text-panel-red-ink text-xs px-4 py-2.5 rounded-xl'

function bouwMap(lijst: Speelminuten[]): Opgeslagen {
  const m: Opgeslagen = {}
  for (const r of lijst) m[r.player_id] = { minuten: r.minuten, wissels: r.wissels }
  return m
}

function waardeTekst(template: string, w: Waarde): string {
  return template.replace('{minuten}', String(w.minuten)).replace('{wissels}', String(w.wissels))
}

// Eén verwijderknop voor beide soorten rijen: de hit-slop-regel in
// ux-details.acceptance.test.tsx kijkt naar deze className-regel.
function VerwijderKnop({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="relative hit-slop w-8 h-8 rounded-lg flex items-center justify-center text-faint hover:text-ink transition-colors active:scale-95 disabled:opacity-40"
    >
      <span className="ms text-[20px]" aria-hidden="true">close</span>
    </button>
  )
}

// Verwijderen met ongedaan maken, gedeeld door de invoerregel en de
// alleen-lezen "overige" regel. Optimistisch leegmaken; een falende delete
// zet de waarde terug en toont undo.deleteError.
function useVerwijder(
  eventId: string,
  playerId: string,
  waarde: Waarde | undefined,
  zet: (playerId: string, w: Waarde | null) => void,
  zetFout: (playerId: string, fout: string | null) => void,
) {
  const t = useDict()
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  function verwijder(naDelete?: () => void) {
    const vorige = waarde
    zetFout(playerId, null)
    zet(playerId, null)
    naDelete?.()
    startTransition(async () => {
      try {
        const herstel = await deleteSpeelminuten(eventId, playerId)
        router.refresh()
        toast.toon({
          bericht: t.undo.deleted,
          actie: {
            label: t.undo.action,
            foutBericht: t.undo.restoreError,
            onActie: async () => {
              await herstelSpeelminuten(herstel)
              zet(playerId, { minuten: herstel.minuten, wissels: herstel.wissels })
              router.refresh()
            },
          },
        })
      } catch {
        if (vorige) zet(playerId, vorige)
        zetFout(playerId, t.undo.deleteError)
      }
    })
  }

  return { verwijder, isPending }
}

function SpeelminutenRegel({
  eventId, speler, opgeslagen, canEdit, zet, deleteFout, zetFout,
}: {
  eventId: string
  speler: Player
  opgeslagen: Waarde | undefined
  canEdit: boolean
  zet: (playerId: string, w: Waarde | null) => void
  deleteFout: string | undefined
  zetFout: (playerId: string, fout: string | null) => void
}) {
  const t = useDict()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { verwijder, isPending: verwijderPending } = useVerwijder(eventId, speler.id, opgeslagen, zet, zetFout)

  // Het wisselveld start zichtbaar op 0 (O1); minuten blijft verplicht. Het
  // concept is null zolang de gebruiker niets wijzigde: dan volgt de regel de
  // opgeslagen waarde, ook na een router.refresh().
  const basis = {
    m: opgeslagen ? String(opgeslagen.minuten) : '',
    w: opgeslagen ? String(opgeslagen.wissels) : '0',
  }
  const [concept, setConcept] = useState<{ m: string; w: string } | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState(false)
  const huidig = concept ?? basis
  const vuil = concept !== null && (concept.m !== basis.m || concept.w !== basis.w)
  const bezig = isPending || verwijderPending

  useEffect(() => {
    if (!klaar) return
    const id = setTimeout(() => setKlaar(false), 2000)
    return () => clearTimeout(id)
  }, [klaar])

  function wijzig(veld: 'm' | 'w', v: string) {
    setConcept({ ...huidig, [veld]: v })
    setFout(null)
    setKlaar(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (bezig || !vuil) return
    const mRuw = huidig.m.trim()
    const wRuw = huidig.w.trim()
    const minuten = mRuw === '' ? null : Number(mRuw)
    const wissels = wRuw === '' ? null : Number(wRuw)
    if (minuten === null || wissels === null || !isValidSpeelminuten(minuten) || !isValidWissels(wissels)) {
      setFout(t.analysis.speelminutenOngeldig)
      return
    }
    setFout(null)
    startTransition(async () => {
      try {
        await saveSpeelminuten(eventId, speler.id, minuten, wissels)
        zet(speler.id, { minuten, wissels })
        setConcept(null)
        setKlaar(true)
        router.refresh()
      } catch {
        // Het concept blijft staan; de database houdt de oude waarde (AC-M.5).
        setFout(t.analysis.speelminutenOpslaanFout)
      }
    })
  }

  const naam = speler.name
  const info = (
    <div className="flex-1 min-w-0 flex flex-col leading-tight">
      <span className="text-[14.5px] font-bold text-ink truncate">{naam}</span>
      <span className="text-[12px] font-semibold text-faint">
        {speler.jersey_number != null ? `#${speler.jersey_number} · ` : ''}
        {POSITION_ABBREVIATIONS[speler.position] ?? speler.position}
      </span>
    </div>
  )

  if (!canEdit) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5">
        {info}
        <span className="text-[12.5px] font-bold text-faint tabular-nums flex-shrink-0">
          {opgeslagen ? waardeTekst(t.analysis.speelminutenWaarde, opgeslagen) : t.analysis.speelminutenNietIngevuld}
        </span>
      </div>
    )
  }

  const invoerKlasse = 'invoer-groot w-16 h-9 text-center font-display text-[16px] font-bold text-ink tabular-nums rounded-lg bg-surface-sunken focus:outline-none disabled:opacity-60'
  return (
    <div className="flex flex-col gap-2 px-4 py-2.5">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {info}
        <div className="flex items-end gap-2 [--hit-slop-gap:8px] flex-shrink-0">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-faint">{t.analysis.minutenLabel}</span>
            <input
              type="number" inputMode="numeric" step={1} min={0} max={130}
              value={huidig.m}
              onChange={(e) => wijzig('m', e.target.value)}
              disabled={bezig}
              aria-label={`${naam} – ${t.analysis.minutenLabel}`}
              className={invoerKlasse}
              style={{ border: '1px solid var(--border-soft)' }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-faint">{t.analysis.wisselsLabel}</span>
            <input
              type="number" inputMode="numeric" step={1} min={0} max={99}
              value={huidig.w}
              onChange={(e) => wijzig('w', e.target.value)}
              disabled={bezig}
              aria-label={`${naam} – ${t.analysis.wisselsLabel}`}
              className={invoerKlasse}
              style={{ border: '1px solid var(--border-soft)' }}
            />
          </label>
          <button
            type="submit"
            disabled={bezig || !vuil}
            className="relative hit-slop h-9 px-3 rounded-lg text-white font-bold text-[13px] transition-opacity active:scale-95 disabled:opacity-50"
            style={{ background: 'var(--primary)' }}
          >
            {t.analysis.save}
          </button>
          {opgeslagen && (
            <VerwijderKnop onClick={() => verwijder(() => { setConcept(null); setFout(null) })} disabled={bezig} label={`${t.analysis.delete} – ${naam}`} />
          )}
        </div>
      </form>
      {klaar && <span role="status" className="text-[12.5px] font-bold text-brand-accent">{t.analysis.saved}</span>}
      {fout && <div role="alert" className={MELDING_KLASSE}>{fout}</div>}
      {deleteFout && <div role="alert" className={MELDING_KLASSE}>{deleteFout}</div>}
    </div>
  )
}

// Alleen-lezen rij van een speler die niet (meer) aanwezig of actief is (O2):
// geen bewerken, wel verwijderen met ongedaan maken (alleen bij canEdit).
function OverigeRegel({
  eventId, playerId, naam, waarde, canEdit, zet, deleteFout, zetFout,
}: {
  eventId: string
  playerId: string
  naam: string
  waarde: Waarde
  canEdit: boolean
  zet: (playerId: string, w: Waarde | null) => void
  deleteFout: string | undefined
  zetFout: (playerId: string, fout: string | null) => void
}) {
  const t = useDict()
  const { verwijder, isPending } = useVerwijder(eventId, playerId, waarde, zet, zetFout)
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 text-[14px] font-bold text-ink truncate">{naam}</span>
        <span className="text-[12.5px] font-bold text-faint tabular-nums flex-shrink-0">
          {waardeTekst(t.analysis.speelminutenWaarde, waarde)}
        </span>
        {canEdit && <VerwijderKnop onClick={() => verwijder()} disabled={isPending} label={`${t.analysis.delete} – ${naam}`} />}
      </div>
      {deleteFout && <div role="alert" className={MELDING_KLASSE}>{deleteFout}</div>}
    </li>
  )
}

export default function SpeelminutenSectie({
  eventId, spelers, initialSpeelminuten, overigeNamen, canEdit, wedstrijdGespeeld, bronFout,
}: {
  eventId: string
  spelers: Player[]
  initialSpeelminuten: Speelminuten[]
  overigeNamen: Record<string, string>
  canEdit: boolean
  wedstrijdGespeeld: boolean
  bronFout: boolean
}) {
  const t = useDict()
  const [opgeslagen, setOpgeslagen] = useState<Opgeslagen>(() => bouwMap(initialSpeelminuten))
  const [prevInitial, setPrevInitial] = useState(initialSpeelminuten)
  if (prevInitial !== initialSpeelminuten) {
    setPrevInitial(initialSpeelminuten)
    setOpgeslagen(bouwMap(initialSpeelminuten))
  }

  function zet(playerId: string, w: Waarde | null) {
    setOpgeslagen((prev) => {
      const next = { ...prev }
      if (w === null) delete next[playerId]
      else next[playerId] = w
      return next
    })
  }

  // Delete-fouten staan in de ouder: een overige rij verdwijnt optimistisch en
  // komt bij falen als nieuw component terug, dus lokale state zou verloren gaan.
  const [deleteFouten, setDeleteFouten] = useState<Record<string, string>>({})
  function zetFout(playerId: string, fout: string | null) {
    setDeleteFouten((prev) => {
      const next = { ...prev }
      if (fout === null) delete next[playerId]
      else next[playerId] = fout
      return next
    })
  }

  const aanwezig = new Set(spelers.map((p) => p.id))
  const overige = Object.keys(opgeslagen).filter((id) => !aanwezig.has(id))

  let inhoud: React.ReactNode
  if (bronFout) {
    inhoud = (
      <div className="surface-card p-5 text-center">
        <p className="text-faint text-[13px] font-medium">{t.analysis.speelminutenNietBeschikbaar}</p>
      </div>
    )
  } else if (!wedstrijdGespeeld) {
    inhoud = (
      <div className="surface-card p-5 text-center">
        <p className="text-faint text-[13px] font-medium">{t.analysis.speelminutenToekomst}</p>
      </div>
    )
  } else {
    inhoud = (
      <>
        <div className="surface-card overflow-hidden">
          {spelers.map((speler, i) => (
            <div key={speler.id} style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
              <SpeelminutenRegel
                eventId={eventId}
                speler={speler}
                opgeslagen={opgeslagen[speler.id]}
                canEdit={canEdit}
                zet={zet}
                deleteFout={deleteFouten[speler.id]}
                zetFout={zetFout}
              />
            </div>
          ))}
        </div>
        {overige.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-faint">{t.analysis.speelminutenOverig}</span>
            <ul className="surface-card overflow-hidden divide-y divide-[var(--border-soft)]">
              {overige.map((id) => (
                <OverigeRegel
                  key={id}
                  eventId={eventId}
                  playerId={id}
                  naam={overigeNamen[id] ?? '—'}
                  waarde={opgeslagen[id]}
                  canEdit={canEdit}
                  zet={zet}
                  deleteFout={deleteFouten[id]}
                  zetFout={zetFout}
                />
              ))}
            </ul>
          </div>
        )}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-3" aria-label={t.analysis.speelminuten}>
      <div className="flex flex-col gap-1">
        <span className="font-display text-[17px] font-bold text-ink">{t.analysis.speelminuten}</span>
        <p className="text-[12.5px] text-faint">{t.analysis.speelminutenUitleg}</p>
      </div>
      {inhoud}
    </section>
  )
}

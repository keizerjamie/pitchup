'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TEGENDOELPUNT_SOORTEN, type Tegendoelpunt, type TegendoelpuntSoort } from '@/lib/types'
import { isValidMinute } from '@/lib/match-analysis.mjs'
import { addTegendoelpunt, deleteTegendoelpunt, herstelTegendoelpunt } from '@/app/actions/tegendoelpunten'
import { useDict } from '@/lib/i18n-context'
import { useToast } from '@/components/ui/Toast'

// Client-gekozen id voor idempotent opslaan: bij een retry met ongewijzigde
// invoer blijft de id gelijk, dus een tweede aanroep levert nooit een dubbel
// tegendoelpunt op. randomUUID bestaat alleen in een secure context (https of
// localhost); zonder krijgen we null en melden we een fout in plaats van een
// id te verzinnen waarmee een retry wél dubbel zou schrijven.
function nieuweId(): string | null {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null
  } catch {
    return null
  }
}

// Minuut oplopend, zonder minuut achteraan, daarna in volgorde van vastleggen.
function sorteer(lijst: Tegendoelpunt[]): Tegendoelpunt[] {
  return [...lijst].sort((a, b) => {
    if (a.minute !== b.minute) {
      if (a.minute === null) return 1
      if (b.minute === null) return -1
      return a.minute - b.minute
    }
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })
}

export default function TegendoelpuntenSectie({
  eventId,
  initialTegendoelpunten,
  goalsAgainst,
  canEdit,
}: {
  eventId: string
  initialTegendoelpunten: Tegendoelpunt[]
  goalsAgainst: number | null
  canEdit: boolean
}) {
  const t = useDict()
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  const [lijst, setLijst] = useState<Tegendoelpunt[]>(initialTegendoelpunten)
  const [prevInitial, setPrevInitial] = useState(initialTegendoelpunten)
  if (prevInitial !== initialTegendoelpunten) {
    setPrevInitial(initialTegendoelpunten)
    setLijst(initialTegendoelpunten)
  }

  const [soort, setSoort] = useState<TegendoelpuntSoort | null>(null)
  const [minuut, setMinuut] = useState('')
  const [clientId, setClientId] = useState<string | null>(() => nieuweId())
  const [formFout, setFormFout] = useState<string | null>(null)
  const [deleteFout, setDeleteFout] = useState<string | null>(null)

  function kiesSoort(s: TegendoelpuntSoort) {
    setSoort(s)
    setClientId(nieuweId())
    setFormFout(null)
  }

  function wijzigMinuut(v: string) {
    setMinuut(v)
    setClientId(nieuweId())
    setFormFout(null)
  }

  function handleToevoegen() {
    if (!soort) return
    const ruw = minuut.trim()
    const minute = ruw === '' ? null : Number(ruw)
    if (!isValidMinute(minute)) {
      setFormFout(t.analysis.tegendoelpuntOngeldigeMinuut)
      return
    }
    // Zonder (secure-context) id nooit stil doorgaan: zie nieuweId.
    const id = clientId ?? nieuweId()
    if (!id) {
      setFormFout(t.analysis.tegendoelpuntOpslaanFout)
      return
    }
    setFormFout(null)
    startTransition(async () => {
      try {
        await addTegendoelpunt(id, eventId, soort, minute)
        setSoort(null)
        setMinuut('')
        setClientId(nieuweId())
        router.refresh()
      } catch {
        // Id blijft behouden: een retry met dezelfde invoer is idempotent.
        setClientId(id)
        setFormFout(t.analysis.tegendoelpuntOpslaanFout)
      }
    })
  }

  function zetTerug(rij: Tegendoelpunt) {
    setLijst((prev) => (prev.some((r) => r.id === rij.id) ? prev : [...prev, rij]))
  }

  function handleVerwijder(id: string) {
    const rij = lijst.find((r) => r.id === id) ?? null
    setDeleteFout(null)
    setLijst((prev) => prev.filter((r) => r.id !== id))
    startTransition(async () => {
      try {
        const herstel = await deleteTegendoelpunt(id)
        router.refresh()
        toast.toon({
          bericht: t.undo.deleted,
          actie: {
            label: t.undo.action,
            foutBericht: t.undo.restoreError,
            onActie: async () => {
              await herstelTegendoelpunt(herstel)
              if (rij) zetTerug(rij)
              router.refresh()
            },
          },
        })
      } catch {
        if (rij) zetTerug(rij)
        setDeleteFout(t.undo.deleteError)
      }
    })
  }

  // Waarschuwing, geen blokkade. Pas zodra er minstens één tegendoelpunt is
  // vastgelegd: oude wedstrijden met alleen een uitslag blijven zonder hint.
  const toonHint = goalsAgainst !== null && lijst.length > 0 && lijst.length !== goalsAgainst
  const gesorteerd = sorteer(lijst)

  return (
    <section className="flex flex-col gap-3" aria-label={t.analysis.tegendoelpunten}>
      <span className="font-display text-[17px] font-bold text-ink">{t.analysis.tegendoelpunten}</span>

      {toonHint && (
        <p className="text-[12.5px] font-semibold px-1" style={{ color: 'var(--chip-amber-fg)' }}>
          {t.analysis.tegendoelpuntSumHint}
        </p>
      )}

      {deleteFout && (
        <div role="alert" className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-xs px-4 py-2.5 rounded-xl">
          {deleteFout}
        </div>
      )}

      {gesorteerd.length === 0 ? (
        <div className="surface-card p-5 text-center">
          <p className="text-faint text-[13px] font-medium">{t.analysis.noTegendoelpunten}</p>
        </div>
      ) : (
        <ul className="surface-card overflow-hidden">
          {gesorteerd.map((r, i) => (
            <li
              key={r.id}
              className="flex items-center gap-3 px-4 py-2.5"
              style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}
            >
              <span className="ms text-[18px] flex-shrink-0" style={{ color: 'var(--chip-red-fg)' }} aria-hidden="true">sports_soccer</span>
              <span className="flex-1 min-w-0 text-[14px] font-bold text-ink truncate">{t.analysis.tegendoelpuntSoorten[r.soort]}</span>
              {r.minute != null && (
                <span className="text-[12.5px] font-bold text-faint tabular-nums flex-shrink-0">{r.minute}′</span>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleVerwijder(r.id)}
                  disabled={isPending}
                  aria-label={t.analysis.delete}
                  className="relative hit-slop w-8 h-8 rounded-lg flex items-center justify-center text-faint hover:text-ink transition-colors disabled:opacity-40"
                >
                  <span className="ms text-[20px]" aria-hidden="true">close</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="surface-card p-4 flex flex-col gap-3">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-faint">{t.analysis.addTegendoelpunt}</span>

          {formFout && (
            <div role="alert" className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-xs px-4 py-2.5 rounded-xl">
              {formFout}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2" role="group" aria-label={t.analysis.tegendoelpuntSoortLabel}>
            {TEGENDOELPUNT_SOORTEN.map((s) => {
              const active = soort === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => kiesSoort(s)}
                  disabled={isPending}
                  aria-pressed={active}
                  className="h-10 rounded-xl px-2 flex items-center justify-center text-[12.5px] font-bold transition-colors disabled:opacity-60"
                  style={active
                    ? { background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--brand-accent)', border: '1px solid color-mix(in srgb, var(--primary) 45%, var(--border-soft))' }
                    : { background: 'var(--surface-sunken)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}
                >
                  <span className="truncate">{t.analysis.tegendoelpuntSoorten[s]}</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number" min={0} max={130} inputMode="numeric"
              value={minuut}
              onChange={(e) => wijzigMinuut(e.target.value)}
              placeholder={t.analysis.minuteOptional}
              aria-label={t.analysis.minute}
              disabled={isPending}
              className="flex-1 px-3 py-2.5 rounded-xl bg-surface-sunken text-ink font-semibold text-[14px] placeholder:text-faint focus:outline-none disabled:opacity-60"
              style={{ border: '1px solid var(--border-soft)' }}
            />
            <button
              type="button"
              onClick={handleToevoegen}
              disabled={isPending || !soort}
              className="h-11 px-4 rounded-xl flex items-center gap-1.5 text-white font-bold text-[13.5px] transition-opacity active:scale-95 disabled:opacity-50"
              style={{ background: 'var(--primary)' }}
            >
              <span className="ms text-[18px]" aria-hidden="true">add</span>
              {t.analysis.addTegendoelpunt}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

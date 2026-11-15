'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ZELFREVIEW_MEENEEM_MAX,
  ZELFREVIEW_SCORE_MAX,
  ZELFREVIEW_SCORE_MIN,
  ZELFREVIEW_STELLINGEN,
  type ZelfreviewScores,
  type ZelfreviewStelling,
  type ZelfreviewWaarden,
} from '@/lib/trainer-zelfreview'
import { saveTrainerZelfreview } from '@/app/actions/trainer-zelfreview'
import { useDict } from '@/lib/i18n-context'
import Button from '@/components/ui/Button'

// Privé zelfreview van de trainer na een gehouden training: vijf stellingen met
// een score 1-5 plus een optioneel "Wat neem ik mee?". Bewust géén autosave en
// geen optimistische weergave: de trainer bevestigt met één knop, en bij een
// fout blijven de ingevulde waarden staan. Staten in volgorde: bronFout →
// toekomst → alleen-lezen → formulier.

const MELDING_KLASSE = 'bg-panel-red border border-panel-red-edge text-panel-red-ink text-xs px-4 py-2.5 rounded-xl'
const TEKENTELLER_VANAF = 900
const SCORES = Array.from(
  { length: ZELFREVIEW_SCORE_MAX - ZELFREVIEW_SCORE_MIN + 1 },
  (_, i) => ZELFREVIEW_SCORE_MIN + i,
)

type Invoer = Partial<ZelfreviewScores>

export default function TrainerZelfreviewSectie({
  eventId, initial, canEdit, trainingGehouden, bronFout,
}: {
  eventId: string
  initial: ZelfreviewWaarden | null
  canEdit: boolean
  trainingGehouden: boolean
  bronFout: boolean
}) {
  const t = useDict()
  const e = t.event
  const router = useRouter()
  const headingId = useId()
  const meeneemId = useId()
  const meldingId = useId()
  const [isPending, startTransition] = useTransition()

  const [scores, setScores] = useState<Invoer>(initial?.scores ?? {})
  const [meeneem, setMeeneem] = useState(initial?.meeneem ?? '')
  const [dirty, setDirty] = useState(false)
  const [ontbreekt, setOntbreekt] = useState(false)
  const [fout, setFout] = useState(false)
  const [klaar, setKlaar] = useState(false)
  const eersteKnop = useRef<Partial<Record<ZelfreviewStelling, HTMLButtonElement | null>>>({})

  // Prop→state-sync na router.refresh() (zelfde patroon als KeuzeBlok in
  // TrainingEvaluatieSectie), maar nooit over wat de trainer net typt.
  const initialSleutel = JSON.stringify(initial)
  const [vorigeSleutel, setVorigeSleutel] = useState(initialSleutel)
  if (vorigeSleutel !== initialSleutel) {
    setVorigeSleutel(initialSleutel)
    if (!dirty) {
      setScores(initial?.scores ?? {})
      setMeeneem(initial?.meeneem ?? '')
    }
  }

  useEffect(() => {
    if (!klaar) return
    const id = setTimeout(() => setKlaar(false), 2000)
    return () => clearTimeout(id)
  }, [klaar])

  function kies(stelling: ZelfreviewStelling, score: number) {
    if (isPending) return
    setScores((s) => ({ ...s, [stelling]: score }))
    setDirty(true)
    setKlaar(false)
    setFout(false)
    // De melding "ontbreekt" verdwijnt pas als alles is ingevuld.
    if (ontbreekt && ZELFREVIEW_STELLINGEN.every((st) => st === stelling || scores[st] !== undefined)) {
      setOntbreekt(false)
    }
  }

  function opslaan() {
    if (isPending) return
    const eerstLeeg = ZELFREVIEW_STELLINGEN.find((s) => scores[s] === undefined)
    if (eerstLeeg) {
      setOntbreekt(true)
      setKlaar(false)
      eersteKnop.current[eerstLeeg]?.focus()
      return
    }
    setOntbreekt(false)
    setFout(false)
    setKlaar(false)
    const volledig = scores as ZelfreviewScores
    const tekst = meeneem.trim()
    startTransition(async () => {
      try {
        await saveTrainerZelfreview(eventId, { scores: volledig, meeneem: tekst === '' ? null : tekst })
        setDirty(false)
        setKlaar(true)
        router.refresh()
      } catch {
        setFout(true)
      }
    })
  }

  const scoreLabel = (n: number) => e.zelfreviewScoreWaarde.replace('{n}', String(n))
  const stellingen = e.zelfreviewStellingen as Record<ZelfreviewStelling, string>

  let inhoud: React.ReactNode
  if (bronFout) {
    inhoud = (
      <div className="surface-card p-5 text-center">
        <p className="text-faint text-[13px] font-medium">{e.zelfreviewNietBeschikbaar}</p>
      </div>
    )
  } else if (!trainingGehouden) {
    inhoud = (
      <div className="surface-card p-5 text-center">
        <p className="text-faint text-[13px] font-medium">{e.zelfreviewToekomst}</p>
      </div>
    )
  } else if (!canEdit && initial) {
    inhoud = (
      <div className="surface-card p-4 flex flex-col gap-3">
        <p className="text-[12.5px] text-faint">{e.zelfreviewAlleenLezen}</p>
        <dl className="flex flex-col gap-2">
          {ZELFREVIEW_STELLINGEN.map((s) => (
            <div key={s} className="flex items-start justify-between gap-3">
              <dt className="text-[13.5px] text-ink min-w-0">{stellingen[s]}</dt>
              <dd className="text-[13.5px] font-bold text-faint tabular-nums flex-shrink-0">{scoreLabel(initial.scores[s])}</dd>
            </div>
          ))}
        </dl>
        {initial.meeneem && (
          <div className="flex flex-col gap-1">
            <span className="text-[13.5px] font-bold text-ink">{e.zelfreviewMeeneemLabel}</span>
            <p className="text-[13.5px] text-muted whitespace-pre-wrap break-words">{initial.meeneem}</p>
          </div>
        )}
      </div>
    )
  } else {
    inhoud = (
      <div className="surface-card p-4 flex flex-col gap-4">
        {ZELFREVIEW_STELLINGEN.map((stelling, rij) => {
          const labelId = `${headingId}-${stelling}`
          const leeg = ontbreekt && scores[stelling] === undefined
          return (
            <div key={stelling} className="flex flex-col gap-2">
              <span id={labelId} className="text-[13.5px] font-bold text-ink">{stellingen[stelling]}</span>
              <div
                role="group"
                aria-labelledby={labelId}
                aria-describedby={leeg ? meldingId : undefined}
                className="grid grid-cols-5 gap-1.5"
              >
                {SCORES.map((n, index) => {
                  const geselecteerd = scores[stelling] === n
                  return (
                    <div key={n} className="flex flex-col items-center gap-1">
                      <button
                        ref={index === 0 ? (el) => { eersteKnop.current[stelling] = el } : undefined}
                        type="button"
                        aria-pressed={geselecteerd}
                        aria-label={scoreLabel(n)}
                        disabled={isPending}
                        onClick={() => kies(stelling, n)}
                        className={`h-11 w-full rounded-lg font-display text-[16px] font-bold tabular-nums transition-colors active:scale-95 disabled:opacity-50 ${geselecteerd ? 'text-white' : 'bg-surface-sunken text-ink'}`}
                        style={geselecteerd
                          ? { background: 'var(--primary)', border: '1px solid var(--primary)' }
                          : { border: `1px solid ${leeg ? 'var(--danger)' : 'var(--border-soft)'}` }}
                      >
                        {n}
                      </button>
                      {rij === 0 && (index === 0 || index === SCORES.length - 1) && (
                        <span aria-hidden="true" className="text-[10.5px] leading-tight text-faint text-center">
                          {index === 0 ? e.zelfreviewSchaalLaag : e.zelfreviewSchaalHoog}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div style={{ borderTop: '1px solid var(--border-soft)' }} />

        <div className="flex flex-col gap-2">
          <label htmlFor={meeneemId} className="text-[13.5px] font-bold text-ink">{e.zelfreviewMeeneemLabel}</label>
          <textarea
            id={meeneemId}
            rows={3}
            value={meeneem}
            maxLength={ZELFREVIEW_MEENEEM_MAX}
            disabled={isPending}
            onChange={(ev) => { setMeeneem(ev.target.value); setDirty(true); setKlaar(false); setFout(false) }}
            className="w-full px-3 py-2.5 rounded-xl border border-[var(--border-soft)] focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30 text-ink placeholder-faint resize-none text-sm disabled:opacity-70"
          />
          <div aria-live="polite" className="min-h-[16px] text-right text-[11.5px] text-faint tabular-nums">
            {meeneem.length >= TEKENTELLER_VANAF ? e.zelfreviewTekens.replace('{n}', String(meeneem.length)) : null}
          </div>
        </div>

        {ontbreekt && <div id={meldingId} role="alert" className={MELDING_KLASSE}>{e.zelfreviewOntbreekt}</div>}
        {fout && <div role="alert" className={MELDING_KLASSE}>{e.zelfreviewOpslaanFout}</div>}

        <div className="flex items-center gap-3">
          <Button onClick={opslaan} disabled={isPending} loading={isPending}>
            {isPending ? e.zelfreviewOpslaanBezig : initial ? e.zelfreviewBijwerken : e.zelfreviewOpslaan}
          </Button>
          <div role="status" className="min-h-[18px] text-[12.5px] font-bold text-brand-accent">
            {klaar ? t.analysis.saved : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section id="mijn-zelfreview" aria-label={e.zelfreviewTitel} className="flex flex-col gap-2 scroll-mt-20">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-[17px] font-bold text-ink">{e.zelfreviewTitel}</h2>
          <span className="text-[11px] font-bold px-2 py-[2px] rounded-full bg-surface-sunken text-faint">{e.zelfreviewPrive}</span>
        </div>
        <p className="text-[12.5px] text-faint">{e.zelfreviewUitleg}</p>
      </div>
      {inhoud}
    </section>
  )
}

'use client'

import { useRef, useState } from 'react'
import { useOpslagTransition } from '@/lib/opslag-wachtrij'
import Link from 'next/link'
import { toggleSquadPlayer } from '@/app/actions/match-squad'
import { updateGatherTime } from '@/app/actions/events'
import { Player, POSITION_ABBREVIATIONS, type AttendanceStatus } from '@/lib/types'
import { groepeerSelectie, type RecenteMinuten } from '@/lib/wedstrijd-selectie-info'
import type { MatchFormItem } from '@/lib/match-form'
import { useDict } from '@/lib/i18n-context'
import PrintButton from '@/components/PrintButton'
import MatchSquadPrintList from '@/components/MatchSquadPrintList'
import GatherTimeField from '@/components/GatherTimeField'

interface Props {
  eventId: string
  players: Player[]
  initialSelectedIds: string[]
  // Aanwezigheidsstatus per zichtbare speler (key = elke player.id in
  // `players`); een ontbrekende key telt als 'unknown'. Alleen voor het
  // scherm: de print-lijst krijgt hier niets van (AC20).
  statusPerSpeler: Record<string, AttendanceStatus>
  // Speelminuten van de laatste ≤3 eerdere wedstrijden; null = niet te laden.
  recenteMinuten: RecenteMinuten | null
  hasAnyActivePlayers: boolean
  opponent: string | null
  dateLabel: string
  // Kale YYYY-MM-DD van de wedstrijd; alleen voor de bestandsnaam van de PDF.
  eventDate: string
  teamName: string | null
  teamLogoUrl: string | null
  // Inline literal union i.p.v. het `HomeAway`-type — dit component geeft de
  // waarde uitsluitend door aan MatchSquadPrintList (zie de importbeperking
  // daar), en trekt dat principe hier door voor de props die er rechtstreeks
  // naartoe stromen.
  homeAway: 'home' | 'away' | null
  kickoffTime: string | null
  // Locatie voor de infoband op de print — kale string, puur doorgegeven.
  location: string | null
  initialGatherTime: string | null
  formItems: MatchFormItem[]
  // Kale strings, puur doorgegeven aan MatchSquadPrintList — geen state, geen
  // logica hier.
  primaryColor: string
  secondaryColor: string
  // Serverzijdig gewaarborgde accent-tekstkleur op wit (lib/club-colors.ts:
  // readableAccentOnWhite). Optioneel, zodat bestaande aanroepen en
  // testharnassen ongewijzigd blijven werken.
  accentText?: string
  // Wedstrijd-recht: bepaalt zowel de spelerselectie als de verzameltijd
  // (die laatste valt sinds addendum §8.8 onder wedstrijd, niet agenda).
  canEdit: boolean
}

export default function MatchSquadEditor({
  eventId,
  players,
  initialSelectedIds,
  statusPerSpeler,
  recenteMinuten,
  hasAnyActivePlayers,
  opponent,
  dateLabel,
  eventDate,
  teamName,
  teamLogoUrl,
  homeAway,
  kickoffTime,
  location,
  initialGatherTime,
  formItems,
  primaryColor,
  secondaryColor,
  accentText,
  canEdit,
}: Props) {
  const [selected, setSelected] = useState(() => new Set(initialSelectedIds))
  const [isPending, startTransition] = useOpslagTransition()
  const [saveError, setSaveError] = useState<string | null>(null)
  const t = useDict()

  // Groepen op het scherm (in invoervolgorde): aanwezig, nog geen reactie,
  // afwezig/geblesseerd/inactief. Alleen weergave: toggle en selectie kennen
  // geen groepen.
  const groepen = groepeerSelectie(players, (p) => statusPerSpeler[p.id] ?? 'unknown')
  // De afwezig-groep is standaard dicht, behalve als er al een geselecteerde
  // speler in zit (AC16). Lokale state met onToggle-sync, bewust GEEN
  // `open={groep bevat geselecteerd}`: dat klapt dicht zodra je de laatste
  // geselecteerde speler uit de groep haalt.
  const [afwezigOpen, setAfwezigOpen] = useState(() => {
    const start = new Set(initialSelectedIds)
    return groepeerSelectie(players, (p) => statusPerSpeler[p.id] ?? 'unknown').afwezig.some((p) => start.has(p.id))
  })
  // Datumkoppen van de minutenkolommen: kale YYYY-MM-DD, daarom in UTC
  // opmaken (anders schuift de dag in tijdzones achter UTC).
  const datumFormatter = new Intl.DateTimeFormat(t.browserLocale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
  const kolommen = (recenteMinuten?.wedstrijden ?? []).map((w) => ({
    id: w.id,
    datum: datumFormatter.format(new Date(`${w.date}T00:00:00Z`)),
  }))

  // Laatst bevestigde (succesvol opgeslagen) selectie. Bij een mislukte
  // toggle draaien we terug naar DEZE referentie — niet naar een snapshot uit
  // de handler-closure — zodat een rollback ook correct blijft als meerdere
  // togglet worden weggeschreven vóór er één faalt. Zelfde patroon als
  // TeamIndelingEditor.tsx (lastConfirmedRef).
  const lastConfirmedRef = useRef<Set<string>>(new Set(initialSelectedIds))

  // Verzameltijd: exact hetzelfde optimistische/rollback-patroon als de
  // selectie-toggle hierboven, maar losstaand (eigen pending/error-state) —
  // een mislukte tijd-save mag de spelerselectie niet blokkeren en andersom.
  const [gatherTime, setGatherTime] = useState<string | null>(initialGatherTime)
  const [gatherPending, startGatherTransition] = useOpslagTransition()
  const [gatherError, setGatherError] = useState<string | null>(null)
  const lastConfirmedGatherRef = useRef<string | null>(initialGatherTime)

  function saveGatherTime(next: string | null) {
    setGatherTime(next)
    setGatherError(null)
    startGatherTransition(async () => {
      try {
        await updateGatherTime(eventId, next)
        lastConfirmedGatherRef.current = next
      } catch {
        setGatherTime(lastConfirmedGatherRef.current)
        setGatherError(t.matchSquad.gatherTimeSaveError)
      }
    })
  }

  function toggle(playerId: string) {
    const next = !selected.has(playerId)
    // Optimistische state-update; bij een falende server action rollen we
    // hieronder terug naar lastConfirmedRef.
    setSelected((s) => {
      const copy = new Set(s)
      if (next) copy.add(playerId)
      else copy.delete(playerId)
      return copy
    })
    setSaveError(null)
    startTransition(async () => {
      try {
        await toggleSquadPlayer(eventId, playerId, next)
        // Geslaagd: dit is nu de laatst bevestigde selectie.
        const confirmed = new Set(lastConfirmedRef.current)
        if (next) confirmed.add(playerId)
        else confirmed.delete(playerId)
        lastConfirmedRef.current = confirmed
      } catch {
        // Opslaan mislukt: draai de optimistische state terug naar de laatst
        // bekende opgeslagen selectie en meld het via een eigen i18n-string —
        // nooit de rauwe (server-)foutmelding aan de gebruiker tonen.
        setSelected(lastConfirmedRef.current)
        setSaveError(t.matchSquad.saveError)
      }
    })
  }

  // Statuslabel op regel 2: inactief weegt zwaarder dan de eventstatus (een
  // speler toont nooit beide tegelijk).
  function statusLabel(player: Player): string {
    if (!player.active) return t.players.inactiveLabel
    switch (statusPerSpeler[player.id] ?? 'unknown') {
      case 'present': return t.event.presentStat
      case 'absent': return t.event.absentStat
      case 'injured': return t.event.injuredStat
      default: return t.matchSquad.geenReactieLabel
    }
  }

  function renderRij(player: Player, i: number) {
    const isSelected = selected.has(player.id)
    const minuten = recenteMinuten?.perSpeler[player.id]
    return (
      <div key={player.id} className="flex items-center justify-between gap-3 px-4 py-2.5"
        style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold text-ink break-words">
            {player.name}
            {player.type === 'guest' && (
              <span className="ml-2 text-[11px] font-semibold text-faint">({t.players.guestBadge})</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-faint">
            <span>{POSITION_ABBREVIATIONS[player.position] ?? '–'} · {statusLabel(player)}</span>
            {player.injured && (
              <span className="rounded-full bg-panel-red text-panel-red-ink text-[10.5px] font-bold px-1.5">{t.players.injuredBadge}</span>
            )}
          </div>
        </div>
        {kolommen.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {kolommen.map((k, idx) => {
              const waarde = minuten?.[idx] ?? null
              return (
                <span key={k.id} className="w-8 text-right tabular-nums text-[12.5px] font-semibold">
                  <span aria-hidden="true" className={waarde === null ? 'text-faint' : 'text-ink'}>{waarde ?? '–'}</span>
                  <span className="sr-only">
                    {waarde === null
                      ? t.matchSquad.minutenGeenSr.replace('{datum}', k.datum)
                      : t.matchSquad.minutenSr.replace('{minuten}', String(waarde)).replace('{datum}', k.datum)}
                  </span>
                </span>
              )
            })}
          </div>
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => toggle(player.id)}
            disabled={isPending}
            aria-pressed={isSelected}
            aria-label={`${t.matchSquad.toggleLabel}: ${player.name}`}
            className="relative hit-slop w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-60"
            style={isSelected
              ? { background: 'var(--primary)', color: '#fff' }
              : { background: 'var(--surface-sunken)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}
          >
            <span className="ms text-[18px]">{isSelected ? 'check' : 'add'}</span>
          </button>
        ) : (
          // Read-only: alleen de huidige selectiestatus, geen knop.
          <span
            aria-label={`${t.matchSquad.toggleLabel}: ${player.name}`}
            className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={isSelected
              ? { background: 'var(--primary)', color: '#fff' }
              : { background: 'var(--surface-sunken)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}
          >
            <span className="ms text-[18px]">{isSelected ? 'check' : 'remove'}</span>
          </span>
        )}
      </div>
    )
  }

  if (players.length === 0) {
    // Twee wezenlijk verschillende lege staten: geen (actieve) spelers in het
    // team vs. wel spelers maar niemand voor dit event als aanwezig gemeld.
    // Doorverwijzen naar "speler toevoegen" in het tweede geval zou de
    // trainer op het verkeerde been zetten.
    if (!hasAnyActivePlayers) {
      return (
        <div className="surface-card p-6 text-center">
          <p className="text-faint text-sm mb-2">{t.matchSquad.emptyTeam}</p>
          <p className="text-faint text-sm">
            <Link href="/players/new" className="text-brand-accent font-bold">{t.players.add}</Link>
          </p>
        </div>
      )
    }
    return (
      <div className="surface-card p-6 text-center">
        <p className="text-faint text-sm mb-2">{t.matchSquad.emptyNoAttendance}</p>
        <p className="text-faint text-sm">
          <Link href={`/events/${eventId}`} className="text-brand-accent font-bold">{t.matchSquad.emptyNoAttendanceLink}</Link>
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="print:hidden flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-[17px] font-bold text-ink">
            {t.matchSquad.selectedCount.replace('{n}', String(selected.size))}
          </span>
          <PrintButton disabled={selected.size === 0} pdf={{ doel: 'selectie', eventId, datum: eventDate }} />
        </div>
        {selected.size === 0 && (
          <p className="text-[13px] font-semibold text-faint">{t.matchSquad.emptyExportHint}</p>
        )}

        {saveError && (
          <p className="text-xs text-panel-red-ink bg-panel-red border border-panel-red-edge rounded-lg px-2 py-1">
            {saveError}
          </p>
        )}

        <GatherTimeField
          value={gatherTime}
          onChange={saveGatherTime}
          isPending={gatherPending}
          error={gatherError}
          canEdit={canEdit}
        />

        {recenteMinuten === null && (
          <p className="text-[12px] font-semibold text-faint">{t.matchSquad.minutenFout}</p>
        )}

        {/* Minutenkop: één kop boven alle groepen, met de drie datums
            uitgelijnd op de minutenkolommen van de rijen (rechts, vóór de
            toggle-ruimte). De transparante rand spiegelt de 1px rand van
            surface-card, flex justify-end laat een te brede datum naar links
            overlopen i.p.v. de kolom naar rechts te schuiven. Zonder eerdere wedstrijden geen kolommen. */}
        {kolommen.length > 0 && (
          <div className="flex items-center gap-3 px-4 -mb-2 border border-transparent">
            <span className="min-w-0 flex-1 break-words text-[11px] font-extrabold uppercase tracking-wider text-faint">
              {t.matchSquad.minutenKop}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {kolommen.map((k) => (
                <span key={k.id} className="w-8 flex-shrink-0 flex justify-end tabular-nums whitespace-nowrap text-[10.5px] font-bold text-faint">{k.datum}</span>
              ))}
            </div>
            <span aria-hidden="true" className="w-9 flex-shrink-0" />
          </div>
        )}

        <section aria-labelledby="selectie-groep-aanwezig" className="flex flex-col gap-2">
          <h2 id="selectie-groep-aanwezig" className="text-[13px] font-bold text-muted">
            {t.matchSquad.groepAanwezig.replace('{n}', String(groepen.aanwezig.length))}
          </h2>
          {groepen.aanwezig.length > 0 ? (
            <div className="surface-card overflow-hidden">{groepen.aanwezig.map(renderRij)}</div>
          ) : (
            <div className="surface-card p-4 text-center">
              <p className="text-faint text-sm mb-1">{t.matchSquad.geenAanwezigen}</p>
              <p className="text-faint text-sm">
                <Link href={`/events/${eventId}`} className="text-brand-accent font-bold">{t.matchSquad.emptyNoAttendanceLink}</Link>
              </p>
            </div>
          )}
        </section>

        {groepen.geenReactie.length > 0 && (
          <section aria-labelledby="selectie-groep-geen-reactie" className="flex flex-col gap-2">
            <h2 id="selectie-groep-geen-reactie" className="text-[13px] font-bold text-muted">
              {t.matchSquad.groepGeenReactie.replace('{n}', String(groepen.geenReactie.length))}
            </h2>
            <div className="surface-card overflow-hidden">{groepen.geenReactie.map(renderRij)}</div>
          </section>
        )}

        {groepen.afwezig.length > 0 && (
          <details open={afwezigOpen} onToggle={(e) => setAfwezigOpen(e.currentTarget.open)} className="flex flex-col gap-2">
            <summary className="min-h-11 flex items-center cursor-pointer text-[13px] font-bold text-muted">
              {t.matchSquad.groepAfwezig.replace('{n}', String(groepen.afwezig.length))}
            </summary>
            <div className="surface-card overflow-hidden">{groepen.afwezig.map(renderRij)}</div>
          </details>
        )}
      </div>

      {/* Print-only, gevoed door dezelfde live `selected`-state (niet door de
          server component) zodat de afdruk altijd de actuele, nog niet
          gerevalideerde selectie toont. */}
      <MatchSquadPrintList
        players={players.filter((p) => selected.has(p.id))}
        opponent={opponent}
        dateLabel={dateLabel}
        teamName={teamName}
        teamLogoUrl={teamLogoUrl}
        homeAway={homeAway}
        gatherTime={gatherTime}
        kickoffTime={kickoffTime}
        location={location}
        selectedCount={selected.size}
        formItems={formItems}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        accentText={accentText}
      />
    </>
  )
}

'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { toggleSquadPlayer } from '@/app/actions/match-squad'
import { Player } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'
import PrintButton from '@/components/PrintButton'
import MatchSquadPrintList from '@/components/MatchSquadPrintList'

interface Props {
  eventId: string
  players: Player[]
  initialSelectedIds: string[]
  presentPlayerIds: string[]
  hasAnyActivePlayers: boolean
  opponent: string | null
  dateLabel: string
}

export default function MatchSquadEditor({ eventId, players, initialSelectedIds, presentPlayerIds, hasAnyActivePlayers, opponent, dateLabel }: Props) {
  const [selected, setSelected] = useState(() => new Set(initialSelectedIds))
  // Zuiver een zichtbaarheidsfilter (zie page.tsx): welke spelers voor dit
  // event als aanwezig geregistreerd staan. Geen koppeling met match_squad
  // zelf — enkel gebruikt om een niet-aanwezige, al-geselecteerde speler een
  // duidelijk label te geven i.p.v. hem stilzwijgend te verbergen.
  const presentIds = new Set(presentPlayerIds)
  const [isPending, startTransition] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)
  const t = useDict()

  // Laatst bevestigde (succesvol opgeslagen) selectie. Bij een mislukte
  // toggle draaien we terug naar DEZE referentie — niet naar een snapshot uit
  // de handler-closure — zodat een rollback ook correct blijft als meerdere
  // togglet worden weggeschreven vóór er één faalt. Zelfde patroon als
  // TeamIndelingEditor.tsx (lastConfirmedRef).
  const lastConfirmedRef = useRef<Set<string>>(new Set(initialSelectedIds))

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
          <PrintButton disabled={selected.size === 0} />
        </div>
        {selected.size === 0 && (
          <p className="text-[13px] font-semibold text-faint">{t.matchSquad.emptyExportHint}</p>
        )}

        {saveError && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
            {saveError}
          </p>
        )}

        <div className="surface-card overflow-hidden">
          {players.map((player, i) => {
            const isSelected = selected.has(player.id)
            return (
              <div key={player.id} className="flex items-center justify-between gap-3 px-4 py-2.5"
                style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
                <span className="text-[14.5px] font-bold text-ink truncate">
                  {player.name}
                  {/* Eén label tegelijk: inactief weegt zwaarder dan niet-aanwezig
                      (zie page.tsx-comment) — een speler is nooit allebei tegelijk
                      zichtbaar, dat zou verwarrend zijn. */}
                  {!player.active ? (
                    <span className="ml-2 text-[11px] font-semibold text-faint">({t.players.inactiveLabel})</span>
                  ) : !presentIds.has(player.id) ? (
                    <span className="ml-2 text-[11px] font-semibold text-faint">({t.matchSquad.notPresentLabel})</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(player.id)}
                  disabled={isPending}
                  aria-pressed={isSelected}
                  aria-label={`${t.matchSquad.toggleLabel}: ${player.name}`}
                  className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-60"
                  style={isSelected
                    ? { background: 'var(--primary)', color: '#fff' }
                    : { background: 'var(--surface-sunken)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}
                >
                  <span className="ms text-[18px]">{isSelected ? 'check' : 'add'}</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Print-only, gevoed door dezelfde live `selected`-state (niet door de
          server component) zodat de afdruk altijd de actuele, nog niet
          gerevalideerde selectie toont. */}
      <MatchSquadPrintList
        players={players.filter((p) => selected.has(p.id))}
        opponent={opponent}
        dateLabel={dateLabel}
      />
    </>
  )
}

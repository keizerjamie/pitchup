'use client'

import { useState } from 'react'
import type { Dict } from '@/messages/nl'
import type { AbsencePeriod, AttendanceStatus, FootballEvent, Player } from '@/lib/types'
import type { SpelerStatistieken } from '@/lib/inzichten'
import { PROFIEL_TABS, type ProfielTab } from '@/lib/player-profile'
import PlayerProfileHeader from './PlayerProfileHeader'
import PlayerProfileActions from './PlayerProfileActions'
import PlayerInfoTab from './PlayerInfoTab'
import PlayerStatsTab from './PlayerStatsTab'
import PlayerAbsenceList from '@/components/PlayerAbsenceList'

interface EventWithStatus extends FootballEvent {
  status: AttendanceStatus
}

type PeriodRange = Pick<AbsencePeriod, 'id' | 'player_id' | 'from_date' | 'to_date'>

interface Props {
  player: Player
  initialTab: ProfielTab
  events: EventWithStatus[]
  periods: PeriodRange[]
  defaultStatus: 'present' | 'unknown'
  stats: SpelerStatistieken | null
  // true = getSpelerStatistieken is gegooid (bv. GENERIC_ERROR_MESSAGE bij een
  // RPC-/DB-fout). Losgetrokken van `stats === null`, dat uitsluitend "geen
  // seizoen ingesteld" betekent — een fout mag daar niet mee verward worden
  // (validator-bevinding, zie PlayerStatsTab.tsx).
  statsError: boolean
  t: Dict
  canEditSpelers: boolean
  canEditAanwezigheid: boolean
}

const TAB_LABEL_KEY: Record<ProfielTab, keyof Pick<Dict['players'], 'profileTabInfo' | 'profileTabAttendance' | 'profileTabStats'>> = {
  info: 'profileTabInfo',
  aanwezigheid: 'profileTabAttendance',
  statistieken: 'profileTabStats',
}

// Client-parent: houdt de actieve tab bij. Bewust GEEN URL-sync bij het
// wisselen — `?tab=` is uitsluitend de startwaarde (amendement 3 / brief §4.3).
export default function PlayerProfile({ player, initialTab, events, periods, defaultStatus, stats, statsError, t, canEditSpelers, canEditAanwezigheid }: Props) {
  const [tab, setTab] = useState<ProfielTab>(initialTab)

  const excludedHint = player.type === 'guest' || !player.active

  return (
    <div className="flex flex-col">
      <PlayerProfileHeader player={player} t={t} />

      <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-5 lg:py-8 w-full flex flex-col gap-4">
        <PlayerProfileActions
          player={player}
          t={t}
          onSignOff={() => setTab('aanwezigheid')}
          canEditSpelers={canEditSpelers}
          canEditAanwezigheid={canEditAanwezigheid}
        />

        <div
          role="group"
          aria-label={t.players.profileTabsAria}
          className="bg-surface-sunken rounded-xl p-1 border border-[var(--border-soft)] flex gap-1"
        >
          {PROFIEL_TABS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-[background-color,color] duration-[160ms] ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light ${
                tab === key ? 'text-white shadow-sm' : 'text-muted'
              }`}
              style={tab === key ? { background: 'var(--primary)' } : undefined}
            >
              {t.players[TAB_LABEL_KEY[key]]}
            </button>
          ))}
        </div>

        {tab === 'info' && <PlayerInfoTab player={player} t={t} />}

        {tab === 'aanwezigheid' && (
          <div className="surface-card p-5">
            <h2 className="font-semibold text-ink mb-1">{t.players.attendanceTitle}</h2>
            <p className="text-sm text-muted mb-4">{t.players.attendanceHint}</p>
            <PlayerAbsenceList
              playerId={player.id}
              events={events}
              periods={periods}
              defaultStatus={defaultStatus}
              canEdit={canEditAanwezigheid}
            />
          </div>
        )}

        {tab === 'statistieken' && <PlayerStatsTab stats={stats} statsError={statsError} excludedHint={excludedHint} t={t} />}
      </div>
    </div>
  )
}

'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { MatchEvent, MatchEventKind, MatchRating, Player, HomeAway, MATCH_EVENT_KINDS, POSITION_ABBREVIATIONS } from '@/lib/types'
import { saveMatchResult, saveMatchRating, addMatchEvent, deleteMatchEvent } from '@/app/actions/match-analysis'
import { goalsSum } from '@/lib/match-analysis.mjs'
import { useDict } from '@/lib/i18n-context'

const AVATAR_BG = ['#16a34a', '#14655c', '#0d3d38', '#1a6b63', '#0f766e', '#15803d']
function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return '?'
  return (w.length >= 2 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase()
}
function avatarBg(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]
}

interface Props {
  eventId: string
  presentPlayers: Player[]
  teamName: string | null
  opponent: string | null
  homeAway: HomeAway | null
  initialGoalsFor: number | null
  initialGoalsAgainst: number | null
  initialRatings: MatchRating[]
  initialEvents: MatchEvent[]
}

// Colour tokens per event kind. Cards (yellow/red) render as a coloured chip
// instead of a font icon since those glyphs are not in the subset.
const KIND_COLORS: Record<MatchEventKind, string> = {
  goal: '#16a34a',
  assist: '#0f766e',
  yellow: '#eab308',
  red: '#dc2626',
}

function KindIndicator({ kind }: { kind: MatchEventKind }) {
  if (kind === 'yellow' || kind === 'red') {
    return (
      <span
        className="inline-block rounded-[3px] flex-shrink-0"
        style={{ width: 12, height: 16, background: KIND_COLORS[kind] }}
        aria-hidden="true"
      />
    )
  }
  return (
    <span className="ms text-[18px] flex-shrink-0" style={{ color: KIND_COLORS[kind] }} aria-hidden="true">
      {kind === 'goal' ? 'sports_soccer' : 'handshake'}
    </span>
  )
}

export default function MatchAnalysisEditor({
  eventId, presentPlayers, teamName, opponent, homeAway,
  initialGoalsFor, initialGoalsAgainst, initialRatings, initialEvents,
}: Props) {
  const t = useDict()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // ── Result ──
  const [goalsFor, setGoalsFor] = useState<string>(initialGoalsFor != null ? String(initialGoalsFor) : '')
  const [goalsAgainst, setGoalsAgainst] = useState<string>(initialGoalsAgainst != null ? String(initialGoalsAgainst) : '')
  const [resultSaved, setResultSaved] = useState(false)

  // ── Ratings (playerId -> rating|null) ──
  const buildRatingMap = (list: MatchRating[]): Record<string, number | null> => {
    const m: Record<string, number | null> = {}
    for (const r of list) m[r.player_id] = r.rating
    return m
  }
  const [ratings, setRatings] = useState<Record<string, number | null>>(buildRatingMap(initialRatings))
  const [prevRatings, setPrevRatings] = useState(initialRatings)
  if (prevRatings !== initialRatings) {
    setPrevRatings(initialRatings)
    setRatings(buildRatingMap(initialRatings))
  }

  // ── Events ──
  const [events, setEvents] = useState<MatchEvent[]>(initialEvents)
  const [prevEvents, setPrevEvents] = useState(initialEvents)
  if (prevEvents !== initialEvents) {
    setPrevEvents(initialEvents)
    setEvents(initialEvents)
  }

  // ── Add-event form ──
  const [formPlayer, setFormPlayer] = useState<string>('')
  const [formKind, setFormKind] = useState<MatchEventKind>('goal')
  const [formMinute, setFormMinute] = useState<string>('')

  const playerName = (id: string) => presentPlayers.find((p) => p.id === id)?.name ?? '—'

  function parseGoals(v: string): number | null {
    if (v.trim() === '') return null
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? null : n
  }

  function handleSaveResult() {
    const gf = parseGoals(goalsFor)
    const ga = parseGoals(goalsAgainst)
    startTransition(async () => {
      try {
        await saveMatchResult(eventId, gf, ga)
        setResultSaved(true)
        setTimeout(() => setResultSaved(false), 2000)
        router.refresh()
      } catch {
        // revalidate/refresh restores the server truth
      }
    })
  }

  // Ratings update local state instantly and persist debounced (300ms), so rapid
  // +/− taps never fire a save-per-click or a full page refetch. stepRating
  // derives the next value inside the functional updater and mirrors it into a
  // ref, so quick successive taps (which React batches before re-rendering)
  // accumulate correctly instead of all reading one stale closure value.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingRating = useRef<Record<string, number | null>>({})
  function flushSaveRating(playerId: string) {
    clearTimeout(saveTimers.current[playerId])
    saveTimers.current[playerId] = setTimeout(() => {
      saveMatchRating(eventId, playerId, pendingRating.current[playerId] ?? null).catch(() => {})
    }, 300)
  }
  function setRating(playerId: string, rating: number | null) {
    pendingRating.current[playerId] = rating
    setRatings((prev) => ({ ...prev, [playerId]: rating }))
    flushSaveRating(playerId)
  }
  function stepRating(playerId: string, delta: number) {
    setRatings((prev) => {
      const current = prev[playerId] ?? null
      // Empty → start at the neutral default 6; otherwise step ±1 within 1–10.
      const next = current === null ? 6 : Math.min(10, Math.max(1, current + delta))
      pendingRating.current[playerId] = next
      return { ...prev, [playerId]: next }
    })
    flushSaveRating(playerId)
  }
  function onRatingInput(playerId: string, raw: string) {
    if (raw.trim() === '') { setRating(playerId, null); return }
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) return
    setRating(playerId, Math.min(10, Math.max(1, n)))
  }

  function handleAddEvent() {
    if (!formPlayer) return
    const minute = formMinute.trim() === '' ? null : parseInt(formMinute, 10)
    const safeMinute = minute !== null && Number.isNaN(minute) ? null : minute
    startTransition(async () => {
      try {
        await addMatchEvent(eventId, formPlayer, formKind, safeMinute)
        setFormMinute('')
        router.refresh()
      } catch {
        // ignore
      }
    })
  }

  function handleDeleteEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id))
    startTransition(async () => {
      try {
        await deleteMatchEvent(id, eventId)
        router.refresh()
      } catch {
        // ignore
      }
    })
  }

  const gfNum = parseGoals(goalsFor)
  const showSumHint = gfNum !== null && goalsSum(events) !== gfNum

  // Score display: own team is always goals_for, opponent goals_against. Home
  // (or unset → default home) shows own team first; away shows opponent first.
  const ownLabel = teamName?.trim() ? teamName : t.analysis.goalsFor
  const oppLabel = opponent?.trim() ? opponent : t.analysis.goalsAgainst
  const away = homeAway === 'away'
  const scoreInput = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="flex-1 flex flex-col gap-1.5 min-w-0">
      <span className="text-[11px] font-extrabold uppercase tracking-wider text-faint truncate" title={label}>{label}</span>
      <input
        type="number" min={0} max={99} inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleSaveResult}
        disabled={isPending}
        className="w-full text-center px-3 py-2.5 rounded-xl bg-surface-sunken text-ink font-display text-[22px] font-bold focus:outline-none disabled:opacity-60"
        style={{ border: '1px solid var(--border-soft)' }}
      />
    </label>
  )

  if (presentPlayers.length === 0) {
    return (
      <div className="surface-card p-6 text-center">
        <p className="text-faint text-sm font-medium">{t.analysis.noPresent}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Result ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-display text-[17px] font-bold text-ink">{t.analysis.result}</span>
          {resultSaved && <span className="text-[12.5px] font-bold text-brand-accent">{t.analysis.saved}</span>}
        </div>
        <div className="surface-card p-4 flex items-end gap-3">
          {away ? scoreInput(oppLabel, goalsAgainst, setGoalsAgainst) : scoreInput(ownLabel, goalsFor, setGoalsFor)}
          <span className="pb-3 text-faint font-display text-[22px] font-bold">–</span>
          {away ? scoreInput(ownLabel, goalsFor, setGoalsFor) : scoreInput(oppLabel, goalsAgainst, setGoalsAgainst)}
        </div>
      </section>

      {/* ── Ratings ── */}
      <section className="flex flex-col gap-3">
        <span className="font-display text-[17px] font-bold text-ink">{t.analysis.ratings}</span>
        <div className="surface-card overflow-hidden">
          {presentPlayers.map((player, i) => {
            const rating = ratings[player.id] ?? null
            return (
              <div key={player.id} className="flex items-center gap-3 px-4 py-2.5"
                style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold font-display flex-shrink-0"
                  style={{ background: avatarBg(player.name) }} aria-hidden="true">
                  {initialsOf(player.name)}
                </div>
                <div className="flex-1 min-w-0 flex flex-col leading-tight">
                  <span className="text-[14.5px] font-bold text-ink truncate">{player.name}</span>
                  <span className="text-[12px] font-semibold text-faint">
                    {player.jersey_number != null ? `#${player.jersey_number} · ` : ''}
                    {POSITION_ABBREVIATIONS[player.position] ?? player.position}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => stepRating(player.id, -1)}
                    disabled={rating !== null && rating <= 1}
                    aria-label="−"
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-muted font-bold text-xl transition-colors hover:bg-surface-sunken active:scale-95 disabled:opacity-40"
                    style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }}
                  >
                    −
                  </button>
                  <input
                    type="number" min={1} max={10} inputMode="numeric"
                    value={rating ?? ''}
                    placeholder="–"
                    onChange={(e) => onRatingInput(player.id, e.target.value)}
                    aria-label={player.name}
                    className="w-12 h-9 text-center font-display text-[18px] font-bold text-ink tabular-nums rounded-lg bg-surface-sunken focus:outline-none placeholder:text-faint"
                    style={{ border: '1px solid var(--border-soft)' }}
                  />
                  <button
                    type="button"
                    onClick={() => stepRating(player.id, 1)}
                    disabled={rating === 10}
                    aria-label="+"
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-muted font-bold text-xl transition-colors hover:bg-surface-sunken active:scale-95 disabled:opacity-40"
                    style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-soft)' }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setRating(player.id, null)}
                    disabled={rating === null}
                    className="h-9 px-2 rounded-lg text-[12px] font-bold text-muted hover:text-ink transition-colors disabled:opacity-30"
                  >
                    {t.analysis.clearRating}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Events ── */}
      <section className="flex flex-col gap-3">
        <span className="font-display text-[17px] font-bold text-ink">{t.analysis.events}</span>

        {showSumHint && (
          <p className="text-[12.5px] font-semibold px-1" style={{ color: 'var(--chip-amber-fg)' }}>
            {t.analysis.sumHint}
          </p>
        )}

        {/* Existing events */}
        {events.length === 0 ? (
          <div className="surface-card p-5 text-center">
            <p className="text-faint text-[13px] font-medium">{t.analysis.noEvents}</p>
          </div>
        ) : (
          <div className="surface-card overflow-hidden">
            {events.map((ev, i) => (
              <div key={ev.id} className="flex items-center gap-3 px-4 py-2.5"
                style={i > 0 ? { borderTop: '1px solid var(--border-soft)' } : undefined}>
                <KindIndicator kind={ev.kind} />
                <div className="flex-1 min-w-0 flex items-baseline gap-2">
                  <span className="text-[14px] font-bold text-ink truncate">{playerName(ev.player_id)}</span>
                  <span className="text-[12.5px] font-semibold text-faint">{t.analysis.kinds[ev.kind]}</span>
                </div>
                {ev.minute != null && (
                  <span className="text-[12.5px] font-bold text-faint tabular-nums flex-shrink-0">{ev.minute}′</span>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteEvent(ev.id)}
                  disabled={isPending}
                  aria-label={t.analysis.delete}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-faint hover:text-ink transition-colors disabled:opacity-40"
                >
                  <span className="ms text-[20px]">close</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add-event form */}
        <div className="surface-card p-4 flex flex-col gap-3">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-faint">{t.analysis.addEvent}</span>

          <select
            value={formPlayer}
            onChange={(e) => setFormPlayer(e.target.value)}
            disabled={isPending}
            className="w-full px-3 py-2.5 rounded-xl bg-surface-sunken text-ink font-semibold text-[14px] focus:outline-none disabled:opacity-60"
            style={{ border: '1px solid var(--border-soft)' }}
          >
            <option value="">{t.analysis.selectPlayer}</option>
            {presentPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.jersey_number != null ? `#${p.jersey_number} ` : ''}{p.name}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MATCH_EVENT_KINDS.map((kind) => {
              const active = formKind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setFormKind(kind)}
                  aria-pressed={active}
                  className="h-10 rounded-xl px-2 flex items-center justify-center gap-1.5 text-[12.5px] font-bold transition-colors"
                  style={active
                    ? { background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--brand-accent)', border: '1px solid color-mix(in srgb, var(--primary) 45%, var(--border-soft))' }
                    : { background: 'var(--surface-sunken)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}
                >
                  <KindIndicator kind={kind} />
                  <span className="truncate">{t.analysis.kinds[kind]}</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number" min={0} max={130} inputMode="numeric"
              value={formMinute}
              onChange={(e) => setFormMinute(e.target.value)}
              placeholder={t.analysis.minuteOptional}
              disabled={isPending}
              className="flex-1 px-3 py-2.5 rounded-xl bg-surface-sunken text-ink font-semibold text-[14px] placeholder:text-faint focus:outline-none disabled:opacity-60"
              style={{ border: '1px solid var(--border-soft)' }}
            />
            <button
              type="button"
              onClick={handleAddEvent}
              disabled={isPending || !formPlayer}
              className="h-11 px-4 rounded-xl flex items-center gap-1.5 text-white font-bold text-[13.5px] transition-opacity active:scale-95 disabled:opacity-50"
              style={{ background: 'var(--primary)' }}
            >
              <span className="ms text-[18px]">add</span>
              {t.analysis.addEvent}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

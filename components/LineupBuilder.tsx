'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { saveLineup } from '@/app/actions/attendance'
import { Player, LineupPosition, FORMATIONS, POSITION_ABBREVIATIONS, POSITION_LABEL_MAP } from '@/lib/types'
import { useDict } from '@/lib/i18n-context'
import { emptyPlayerForm, isGeldigeRating, type PlayerForm } from '@/lib/lineup-form'
import type { KitColors } from '@/lib/club-colors'
import { useReducedMotion } from '@/lib/use-reduced-motion'

// Hoe lang de inslag-state blijft staan. Moet minstens zo lang zijn als de
// langste keyframe-animatie in app/globals.css (poppetje-schokgolf, 620ms),
// anders verdwijnt de ring halverwege uit de DOM.
const IMPACT_DUUR_MS = 700

const POSITION_FALLBACKS: Record<string, string[]> = {
  'Keeper': [],
  'Linksachter': ['Centrale verdediger', 'Rechtsachter', 'Defensieve middenvelder', 'Linksmiddenvelder'],
  'Centrale verdediger': ['Linksachter', 'Rechtsachter', 'Defensieve middenvelder'],
  'Rechtsachter': ['Centrale verdediger', 'Linksachter', 'Defensieve middenvelder', 'Rechtsmiddenvelder'],
  'Defensieve middenvelder': ['Centrale middenvelder', 'Centrale verdediger', 'Linksachter', 'Rechtsachter'],
  'Centrale middenvelder': ['Defensieve middenvelder', 'Aanvallende middenvelder', 'Linksmiddenvelder', 'Rechtsmiddenvelder'],
  'Linksmiddenvelder': ['Centrale middenvelder', 'Linksbuiten', 'Linksachter'],
  'Rechtsmiddenvelder': ['Centrale middenvelder', 'Rechtsbuiten', 'Rechtsachter'],
  'Aanvallende middenvelder': ['Centrale middenvelder', 'Spits', 'Linksbuiten', 'Rechtsbuiten'],
  'Linksbuiten': ['Linksmiddenvelder', 'Spits', 'Aanvallende middenvelder', 'Rechtsbuiten'],
  'Rechtsbuiten': ['Rechtsmiddenvelder', 'Spits', 'Aanvallende middenvelder', 'Linksbuiten'],
  'Spits': ['Aanvallende middenvelder', 'Linksbuiten', 'Rechtsbuiten'],
}

function getFitScore(player: Player, preferredPos: string): number {
  const isKeeperSlot = preferredPos === 'Keeper'
  const isKeeper = player.position === 'Keeper'
  const secPos = (player.secondary_positions ?? []) as string[]
  if (isKeeperSlot) return isKeeper ? 1.0 : secPos.includes('Keeper') ? 0.85 : 0
  if (isKeeper) return 0
  if (player.position === preferredPos) return 1.0
  if (secPos.includes(preferredPos)) return 0.85
  const fallbacks = POSITION_FALLBACKS[preferredPos] ?? []
  const primaryIdx = fallbacks.indexOf(player.position)
  if (primaryIdx >= 0) return Math.max(0.2, 0.65 - primaryIdx * 0.1)
  for (let i = 0; i < fallbacks.length; i++) {
    if (secPos.includes(fallbacks[i])) return Math.max(0.15, 0.60 - i * 0.1)
  }
  return 0
}

interface Props {
  eventId: string
  players: Player[]
  // Wie voor DEZE wedstrijd inzetbaar is: de wedstrijdselectie (match_squad)
  // zodra die gekozen is, anders de aanwezige spelers. De pagina beslist welke
  // van de twee — dit component kent het onderscheid bewust niet, het krijgt
  // één afgeronde lijst. Bepaalt zowel de bank als de keuzelijst per positie
  // als de pool van "automatisch opstellen". Ontbreekt de prop, dan is
  // iedereen inzetbaar (het gedrag van vóór deze wijziging).
  eligiblePlayerIds?: string[]
  // Clubtenue voor de bezette poppetjes; null = geen clubkleur gekozen, dan
  // blijven ze wit. Serverzijdig geresolved (lib/club-colors.ts,
  // resolveKitColors), zodat dit component nooit hoeft te beslissen wat
  // "niet ingesteld" betekent.
  kit?: KitColors | null
  initialFormation?: string
  initialPositions?: LineupPosition[]
  // Verplicht: enige bron voor ranking én auto-opstellen (zie rankScore
  // hieronder). Key = player.id; elke speler in `players` heeft een entry.
  playerForm: Record<string, PlayerForm>
}

export default function LineupBuilder({ eventId, players, eligiblePlayerIds, kit = null, initialFormation = '4-3-3', initialPositions, playerForm }: Props) {
  const t = useDict()

  // Eén gedeelde kwaliteitsfunctie voor ranking én auto-opstellen, zodat de
  // popup en de auto-opstelling gegarandeerd dezelfde score gebruiken.
  function formOf(p: Player): PlayerForm {
    return playerForm[p.id] ?? emptyPlayerForm(p.rating)
  }
  // `fit` is optioneel: de aanroeper mag een al berekende `getFitScore`
  // meegeven om dubbel rekenwerk te vermijden (zie autoFillLineup). Zonder
  // argument berekent rankScore hem zelf (zie de popup-ranking). Er blijft zo
  // precies één formule, ongeacht welke kant hem aanroept.
  function rankScore(p: Player, pos: string, fit: number = getFitScore(p, pos)): number {
    return fit * formOf(p).quality
  }

  // Bewuste afwijking van components/inzichten/TopWorstRatings.tsx:5-7 (die
  // kiest expliciet voor puntnotatie): het acceptatiecriterium schrijft hier
  // komma-notatie voor ("7,4"), dus deze popup gebruikt bewust wél de locale
  // notatie. Eén keer aangemaakt (niet per rij).
  const qualityFormatter = useMemo(
    () => new Intl.NumberFormat(t.browserLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [t.browserLocale],
  )
  const [formation, setFormation] = useState(FORMATIONS[initialFormation] ? initialFormation : '4-3-3')
  const [positions, setPositions] = useState<LineupPosition[]>(() => {
    if (initialPositions && initialPositions.length > 0) return initialPositions
    const base = FORMATIONS[initialFormation] ?? FORMATIONS['4-3-3']
    return base.positions.map((p) => ({ ...p, player_id: null }))
  })
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [formationOpen, setFormationOpen] = useState(false)

  // "Inslag": het slot waar zojuist een speler in is gezet. `nonce` maakt elke
  // plaatsing uniek, zodat twee keer achter elkaar hetzelfde slot vullen de
  // animatie opnieuw start (via de key op het poppetje) in plaats van hem stil
  // over te slaan.
  const [impact, setImpact] = useState<{ slot: number; nonce: number } | null>(null)
  const reducedMotion = useReducedMotion()

  // Het opruimen van de inslag hangt aan de state zelf, niet aan een timer-ref
  // in de klikhandler: elke nieuwe `impact` (ook dezelfde slot met een hogere
  // nonce) ruimt de vorige timer op via de cleanup, en unmount doet dat ook.
  // Een ref lezen/schrijven vanuit een handler die in de render-boom wordt
  // doorgegeven is bovendien precies wat react-hooks/refs afkeurt.
  useEffect(() => {
    if (!impact) return
    const id = setTimeout(() => setImpact(null), IMPACT_DUUR_MS)
    return () => clearTimeout(id)
  }, [impact])

  // Eén bron voor "mag deze speler meedoen": de bank, de spelerspopup en
  // autoFillLineup lezen allemaal deze set. Liepen die uiteen, dan zou de
  // popup iemand kunnen aanbieden die niet op de bank staat.
  const eligibleIds = new Set(eligiblePlayerIds ?? players.map((p) => p.id))

  function handleFormationChange(f: string) {
    setFormation(f)
    setPositions(FORMATIONS[f].positions.map((p) => ({ ...p, player_id: null })))
    setSelectedSlot(null)
    setFormationOpen(false)
  }

  function assignPlayer(playerId: string | null) {
    if (selectedSlot === null) return
    const slot = selectedSlot
    setPositions((prev) => prev.map((p, i) => {
      if (i === slot) return { ...p, player_id: playerId }
      if (p.player_id === playerId && playerId !== null) return { ...p, player_id: null }
      return p
    }))
    setSelectedSlot(null)

    // Alleen bij het NEERZETTEN van een speler, niet bij verwijderen — en nooit
    // bij prefers-reduced-motion (zelfde afweging als GlobalFab/AppLauncher).
    if (playerId !== null && !reducedMotion) {
      setImpact((prev) => ({ slot, nonce: (prev?.nonce ?? 0) + 1 }))
    }
  }

  function autoFillLineup() {
    const pool = players.filter((p) => eligibleIds.has(p.id))
    const formationSlots = FORMATIONS[formation].positions

    const used = new Set<string>()
    const filled = new Map<number, string>()

    while (filled.size < formationSlots.length) {
      let bestScore = -1, bestPlayerId = '', bestSlotIdx = -1
      for (let si = 0; si < formationSlots.length; si++) {
        if (filled.has(si)) continue
        const preferredPos = POSITION_LABEL_MAP[formationSlots[si].position_label] ?? ''
        for (const player of pool) {
          if (used.has(player.id)) continue
          const fit = getFitScore(player, preferredPos)
          if (fit <= 0) continue
          const score = rankScore(player, preferredPos, fit)
          if (score > bestScore) { bestScore = score; bestPlayerId = player.id; bestSlotIdx = si }
        }
      }
      if (bestScore <= 0) break
      used.add(bestPlayerId)
      filled.set(bestSlotIdx, bestPlayerId)
    }

    setPositions(formationSlots.map((pos, i) => ({ ...pos, player_id: filled.get(i) ?? null })))
    setSelectedSlot(null)
  }

  const assignedPlayerIds = new Set(positions.map((p) => p.player_id).filter(Boolean))
  // Al opgestelde spelers blijven hoe dan ook op het veld staan (en houden hun
  // naam via getPlayerName), ook als ze buiten de selectie vallen — een
  // opgeslagen opstelling mag nooit stilzwijgend leeglopen.
  const availablePlayers = players.filter((p) => eligibleIds.has(p.id) && !assignedPlayerIds.has(p.id))

  function handleSave() {
    startTransition(async () => {
      await saveLineup(eventId, formation, positions)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  function getPlayerName(playerId: string | null): string {
    if (!playerId) return ''
    const p = players.find((pl) => pl.id === playerId)
    return p ? p.name.split(' ')[0] : ''
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label id="formatie-label" className="block text-[13px] font-bold text-muted">{t.lineup.formation}</label>
          <button onClick={autoFillLineup} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-bold text-white active:scale-95 transition" style={{ background: 'var(--color-accent)' }}>
            <span className="ms text-[17px]">bolt</span>
            {t.lineup.autoLineup}
          </button>
        </div>
        {/* Uitklapbare kiezer: met 15 formaties is een open chiprij een muur.
            Dicht toont hij alleen de actieve formatie; open het volledige
            raster. `aria-labelledby` wijst naar het bestaande "Formatie"-label,
            zodat er geen nieuwe vertaalsleutel voor nodig is. */}
        <button
          type="button"
          id="formatie-kiezer"
          aria-labelledby="formatie-label formatie-kiezer"
          aria-expanded={formationOpen}
          onClick={() => setFormationOpen((open) => !open)}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-[14px] font-bold text-ink bg-surface transition-colors"
          style={{ border: '1px solid var(--border-soft)' }}
        >
          <span>{FORMATIONS[formation]?.label ?? formation}</span>
          <span className={`ms text-[20px] text-muted transition-transform duration-200 ${formationOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </button>
        {formationOpen && (
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.keys(FORMATIONS).map((f) => {
              const active = formation === f
              return (
                <button key={f} onClick={() => handleFormationChange(f)}
                  className="px-3 py-2 rounded-[10px] text-[13px] font-bold transition-colors text-center"
                  style={active
                    ? { background: 'var(--color-brand)', color: '#fff' }
                    : { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border-soft)' }}>
                  {FORMATIONS[f].label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Pitch */}
      <div className="relative" style={{ paddingTop: '140%' }}>
        {/* Clipped background layer — rounded corners + grass visual */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'linear-gradient(180deg, #1a5c20 0%, #236b28 25%, #2d7d33 50%, #236b28 75%, #1a5c20 100%)' }}
        >
          <svg
            viewBox="0 0 100 140"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <rect key={i} x="0" y={i * 20} width="100" height="20"
                fill={i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.015)'} />
            ))}
            <rect x="3" y="3" width="94" height="134" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.65" rx="0.3" />
            <line x1="3" y1="70" x2="97" y2="70" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <circle cx="50" cy="70" r="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <circle cx="50" cy="70" r="0.9" fill="rgba(255,255,255,0.85)" />
            <rect x="22" y="110" width="56" height="27" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <rect x="22" y="3" width="56" height="27" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <rect x="35" y="127" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <rect x="35" y="3" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <circle cx="50" cy="121" r="0.9" fill="rgba(255,255,255,0.85)" />
            <circle cx="50" cy="19" r="0.9" fill="rgba(255,255,255,0.85)" />
            <path d="M 6,3 A 3,3 0 0,1 3,6" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <path d="M 94,3 A 3,3 0 0,0 97,6" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <path d="M 3,134 A 3,3 0 0,0 6,137" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <path d="M 94,137 A 3,3 0 0,1 97,134" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55" />
            <rect x="39" y="137" width="22" height="3" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="0.55" />
            <rect x="39" y="0" width="22" height="3" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="0.55" />
          </svg>
        </div>

        {/* Unclipped interactive layer — popup can overflow the pitch edges */}
        <div className="absolute inset-0">
          {/* Click-away backdrop — closes popup when tapping blank pitch area */}
          {selectedSlot !== null && (
            <div className="absolute inset-0" style={{ zIndex: 5 }} onClick={() => setSelectedSlot(null)} />
          )}

          {/* Player markers */}
          {positions.map((pos, i) => {
            const isSelected = selectedSlot === i
            const hasPlayer = !!pos.player_id
            const displayNum = pos.position_number ?? pos.position_label
            // Clubtenue: linkerhelft primair, rechterhelft secundair. De harde
            // stops op 50% geven een scherpe deling in plaats van een verloop;
            // bij één gekozen clubkleur zijn beide helften gelijk
            // (resolveKitColors) en levert diezelfde gradient een effen shirt.
            // De geselecteerde slot houdt zijn amberkleur — dat is de
            // selectie-indicator, geen tenue.
            // Inslag-animatie: alleen op het slot waar zojuist iemand in is
            // gezet. `nonce` in de key laat React het poppetje opnieuw
            // aankoppelen, wat de CSS-animatie van voren af aan start — anders
            // zou twee keer hetzelfde slot vullen de tweede keer niets doen.
            const isImpact = impact?.slot === i
            const impactKey = isImpact ? `slag-${impact.nonce}` : 'rust'
            const wearsKit = hasPlayer && !isSelected && kit !== null
            const kitStyle: React.CSSProperties | undefined = wearsKit && kit
              ? {
                  background: `linear-gradient(90deg, ${kit.left} 0 50%, ${kit.right} 50% 100%)`,
                  color: kit.ink,
                  // Zelfde schaduw + witte rand als het oude witte poppetje,
                  // zodat een donker tenue niet wegvalt tegen het veldgroen.
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35), 0 0 0 2px rgba(255,255,255,0.9)',
                }
              : undefined
            return (
              <button
                key={i}
                onClick={() => setSelectedSlot(isSelected ? null : i)}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 transition duration-150 ${isSelected ? 'scale-110' : ''}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: 10 }}
              >
                {/* Schokgolf: twee ringen die vanuit het poppetje naar buiten
                    slaan, de tweede net later voor diepte. Puur decoratief, dus
                    aria-hidden en pointer-events uit — de knop eronder moet
                    aanklikbaar blijven. `top: 18px` is het midden van het
                    36px-poppetje, dat als eerste kind bovenaan de kolom staat. */}
                {isImpact && (
                  <>
                    <span
                      key={`ring-a-${impact.nonce}`}
                      data-testid="poppetje-schokgolf"
                      aria-hidden
                      className="absolute left-1/2 w-9 h-9 rounded-full pointer-events-none"
                      style={{
                        top: 18, transform: 'translate(-50%, -50%)',
                        border: '3px solid rgba(255,255,255,0.95)',
                        animation: 'poppetje-schokgolf 620ms cubic-bezier(0.16,1,0.3,1) forwards',
                      }}
                    />
                    <span
                      key={`ring-b-${impact.nonce}`}
                      aria-hidden
                      className="absolute left-1/2 w-9 h-9 rounded-full pointer-events-none"
                      style={{
                        top: 18, transform: 'translate(-50%, -50%)',
                        border: `2px solid ${kit?.left ?? 'rgba(255,255,255,0.8)'}`,
                        animation: 'poppetje-schokgolf 620ms 110ms cubic-bezier(0.16,1,0.3,1) forwards',
                      }}
                    />
                  </>
                )}
                <div
                  key={`cirkel-${impactKey}`}
                  data-testid={hasPlayer && !isSelected ? (wearsKit ? 'speler-poppetje-tenue' : 'speler-poppetje-wit') : undefined}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition duration-150 ${
                    isSelected
                      ? 'bg-amber-400 text-amber-950 shadow-[0_0_0_3px_rgba(251,191,36,0.5),0_2px_8px_rgba(0,0,0,0.4)]'
                      : hasPlayer
                        ? wearsKit
                          ? ''
                          : 'bg-white text-[#0d3d38] shadow-[0_2px_8px_rgba(0,0,0,0.35),0_0_0_2px_rgba(255,255,255,0.9)]'
                        : 'bg-white/10 text-white/50 border border-dashed border-white/35'
                  }`}
                  style={isImpact
                    ? { ...kitStyle, animation: 'poppetje-inslag 520ms cubic-bezier(0.22,1.2,0.36,1) both' }
                    : kitStyle}
                >
                  {hasPlayer ? displayNum : <span className="text-base leading-none">+</span>}
                </div>
                <div
                  key={`naam-${impactKey}`}
                  style={isImpact ? { animation: 'poppetje-naam 420ms 140ms ease-out both' } : undefined}
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-center max-w-[60px] truncate leading-tight ${hasPlayer ? 'bg-black/45 text-white' : 'bg-black/20 text-white/55'}`}>
                  {hasPlayer ? getPlayerName(pos.player_id) : pos.position_label}
                </div>
              </button>
            )
          })}

          {/* Position popup — appears near the tapped slot */}
          {selectedSlot !== null && (() => {
            const slotPos = positions[selectedSlot]
            const preferredPos = POSITION_LABEL_MAP[slotPos.position_label] ?? ''
            const currentPlayer = slotPos.player_id ? players.find((p) => p.id === slotPos.player_id) : null

            const ranked = availablePlayers
              .map((p) => ({ player: p, score: rankScore(p, preferredPos) }))
              .sort((a, b) => b.score - a.score)
            const recommended = ranked.find((x) => x.score > 0)?.player ?? null
            const others = ranked.filter((x) => x.player.id !== recommended?.id).map((x) => x.player)

            const isBottom = slotPos.y > 52
            const isLeftEdge = slotPos.x < 38
            const isRightEdge = slotPos.x > 62

            const popupStyle: React.CSSProperties = {
              position: 'absolute',
              top: isBottom ? `calc(${slotPos.y}% - 20px)` : `calc(${slotPos.y}% + 24px)`,
              width: 185,
              zIndex: 20,
            }
            if (isLeftEdge) {
              popupStyle.left = `${slotPos.x}%`
              if (isBottom) popupStyle.transform = 'translateY(-100%)'
            } else if (isRightEdge) {
              popupStyle.right = `${100 - slotPos.x}%`
              if (isBottom) popupStyle.transform = 'translateY(-100%)'
            } else {
              popupStyle.left = `${Math.min(Math.max(slotPos.x, 26), 74)}%`
              popupStyle.transform = isBottom ? 'translate(-50%, -100%)' : 'translateX(-50%)'
            }

            const cardStyle: React.CSSProperties = {
              background: 'rgba(250,250,253,0.90)',
              backdropFilter: 'blur(60px) saturate(200%) brightness(1.04)',
              WebkitBackdropFilter: 'blur(60px) saturate(200%) brightness(1.04)',
              border: '1px solid rgba(255,255,255,0.95)',
              boxShadow: '0 8px 28px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.90) inset',
              borderRadius: 13,
              overflow: 'hidden',
            }

            const trendArrow: Record<PlayerForm['trend'], string> = {
              up: '↑', flat: '→', down: '↓', none: '',
            }

            const row = (p: Player, accent?: boolean) => {
              const form = formOf(p)
              // Alleen "geen cijfer" als er noch een geldige handmatige
              // beoordeling (players.rating, 1..10) noch enige beoordeelde
              // wedstrijd is — de ANKER_FALLBACK van 5 is dan een
              // rekenfallback, geen coachoordeel, en zou hier data verzinnen.
              // Zelfde predicaat als de berekening (lib/lineup-form.ts), zodat
              // een rating buiten 1..10 hier nooit als "5,0" verschijnt.
              // Intern blijft de ranking gewoon met die 5 rekenen (via
              // rankScore/formOf).
              const hasQuality = isGeldigeRating(p.rating) || form.count > 0
              const arrow = trendArrow[form.trend]
              // "positie · cijfer pijl (aantal)" — bij ontbrekend cijfer valt
              // alleen dat deel weg, " · (aantal)" blijft staan.
              const formSuffix = ` · ${hasQuality ? `${qualityFormatter.format(form.quality)}${arrow ? ` ${arrow}` : ''} ` : ''}(${form.count})`
              return (
              <button
                key={p.id}
                onClick={() => assignPlayer(p.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: accent ? '6px 12px 8px' : '6px 12px',
                  background: accent ? 'rgba(251,191,36,0.10)' : 'transparent',
                  textAlign: 'left', cursor: 'pointer', border: 'none',
                  borderBottom: '1px solid rgba(0,0,0,0.045)',
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: accent ? 'rgba(13,61,56,0.12)' : 'rgba(13,61,56,0.08)',
                  color: '#0d3d38', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {p.jersey_number ?? '#'}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: accent ? 13 : 12, fontWeight: accent ? 600 : 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name.split(' ')[0]}
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>
                    {POSITION_ABBREVIATIONS[p.position] ?? p.position}{formSuffix}
                  </div>
                </span>
                {accent && <span style={{ fontSize: 12, color: '#d97706', flexShrink: 0 }}>★</span>}
              </button>
              )
            }

            return (
              <div style={popupStyle}>
                <div style={cardStyle}>
                  {/* Header */}
                  <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {slotPos.position_label}{slotPos.position_number ? ` · #${slotPos.position_number}` : ''}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 1 }}>
                      {preferredPos || slotPos.position_label}
                    </div>
                  </div>

                  {/* Recommended */}
                  {recommended && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#b45309', letterSpacing: '0.07em', padding: '5px 12px 2px', textTransform: 'uppercase' }}>
                        ★ Aanbevolen
                      </div>
                      {row(recommended, true)}
                    </>
                  )}

                  {/* Other available players */}
                  {others.length > 0 && (
                    <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                      {others.map((p) => row(p))}
                    </div>
                  )}

                  {/* Empty state */}
                  {availablePlayers.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
                      {t.lineup.allAssigned}
                    </div>
                  )}

                  {/* Remove current player */}
                  {currentPlayer && (
                    <button
                      onClick={() => assignPlayer(null)}
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600,
                        color: '#dc2626', background: 'rgba(220,38,38,0.06)',
                        borderTop: '1px solid rgba(0,0,0,0.06)', border: 'none', cursor: 'pointer',
                        display: 'block', textAlign: 'center',
                      }}
                    >
                      {t.lineup.removePlayer}
                    </button>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Bench */}
      {assignedPlayerIds.size > 0 && availablePlayers.length > 0 && (
        <div>
          <h3 className="text-[13px] font-bold text-muted mb-2">{t.lineup.bench} ({availablePlayers.length})</h3>
          <div className="flex flex-wrap gap-2">
            {availablePlayers.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-muted bg-surface-sunken" style={{ border: '1px solid var(--border-soft)' }}>
                <span className="font-bold text-faint">{p.jersey_number ?? '#'}</span>
                {p.name.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
      )}

      <button onClick={handleSave} disabled={isPending}
        className="w-full py-3 rounded-xl font-bold text-white transition active:scale-[0.98]"
        style={{ background: saved ? '#22c55e' : isPending ? 'var(--faint)' : 'var(--primary)' }}>
        {saved ? t.lineup.saved : isPending ? t.lineup.saving : t.lineup.save}
      </button>
    </div>
  )
}

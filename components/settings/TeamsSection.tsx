'use client'

// Teams-sectie op Instellingen (brief §4.3, AC 14/49) — alleen gerenderd voor
// de hoofdtrainer van het ACTIEVE team (app/settings/page.tsx bepaalt dat,
// zelfde gate als StafSection). Lijst van de teams waarvan de gebruiker owner
// is (`ctx.teams` gefilterd op `rol === 'owner'`), elk met een eigen
// "Team verwijderen"-bevestigingsblok — hetzelfde patroon als
// components/DeleteAccountSection.tsx (typ VERWIJDER, fout blijft IN het open
// blok staan), hier per rij i.p.v. pagina-breed omdat een hoofdtrainer
// meerdere teams kan bezitten.
//
// Twee server-calls, in twee stappen (niet vooraf voor elk team tegelijk
// opgehaald): `getTeamDeleteInfo(teamId)` pas ZODRA de gebruiker "Team
// verwijderen" indrukt, voor het aantal assistenten dat toegang verliest
// (AC 14). Daarna pas `deleteTeam(teamId)` — die action redirect zelf
// (`app/actions/team.ts`), dus geen eigen navigatie hier.
import { useState, useTransition } from 'react'
import { deleteTeam, getTeamDeleteInfo } from '@/app/actions/team'
import { useDict } from '@/lib/i18n-context'
import type { TeamLidmaatschap } from '@/lib/team-context'

interface Props {
  teams: Pick<TeamLidmaatschap, 'teamId' | 'naam'>[]
}

// `idle`/`loadingInfo`/`infoError` delen dezelfde trigger-knop (die blijft
// dezelfde DOM-node — geen focusverlies, zie `openConfirm`). Pas bij
// `confirm` vervangt het bevestigingsblok de knop; dat blok blijft ook bij
// een mislukte `deleteTeam` open, met de fout erin (`pending`/`error` zitten
// daarom IN de confirm-variant, niet als eigen top-level status).
type RowState =
  | { status: 'idle' }
  | { status: 'loadingInfo' }
  | { status: 'infoError'; message: string }
  | { status: 'confirm'; aantalAssistenten: number; pending: boolean; error: string | null }

const IDLE: RowState = { status: 'idle' }

export default function TeamsSection({ teams }: Props) {
  const t = useDict()
  const [, startTransition] = useTransition()
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [confirmText, setConfirmText] = useState<Record<string, string>>({})

  if (teams.length === 0) return null

  const word = t.settings.deleteConfirmWord

  function openConfirm(teamId: string) {
    setRowState((s) => ({ ...s, [teamId]: { status: 'loadingInfo' } }))
    startTransition(async () => {
      try {
        const info = await getTeamDeleteInfo(teamId)
        setRowState((s) => ({
          ...s,
          [teamId]: { status: 'confirm', aantalAssistenten: info.aantalAssistenten, pending: false, error: null },
        }))
      } catch {
        // Nooit err.message: een actiefout wordt in productie sowieso al
        // gesaneerd door Next, zie InviteLinkCard/RechtenToggles. Eigen
        // melding i.p.v. de deleteTeam-tekst: er is hier nog niets verwijderd.
        setRowState((s) => ({ ...s, [teamId]: { status: 'infoError', message: t.teamsBeheer.infoFailed } }))
      }
    })
  }

  function cancel(teamId: string) {
    setRowState((s) => ({ ...s, [teamId]: IDLE }))
    setConfirmText((s) => ({ ...s, [teamId]: '' }))
  }

  function handleDelete(teamId: string, aantalAssistenten: number) {
    setRowState((s) => ({ ...s, [teamId]: { status: 'confirm', aantalAssistenten, pending: true, error: null } }))
    startTransition(async () => {
      try {
        await deleteTeam(teamId)
        // deleteTeam eindigt altijd in redirect('/') — dit codepad wordt bij
        // succes dus nooit bereikt (de redirect throwt zelf, zie de catch).
      } catch (err) {
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) return
        // DeleteAccountSection-patroon: het blok blijft open, de fout komt
        // erin te staan. De getypte VERWIJDER wordt gewist, zodat de knop na
        // een mislukte poging niet meteen weer scherp staat.
        setRowState((s) => ({ ...s, [teamId]: { status: 'confirm', aantalAssistenten, pending: false, error: t.teamsBeheer.deleteFailed } }))
        setConfirmText((s) => ({ ...s, [teamId]: '' }))
      }
    })
  }

  return (
    <div className="flex flex-col divide-y divide-[var(--border-soft)]">
      {teams.map((team) => {
        const state = rowState[team.teamId] ?? IDLE
        const typed = confirmText[team.teamId] ?? ''
        const armed = typed.trim().toUpperCase() === word.toUpperCase()
        const naam = team.naam || t.team.activeTeam
        const isLoadingInfo = state.status === 'loadingInfo'

        return (
          <div key={team.teamId} className="py-3.5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13.5px] font-bold text-ink truncate">{naam}</p>
              {/* Dezelfde knop-node voor idle/loadingInfo/infoError — geen
                  focusverlies tijdens het ophalen (validatieronde fase 3+4,
                  punt 5). `aria-busy` + een sr-only statustekst i.p.v. de knop
                  te vervangen door een `aria-hidden` "…". */}
              {(state.status === 'idle' || state.status === 'loadingInfo' || state.status === 'infoError') && (
                <button
                  type="button"
                  onClick={() => openConfirm(team.teamId)}
                  disabled={isLoadingInfo}
                  aria-busy={isLoadingInfo}
                  className="text-[12.5px] font-semibold text-danger flex-shrink-0 disabled:opacity-60 disabled:cursor-wait"
                >
                  {t.teamsBeheer.deleteTeam}
                  {isLoadingInfo && <span className="sr-only"> {t.teamsBeheer.loadingInfo}</span>}
                </button>
              )}
            </div>

            {state.status === 'infoError' && (
              <p className="text-[12px] font-semibold text-danger">{state.message}</p>
            )}

            {state.status === 'confirm' && (
              <div className="rounded-xl border border-panel-red-edge bg-panel-red/50 p-3 flex flex-col gap-3">
                <div>
                  <h4 className="text-[13px] font-bold text-panel-red-ink">{t.teamsBeheer.deleteTeamTitle}</h4>
                  <p className="text-[12.5px] text-panel-red-ink mt-1">
                    {t.teamsBeheer.deleteTeamHint.replace('{team}', naam)}
                  </p>
                  <p className="text-[12.5px] font-semibold text-panel-red-ink mt-1.5">
                    {t.teamsBeheer.deleteTeamAssistants.replace('{n}', String(state.aantalAssistenten))}
                  </p>
                </div>

                <label htmlFor={`team-verwijder-confirm-${team.teamId}`} className="block text-[12.5px] font-medium text-panel-red-ink">
                  {t.settings.deleteConfirmPrompt}
                </label>
                <input
                  id={`team-verwijder-confirm-${team.teamId}`}
                  type="text"
                  value={typed}
                  onChange={(e) => setConfirmText((s) => ({ ...s, [team.teamId]: e.target.value }))}
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder={word}
                  disabled={state.pending}
                  className="w-full px-3 py-2.5 rounded-xl border border-panel-red-edge focus:outline-none focus:border-panel-red-ink focus:ring-2 focus:ring-panel-red-ink/30 text-ink placeholder:text-faint text-[13px] disabled:opacity-60"
                />

                {/* Fout IN het open blok, zelfde plek als
                    DeleteAccountSection.tsx:62-64 — niet eronder, niet in een
                    apart gesloten blok. */}
                {state.error && (
                  <div className="bg-panel-red border border-panel-red-edge text-panel-red-ink text-[12px] font-semibold px-3 py-2 rounded-lg">
                    {state.error}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => cancel(team.teamId)}
                    disabled={state.pending}
                    className="flex-1 py-2 rounded-lg text-[12.5px] font-semibold text-muted border border-[var(--border-soft)] active:scale-[0.97] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t.trainingPlan.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(team.teamId, state.aantalAssistenten)}
                    disabled={!armed || state.pending}
                    className="flex-1 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-danger active:scale-[0.97] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {state.pending ? t.teamsBeheer.deleting : t.settings.deleteConfirmFinal}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

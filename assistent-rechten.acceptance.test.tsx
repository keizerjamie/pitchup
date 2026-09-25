// Acceptatietests — Assistent-trainers, fase 2: rechten-per-onderdeel + de
// uitnodigingsflow (goedgekeurde story v3, brief §4.3-4.5, addendum §8.8,
// goedkeuring brief-addendum "Vraag 8.8 beantwoord met JA").
//
// Scope van dit bestand (opdracht test-verifier): AC 5, 6 (incl. beslissing 4
// — Trainingsschema bij Agenda-bewerkrecht), 7, 8, 9, 28, 29, 30, plus de
// uitnodigingsflow AC 1, 2, 3, 4, 23-26, 32.
//
// ── Testmethode ──
// Van buitenaf, zoals een gebruiker de app ervaart: de ECHTE, geëxporteerde
// server components/pagina's (app/settings/page.tsx) en client-componenten
// (GlobalFab, MatchSquadEditor, TrainingPlanEditor, CyclusWeekCorrectie,
// RechtenToggles, InviteLinkCard, InviteConfirm, InviteRegisterForm,
// DeleteAccountSection, app/invite/[token]/page.tsx) worden gerenderd tegen
// een ECHT FILTERENDE Supabase-tabel-engine (kopie van het patroon uit
// assistent-fase1-fundament.acceptance.test.ts / teamindeling.acceptance
// .test.tsx — .eq/.in worden daadwerkelijk toegepast, in plaats van de
// chainable stub in app/actions/*.test.ts die filters negeert, geheugen.md
// "Belangrijke gotchas").
//
// team_id ≠ user.id in ELK scenario hieronder (TEAM_ID is een eigen uuid,
// los van OWNER_ID/ASSISTENT_ID) — dekt validatorpunt 8 uit
// 13-validator-fase2-backend.md ("zodra de frontend de teamwisselaar
// toevoegt moet minstens één acceptatietest met de tabel-engine op
// team_id ≠ user.id draaien").
//
// ── Wat hier bewust NIET (opnieuw) getest wordt ──
// - De applicatielaag-weigering zelf ('Geen toegang' bij een schrijfaction
//   zonder recht) staat al grondig in assistent-fase1-fundament.acceptance
//   .test.ts (AC45-blokken, incl. de addendum-RPC's set_gather_time/
//   set_trainingstype) en in app/actions/settings.test.ts ("rechten op de
//   instellingen"). Dit bestand bewijst de UI-KANT: welke sectie/knop/veld
//   verschijnt of ontbreekt per rechtenset, en dat een geslaagde UI-actie de
//   echte server action aanroept — geen tweede keer de actie zelf.
// - De RLS-laag (database) is niet in vitest te bewijzen (brief §5.1) — zie
//   supabase/team-rls-verificatie.sql en de structuurcontrole daarop in
//   assistent-fase1-fundament.acceptance.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { TeamContextClientProvider } from '@/lib/team-context-client'
import { nl } from '@/messages/nl'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`__redirect__:${to}`) }),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined, set: vi.fn() }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => null) }))

// StafSection (alleen gerenderd voor een owner) roept deze twee acties aan —
// gemockt zodat dit bestand niet ook nog de admin-client/RPC's van
// listTeamMembers/getActiveInvite hoeft na te bootsen. Die acties hebben hun
// eigen, uitgebreide dekking in app/actions/team-members.test.ts en
// app/actions/team-invites.test.ts (backend, incl. owner-only-weigering).
vi.mock('@/app/actions/team-members', () => ({
  listTeamMembers: vi.fn(),
  updateMemberRights: vi.fn(),
  removeMember: vi.fn(),
}))
vi.mock('@/app/actions/team-invites', () => ({
  createInvite: vi.fn(),
  getActiveInvite: vi.fn(),
  revokeInvite: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
}))
// Alleen de drie schrijvende exports overschrijven; getAllSettings/
// saveSettings blijven ECHT (die lopen via de tabel-engine hieronder, en
// saveSettings is owner-only-gedrag dat al elders getest is).
vi.mock('@/app/actions/settings', async (importOriginal) => {
  const origineel = await importOriginal<typeof import('@/app/actions/settings')>()
  return {
    ...origineel,
    saveScheduleSettings: vi.fn(async () => {}),
    generateSeasonTrainings: vi.fn(async () => ({ created: 0, skipped: 0 })),
    deleteSeasonTrainings: vi.fn(async () => ({ deleted: 0 })),
  }
})
vi.mock('@/app/actions/periodisering', () => ({
  saveCyclusWeekCorrectie: vi.fn(async () => {}),
  deleteCyclusWeekCorrectie: vi.fn(async () => {}),
}))
vi.mock('@/app/actions/events', () => ({
  updateGatherTime: vi.fn(async () => {}),
  updateTrainingstype: vi.fn(async () => {}),
}))
vi.mock('@/app/actions/match-squad', () => ({ toggleSquadPlayer: vi.fn(async () => {}) }))
vi.mock('@/app/actions/training-plan', () => ({
  saveDoelstelling: vi.fn(async () => {}),
  removeOefeningFromTraining: vi.fn(async () => {}),
  updateKoppeling: vi.fn(async () => {}),
  reorderKoppelingen: vi.fn(async () => {}),
  vormParallelGroep: vi.fn(async () => {}),
  voegToeAanParallelGroep: vi.fn(async () => {}),
  haalUitParallelGroep: vi.fn(async () => {}),
}))
vi.mock('@/app/actions/oefening-library', () => ({ updateOefening: vi.fn(async () => {}) }))

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { listTeamMembers, updateMemberRights } from '@/app/actions/team-members'
import { createInvite, getActiveInvite, acceptInvite, peekInvite } from '@/app/actions/team-invites'
import { saveScheduleSettings } from '@/app/actions/settings'
import { saveCyclusWeekCorrectie, deleteCyclusWeekCorrectie } from '@/app/actions/periodisering'
import { updateGatherTime, updateTrainingstype } from '@/app/actions/events'
import SettingsPage from '@/app/settings/page'
import GlobalFab from '@/components/GlobalFab'
import MatchSquadEditor from '@/components/MatchSquadEditor'
import TrainingPlanEditor from '@/components/TrainingPlanEditor'
import CyclusWeekCorrectie from '@/components/CyclusWeekCorrectie'
import RechtenToggles from '@/components/settings/RechtenToggles'
import InviteLinkCard from '@/components/settings/InviteLinkCard'
import InviteConfirm from '@/app/invite/[token]/InviteConfirm'
import InviteRegisterForm from '@/app/invite/[token]/register/InviteRegisterForm'
import DeleteAccountSection from '@/components/DeleteAccountSection'
import InvitePage from '@/app/invite/[token]/page'
import { canEdit, getTeamContext } from '@/lib/team-context'
import { ALLE_RECHTEN, GEEN_RECHTEN, rechtenNaarKolommen, type TeamRechten } from '@/lib/team-rechten'
import type { Player } from '@/lib/types'

// ────────────────────────────────────────────────
// Generieke, ECHT filterende Supabase-tabel-engine — zelfde precedent als
// assistent-fase1-fundament.acceptance.test.ts (eigen kopie per bestand,
// project-conventie). .eq/.in worden echt toegepast op de onderliggende
// rijenlijst.
// ────────────────────────────────────────────────
type Row = Record<string, unknown>

function realTable(rows: Row[]) {
  return () => {
    const filters: ((r: Row) => boolean)[] = []
    const resolveRows = () => rows.filter((r) => filters.every((f) => f(r)))
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain }
    chain.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain }
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null })
    chain.single = () => Promise.resolve({ data: resolveRows()[0] ?? null, error: null })
    ;(chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: resolveRows(), error: null })
    return chain
  }
}

function makeSupabase(opts: { user: { id: string } | null; members: Row[]; settings?: Row[] }) {
  const store: Record<string, Row[]> = {
    team_members: opts.members,
    settings: opts.settings ?? [],
  }
  return {
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from: (t: string) => {
      if (!store[t]) store[t] = []
      return realTable(store[t])()
    },
  }
}

function installSupabase(m: unknown) {
  vi.mocked(createClient).mockResolvedValue(m as unknown as Awaited<ReturnType<typeof createClient>>)
}

function memberRow(teamId: string, userId: string, rol: 'owner' | 'assistent', rechten: Partial<TeamRechten> = {}): Row {
  return { team_id: teamId, user_id: userId, rol, ...rechtenNaarKolommen({ ...GEEN_RECHTEN, ...rechten } as TeamRechten) }
}

function teamNameRow(teamId: string, naam: string): Row {
  return { team_id: teamId, key: 'team_name', value: naam }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listTeamMembers).mockResolvedValue([])
  vi.mocked(getActiveInvite).mockResolvedValue(null)
  vi.mocked(cookies).mockResolvedValue({ get: () => undefined, set: vi.fn() } as unknown as Awaited<ReturnType<typeof cookies>>)
})

// team_id is EXPLICIET geen user-id van wie dan ook (validatorpunt 8).
const TEAM_ID = '33333333-3333-4333-8333-333333333333'
const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const ASSISTENT_ID = '22222222-2222-4222-8222-222222222222'

async function renderSettings(rol: 'owner' | 'assistent', rechten: Partial<TeamRechten> = {}) {
  const userId = rol === 'owner' ? OWNER_ID : ASSISTENT_ID
  installSupabase(makeSupabase({
    user: { id: userId },
    members: [memberRow(TEAM_ID, userId, rol, rechten)],
    settings: [teamNameRow(TEAM_ID, 'JO13-1')],
  }))
  const el = await SettingsPage()
  return render(<DictProvider dict={nl}>{el}</DictProvider>)
}

function q(text: string) {
  return screen.queryByText(text)
}

// ════════════════════════════════════════════════════════════════════════
// AC5/AC6 — een net gekoppelde assistent (alles lezen, niets bewerken) ziet
// op Instellingen uitsluitend Weergave, Uitloggen en accountverwijdering.
// ════════════════════════════════════════════════════════════════════════
describe('AC5/AC6 — assistent met GEEN_RECHTEN (standaardrechten na koppeling, BR 39) ziet alleen Weergave/Uitloggen/accountverwijdering', () => {
  it('Weergave, Over en Uitloggen zijn zichtbaar; Staf/Logo/Clubkleuren/Aanwezigheid-default/Trainingsschema/Periodisering-link ontbreken volledig', async () => {
    await renderSettings('assistent', GEEN_RECHTEN)

    expect(q(nl.settings.displaySection)).not.toBeNull()
    expect(q(nl.settings.aboutSection)).not.toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(nl.settings.logout) })).toBeInTheDocument()

    expect(q(nl.settings.logoSection)).toBeNull()
    expect(q(nl.settings.clubColorsSection)).toBeNull()
    expect(q(nl.settings.attendanceSection)).toBeNull()
    expect(q(nl.settings.scheduleSection)).toBeNull()
    expect(q(nl.staf.section)).toBeNull()
    expect(q(nl.settings.periodizationSection)).toBeNull()
  })

  it('de accountverwijdering-sectie (typ-VERWIJDER-bevestiging) is aanwezig — AC6 noemt dit expliciet als iets wat een assistent WEL mag', async () => {
    await renderSettings('assistent', GEEN_RECHTEN)
    expect(screen.getByText(nl.settings.deleteAccountTitle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.settings.deleteAccountButton })).toBeInTheDocument()
  })

  it('AC32/regressie — listTeamMembers() wordt NOOIT aangeroepen voor een assistent (die actie gooit zelf "Geen toegang"; de pagina mag hem niet blind aanroepen, backend-feedback §7)', async () => {
    await renderSettings('assistent', ALLE_RECHTEN)
    expect(listTeamMembers).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC6/beslissing 4 — Trainingsschema is de ENIGE uitzondering: zichtbaar EN
// bewerkbaar zodra de assistent het Agenda-recht heeft.
// ════════════════════════════════════════════════════════════════════════
describe('AC6/beslissing 4 — Trainingsschema zichtbaar bij Agenda-bewerkrecht, verder blijft de rest verborgen', () => {
  it('agenda:true → Trainingsschema-kaart verschijnt, Staf/Logo/Clubkleuren/Aanwezigheid blijven verborgen (AC29 volgt hieruit voor de OMGEKEERDE — zie hieronder)', async () => {
    await renderSettings('assistent', { agenda: true })
    expect(q(nl.settings.scheduleSection)).not.toBeNull()
    expect(q(nl.staf.section)).toBeNull()
    expect(q(nl.settings.logoSection)).toBeNull()
    expect(q(nl.settings.clubColorsSection)).toBeNull()
    expect(q(nl.settings.attendanceSection)).toBeNull()
  })

  it('AC29 — zonder Agenda-recht ontbreekt de Trainingsschema-kaart volledig: er is geen enkel veld om seizoensdata/trainingsdagen te wijzigen', async () => {
    await renderSettings('assistent', GEEN_RECHTEN)
    expect(q(nl.settings.scheduleSection)).toBeNull()
    expect(q(nl.schedule.seasonStart)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC7 — assistent met Agenda-bewerkrecht wijzigt seizoensdata/trainingsdagen
// → de wijziging wordt opgeslagen (server-side weigering/toelating zelf zit
// al in app/actions/settings.test.ts "rechten op de instellingen"; dit
// bewijst dat het ECHTE formulier op de ECHTE pagina die actie aanroept).
// ════════════════════════════════════════════════════════════════════════
describe('AC7 — Trainingsschema opslaan door een assistent met Agenda-recht', () => {
  it('het schema-formulier op de instellingenpagina roept saveScheduleSettings aan bij opslaan', async () => {
    await renderSettings('assistent', { agenda: true })
    const saveButton = screen.getByRole('button', { name: nl.schedule.saveSchedule })
    const form = saveButton.closest('form') as HTMLFormElement
    await act(async () => { fireEvent.submit(form) })
    expect(saveScheduleSettings).toHaveBeenCalledTimes(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC8/AC30 — cyclusweek-correctie (Periodisering-recht). Component-niveau:
// CyclusWeekCorrectie IS de bewerkactie (brief §4.5, componentcommentaar) en
// verbergt zichzelf volledig zonder recht — dat is de sterkste vorm van
// "geweigerd": er is geen knop om te proberen.
// ════════════════════════════════════════════════════════════════════════
describe('AC8/AC30 — cyclusweek-correctie: opslaan bij Periodisering-recht, volledig verborgen zonder', () => {
  it('AC30 — canEdit=false (geen periodiseringsrecht) → geen enkele knop, niets te proberen', () => {
    const { container } = render(
      <DictProvider dict={nl}>
        <CyclusWeekCorrectie huidigeWeek={2} heeftCorrectie={false} canEdit={false} />
      </DictProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('AC8 — canEdit=true → sheet openen, een week kiezen en opslaan roept saveCyclusWeekCorrectie aan met exact die week', async () => {
    render(
      <DictProvider dict={nl}>
        <CyclusWeekCorrectie huidigeWeek={1} heeftCorrectie={false} canEdit={true} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekOption.replace('{n}', '3')))
    await act(async () => {
      fireEvent.click(screen.getByText(nl.periodization.saveWeek))
    })
    expect(saveCyclusWeekCorrectie).toHaveBeenCalledWith(3)
  })

  it('AC30 — met canEdit=true is "Terug naar automatisch" ook bereikbaar en roept deleteCyclusWeekCorrectie aan (mirror-bewijs dat zonder recht dit pad ontoegankelijk is, zie hierboven)', async () => {
    render(
      <DictProvider dict={nl}>
        <CyclusWeekCorrectie huidigeWeek={2} heeftCorrectie={true} canEdit={true} />
      </DictProvider>,
    )
    fireEvent.click(screen.getByText(nl.periodization.adjustWeekCta))
    await act(async () => {
      fireEvent.click(screen.getByText(nl.periodization.backToAutomatic))
    })
    expect(deleteCyclusWeekCorrectie).toHaveBeenCalledTimes(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC9 — rechten wijzigen heeft direct effect (optimistisch + rollback bij
// fout), zonder dat de assistent opnieuw hoeft in te loggen.
// ════════════════════════════════════════════════════════════════════════
describe('AC9 — een recht aan-/uitzetten heeft direct effect in de UI (optimistic), met rollback bij een mislukte save', () => {
  it('togglen naar aan is DIRECT zichtbaar (vóór de server-belofte resolved) en updateMemberRights krijgt de volledige nieuwe rechtenset', async () => {
    let resolveSave!: () => void
    vi.mocked(updateMemberRights).mockReturnValueOnce(new Promise((res) => { resolveSave = () => res({ ok: true }) }))

    render(
      <DictProvider dict={nl}>
        <RechtenToggles userId={ASSISTENT_ID} initialRechten={GEEN_RECHTEN} />
      </DictProvider>,
    )
    const spelersSwitch = screen.getByRole('switch', { name: nl.staf.onderdeel.spelers })
    expect(spelersSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(spelersSwitch)
    // Direct effect: de switch staat al aan terwijl de server-call nog hangt.
    expect(spelersSwitch).toHaveAttribute('aria-checked', 'true')
    expect(updateMemberRights).toHaveBeenCalledWith(ASSISTENT_ID, { ...GEEN_RECHTEN, spelers: true })

    await act(async () => { resolveSave() })
    expect(spelersSwitch).toHaveAttribute('aria-checked', 'true')
  })

  it('rollback: mislukte save draait de toggle terug naar de laatst BEVESTIGDE stand en toont een foutmelding', async () => {
    vi.mocked(updateMemberRights).mockRejectedValueOnce(new Error('boom'))
    render(
      <DictProvider dict={nl}>
        <RechtenToggles userId={ASSISTENT_ID} initialRechten={GEEN_RECHTEN} />
      </DictProvider>,
    )
    const agendaSwitch = screen.getByRole('switch', { name: nl.staf.onderdeel.agenda })
    await act(async () => { fireEvent.click(agendaSwitch) })
    expect(agendaSwitch).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(nl.staf.saveFailed)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC28/AC42 — teambrede instellingen (logo, clubkleuren, aanwezigheid-
// default, teamnaam) zijn ALTIJD owner-only, ook met alle zes rechten aan.
// ════════════════════════════════════════════════════════════════════════
describe('AC28/AC42 — een assistent met ALLE zes rechten ziet nog altijd geen teambrede instellingen', () => {
  it('Clublogo, Clubkleuren en Aanwezigheid-default ontbreken volledig, ook met ALLE_RECHTEN', async () => {
    await renderSettings('assistent', ALLE_RECHTEN)
    expect(q(nl.settings.logoSection)).toBeNull()
    expect(q(nl.settings.clubColorsSection)).toBeNull()
    expect(q(nl.settings.attendanceSection)).toBeNull()
    // Wél: alle onderdeel-afhankelijke secties, want die volgen wél de rechten.
    expect(q(nl.settings.scheduleSection)).not.toBeNull()
    expect(q(nl.settings.periodizationSection)).not.toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Owner ziet alles
// ════════════════════════════════════════════════════════════════════════
describe('Owner ziet alle secties op Instellingen', () => {
  it('Logo, Clubkleuren, Aanwezigheid-default, Trainingsschema, Staf en Periodisering-link zijn alle zichtbaar', async () => {
    await renderSettings('owner')
    expect(q(nl.settings.logoSection)).not.toBeNull()
    expect(q(nl.settings.clubColorsSection)).not.toBeNull()
    expect(q(nl.settings.attendanceSection)).not.toBeNull()
    expect(q(nl.settings.scheduleSection)).not.toBeNull()
    expect(q(nl.staf.section)).not.toBeNull()
    expect(q(nl.settings.periodizationSection)).not.toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════
// GlobalFab — verdwijnt volledig bij nul rechten, toont anders alleen de
// items waarvoor de assistent recht heeft (brief §4.5).
// ════════════════════════════════════════════════════════════════════════
describe('GlobalFab — items volgen exact de rechten, FAB verdwijnt bij nul rechten', () => {
  function renderFab(rol: 'owner' | 'assistent', rechten: Partial<TeamRechten>) {
    return render(
      <DictProvider dict={nl}>
        <TeamContextClientProvider value={{ teamId: TEAM_ID, rol, rechten: { ...GEEN_RECHTEN, ...rechten } as TeamRechten, teams: [] }}>
          <GlobalFab />
        </TeamContextClientProvider>
      </DictProvider>,
    )
  }

  it('assistent zonder enig recht → de FAB rendert helemaal niet (geen knop die een leeg menu opent)', () => {
    const { container } = renderFab('assistent', {})
    expect(container.querySelector('button[aria-label]')).toBeNull()
  })

  it('assistent met alleen spelers-recht → alleen "Speler toevoegen" is bereikbaar', () => {
    renderFab('assistent', { spelers: true })
    const fabButton = screen.getByRole('button', { name: nl.fab.title })
    fireEvent.click(fabButton)
    expect(screen.getByText(nl.players.add)).toBeInTheDocument()
    expect(screen.queryByText(nl.event.createTraining)).toBeNull()
    expect(screen.queryByText(nl.event.createMatch)).toBeNull()
  })

  it('assistent met alleen agenda-recht → de drie event-knoppen, geen "Speler toevoegen"', () => {
    renderFab('assistent', { agenda: true })
    fireEvent.click(screen.getByRole('button', { name: nl.fab.title }))
    expect(screen.getByText(nl.event.createTraining)).toBeInTheDocument()
    expect(screen.getByText(nl.event.createMatch)).toBeInTheDocument()
    expect(screen.getByText(nl.event.bulk.fabLabel)).toBeInTheDocument()
    expect(screen.queryByText(nl.players.add)).toBeNull()
  })

  it('owner → alle vier de items, ongeacht de (lege) rechtenkolommen', () => {
    renderFab('owner', {})
    fireEvent.click(screen.getByRole('button', { name: nl.fab.title }))
    expect(screen.getByText(nl.event.createTraining)).toBeInTheDocument()
    expect(screen.getByText(nl.players.add)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Addendum §8.8 — verzameltijd valt onder WEDSTRIJD, trainingstype onder
// TRAINING (niet onder agenda). Bewezen via de ECHTE canEdit() op een ECHTE,
// uit de tabel-engine gelezen context, zodat de mapping niet stilzwijgend
// terug kan glijden naar 'agenda'.
// ════════════════════════════════════════════════════════════════════════
describe('Addendum §8.8 — verzameltijd onder wedstrijd, trainingstype onder training', () => {
  function makePlayer(): Player {
    return {
      id: 'p1', name: 'Piet Peters', position: 'Spits', secondary_positions: [],
      jersey_number: 9, active: true, injured: false, type: 'regular', rating: 5,
      created_at: '2024-01-01T00:00:00Z',
    }
  }

  async function ctxVoorAssistent(rechten: Partial<TeamRechten>) {
    installSupabase(makeSupabase({
      user: { id: ASSISTENT_ID },
      members: [memberRow(TEAM_ID, ASSISTENT_ID, 'assistent', rechten)],
      settings: [teamNameRow(TEAM_ID, 'JO13-1')],
    }))
    const ctx = await getTeamContext()
    if (!ctx) throw new Error('test-fixture: geen context')
    return ctx
  }

  it('agenda-recht ALLEEN is NIET genoeg voor verzameltijd: het veld blijft read-only (canEdit(ctx, "wedstrijd") is false)', async () => {
    const ctx = await ctxVoorAssistent({ agenda: true })
    render(
      <DictProvider dict={nl}>
        <MatchSquadEditor
          eventId="e1" players={[makePlayer()]} initialSelectedIds={[]} presentPlayerIds={[]}
          hasAnyActivePlayers={true} opponent={null} dateLabel="" teamName={null} teamLogoUrl={null}
          homeAway={null} kickoffTime={null} location={null} initialGatherTime={null} formItems={[]}
          primaryColor="#000" secondaryColor="#000" canEdit={canEdit(ctx, 'wedstrijd')}
        />
      </DictProvider>,
    )
    expect(screen.queryByLabelText(nl.matchSquad.gatherTimeEditLabel)).toBeNull()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('wedstrijd-recht MAAKT het veld bewerkbaar en roept updateGatherTime aan bij opslaan', async () => {
    const ctx = await ctxVoorAssistent({ wedstrijd: true })
    render(
      <DictProvider dict={nl}>
        <MatchSquadEditor
          eventId="e1" players={[makePlayer()]} initialSelectedIds={[]} presentPlayerIds={[]}
          hasAnyActivePlayers={true} opponent={null} dateLabel="" teamName={null} teamLogoUrl={null}
          homeAway={null} kickoffTime={null} location={null} initialGatherTime={null} formItems={[]}
          primaryColor="#000" secondaryColor="#000" canEdit={canEdit(ctx, 'wedstrijd')}
        />
      </DictProvider>,
    )
    fireEvent.change(screen.getByLabelText(nl.matchSquad.gatherTimeEditLabel), { target: { value: '17:30' } })
    await act(async () => { fireEvent.click(screen.getByText(nl.matchSquad.gatherTimeSave)) })
    expect(updateGatherTime).toHaveBeenCalledWith('e1', '17:30')
  })

  it('agenda-recht ALLEEN is NIET genoeg voor trainingstype: de schakelaar staat er wel, maar is disabled (canEdit(ctx, "training") is false)', async () => {
    const ctx = await ctxVoorAssistent({ agenda: true })
    render(
      <DictProvider dict={nl}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null} initialOefeningen={[]} library={[]} currentSteps={{}}
          hasNulmeting={false} suggestion={null} players={[]} presentPlayerIds={[]} startTijd={null}
          kopieerOpties={[]} initialTrainingstype="vct" canEdit={canEdit(ctx, 'training')} userId={ctx.userId}
        />
      </DictProvider>,
    )
    expect(screen.getByText(nl.event.trainingstypeVct).closest('button')).toBeDisabled()
  })

  it('training-recht MAAKT de trainingstype-schakelaar bruikbaar en roept updateTrainingstype aan', async () => {
    const ctx = await ctxVoorAssistent({ training: true })
    render(
      <DictProvider dict={nl}>
        <TrainingPlanEditor
          eventId="e1" initialDoelstelling={null} initialOefeningen={[]} library={[]} currentSteps={{}}
          hasNulmeting={false} suggestion={null} players={[]} presentPlayerIds={[]} startTijd={null}
          kopieerOpties={[]} initialTrainingstype="vct" canEdit={canEdit(ctx, 'training')} userId={ctx.userId}
        />
      </DictProvider>,
    )
    const knop = screen.getByText(nl.event.trainingstypeTeamtactisch).closest('button') as HTMLButtonElement
    expect(knop).not.toBeDisabled()
    await act(async () => { fireEvent.click(knop) })
    expect(updateTrainingstype).toHaveBeenCalledWith('e1', 'teamtactisch')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC1/AC2 — uitnodigingslink: éénmalig zichtbaar, na herladen alleen de
// vervaldatum + "Nieuwe link genereren".
// ════════════════════════════════════════════════════════════════════════
describe('AC1/AC2 — InviteLinkCard: link éénmalig zichtbaar, na herladen alleen vervaldatum', () => {
  it('AC1 — geen actieve link: genereren toont de volledige URL + kopieerknop + uitleg dat de app zelf niets verstuurt', async () => {
    vi.mocked(createInvite).mockResolvedValue({ url: 'https://pitchup.app/invite/abc123', verlooptOp: '2026-10-01T12:00:00.000Z' })
    render(
      <DictProvider dict={nl}>
        <InviteLinkCard initialActiveInvite={null} />
      </DictProvider>,
    )
    expect(screen.getByText(nl.staf.inviteHint)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.staf.generateLink }))
    })
    expect(screen.getByDisplayValue('https://pitchup.app/invite/abc123')).toBeInTheDocument()
    expect(screen.getByText(nl.staf.linkOnceHint)).toBeInTheDocument()
  })

  it('AC2 — na een ECHTE herlaad (verse mount met alleen initialActiveInvite, zoals getActiveInvite() dat na een reload teruggeeft): GEEN url-veld, alleen de vervaldatum + "Nieuwe link genereren"', () => {
    render(
      <DictProvider dict={nl}>
        <InviteLinkCard initialActiveInvite={{ verlooptOp: '2026-10-01T12:00:00.000Z' }} />
      </DictProvider>,
    )
    expect(screen.queryByDisplayValue(/https?:\/\//)).toBeNull()
    expect(screen.getByText(nl.staf.activeInviteExists, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.staf.regenerateLink })).toBeInTheDocument()
    expect(screen.getByText(nl.staf.regenerateWarning)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC3/AC4 — invite-landing zonder sessie toont teamnaam + twee knoppen;
// ongeldige link toont de neutrale melding zonder teamnaam.
// ════════════════════════════════════════════════════════════════════════
describe('AC3/AC4 — invite-landing (app/invite/[token]/page.tsx)', () => {
  function noSession() {
    installSupabase({ auth: { getUser: async () => ({ data: { user: null } }) }, from: () => realTable([])() })
  }

  it('AC3 — geldige link zonder sessie: teamnaam zichtbaar, twee knoppen ("Account aanmaken" / "Ik heb al een account")', async () => {
    vi.mocked(peekInvite).mockResolvedValue({ status: 'ok', teamNaam: 'JO13-1' })
    noSession()
    const el = await InvitePage({ params: Promise.resolve({ token: 'x'.repeat(43) }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(screen.getByText('voor JO13-1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.invite.createAccount })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nl.invite.haveAccount })).toBeInTheDocument()
  })

  it('AC4 — ongeldige/verlopen/gebruikte link: alleen de neutrale melding, GEEN teamnaam, geen invite-knoppen', async () => {
    vi.mocked(peekInvite).mockResolvedValue({ status: 'invalid', teamNaam: null })
    noSession()
    const el = await InvitePage({ params: Promise.resolve({ token: 'x'.repeat(43) }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(screen.getByText(nl.invite.invalid)).toBeInTheDocument()
    expect(screen.queryByText(/voor /)).toBeNull()
    expect(screen.queryByRole('link', { name: nl.invite.createAccount })).toBeNull()
  })

  it('AC4 (reeds ingelogd) — geldige link met sessie: teamnaam, ingelogd-e-mailadres en de bevestigingsknop, met "uitloggen"-optie', async () => {
    vi.mocked(peekInvite).mockResolvedValue({ status: 'ok', teamNaam: 'JO15-2' })
    installSupabase({
      auth: { getUser: async () => ({ data: { user: { id: ASSISTENT_ID, email: 'assistent@example.com' } } }) },
      from: () => realTable([])(),
    })
    const el = await InvitePage({ params: Promise.resolve({ token: 'y'.repeat(43) }) })
    render(<DictProvider dict={nl}>{el}</DictProvider>)
    expect(screen.getByText('voor JO15-2')).toBeInTheDocument()
    expect(screen.getByText('Ingelogd als assistent@example.com')).toBeInTheDocument()
    expect(screen.getByText(nl.invite.confirmJoin.replace('{team}', 'JO15-2'))).toBeInTheDocument()
    expect(screen.getByText(nl.invite.logoutFirst)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC23-25/AC26 — acceptInvite-uitkomsten in InviteConfirm.
// ════════════════════════════════════════════════════════════════════════
describe('AC23-25/AC26 — InviteConfirm: already_member/invalid/rate_limited', () => {
  it('AC26 — "already_member": neutrale melding "je bent al lid van dit team", geen navigatie', async () => {
    vi.mocked(acceptInvite).mockResolvedValue({ status: 'already_member', teamId: null })
    render(<DictProvider dict={nl}><InviteConfirm token="tok" teamNaam="JO13-1" /></DictProvider>)
    await act(async () => { fireEvent.click(screen.getByText(nl.invite.confirmJoin.replace('{team}', 'JO13-1'))) })
    expect(screen.getByText(nl.invite.alreadyMember)).toBeInTheDocument()
  })

  it('AC23-25 — "invalid" (verlopen/gebruikt/vervangen/onbekend, ÉÉN ononderscheidbare melding)', async () => {
    vi.mocked(acceptInvite).mockResolvedValue({ status: 'invalid', teamId: null })
    render(<DictProvider dict={nl}><InviteConfirm token="tok" teamNaam="JO13-1" /></DictProvider>)
    await act(async () => { fireEvent.click(screen.getByText(nl.invite.confirmJoin.replace('{team}', 'JO13-1'))) })
    expect(screen.getByText(nl.invite.invalid)).toBeInTheDocument()
  })

  it('"rate_limited": eigen melding, de bevestigingsknop blijft bruikbaar (de link is niet verbruikt)', async () => {
    vi.mocked(acceptInvite).mockResolvedValue({ status: 'rate_limited', teamId: null })
    render(<DictProvider dict={nl}><InviteConfirm token="tok" teamNaam="JO13-1" /></DictProvider>)
    await act(async () => { fireEvent.click(screen.getByText(nl.invite.confirmJoin.replace('{team}', 'JO13-1'))) })
    expect(screen.getByText(nl.invite.rateLimited)).toBeInTheDocument()
    expect(screen.getByText(nl.invite.confirmJoin.replace('{team}', 'JO13-1'))).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════════════════════════════════
// BR51/AC3 — registreren via een uitnodiging levert nooit een eigen team op:
// het formulier heeft GEEN teamnaam-veld en draagt het token als hidden veld.
// ════════════════════════════════════════════════════════════════════════
describe('BR51 — InviteRegisterForm: geen teamnaam-veld, hidden token', () => {
  it('geen enkel invoerveld voor een teamnaam; wel e-mail, wachtwoord en een verborgen token-veld met de exacte waarde', () => {
    const { container } = render(<DictProvider dict={nl}><InviteRegisterForm token="het-echte-token" /></DictProvider>)
    expect(screen.queryByLabelText(nl.auth.teamName)).toBeNull()
    expect(container.querySelector('input[name="team_name"]')).toBeNull()
    const hidden = container.querySelector('input[name="token"]') as HTMLInputElement
    expect(hidden).not.toBeNull()
    expect(hidden.type).toBe('hidden')
    expect(hidden.value).toBe('het-echte-token')
  })
})

// ════════════════════════════════════════════════════════════════════════
// AC22 — de bevestigingstekst bij accountverwijdering benoemt alle
// owner-teams, assistent-toegang en de oefeningen-koppelingen (brief §2.6,
// orkestratiebeslissing "rollen-lus naar fase 2"). De rollen-lus zélf (owner
// van twee teams + assistent bij een derde) is al bewezen met de echte
// tabel-engine in assistent-fase1-fundament.acceptance.test.ts
// ("deleteAccount — fase-1-deel van de opruiming" → "ruimt als hoofdtrainer
// van TWEE teams beide teams op, en laat het team waar hij assistent is
// intact"); hier wordt uitsluitend de UI-tekst (AC22) gecontroleerd.
// ════════════════════════════════════════════════════════════════════════
describe('AC22 — DeleteAccountSection: bevestigingstekst benoemt meervoud teams, assistent-toegang en oefeningen-koppelingen', () => {
  it('de hint-tekst noemt "hoofdtrainer" (meervoud van teams), "assistent" en "oefeningen" + "koppelingen"', () => {
    render(<DictProvider dict={nl}><DeleteAccountSection /></DictProvider>)
    const hint = nl.settings.deleteAccountHint
    expect(hint).toMatch(/hoofdtrainer/i)
    expect(hint).toMatch(/assistent/i)
    expect(hint).toMatch(/oefeningen/i)
    expect(hint).toMatch(/koppeling/i)
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  it('de knop leidt naar een typ-VERWIJDER-bevestiging, geen directe verwijdering op één klik', () => {
    render(<DictProvider dict={nl}><DeleteAccountSection /></DictProvider>)
    fireEvent.click(screen.getByRole('button', { name: nl.settings.deleteAccountButton }))
    expect(screen.getByPlaceholderText(nl.settings.deleteConfirmWord)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nl.settings.deleteConfirmFinal })).toBeDisabled()
  })
})

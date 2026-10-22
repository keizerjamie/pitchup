import Link from 'next/link'
import { getAllSettings, saveSettings } from '@/app/actions/settings'
import { redirect } from 'next/navigation'
import { getDict } from '@/lib/i18n'
import { signOut } from '@/app/actions/auth'
import { canEdit, getTeamContext } from '@/lib/team-context'
import TrainingScheduleForm from '@/components/TrainingScheduleForm'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import DeleteAccountSection from '@/components/DeleteAccountSection'
import ThemeSelect from '@/components/ThemeSelect'
import TeamLogoSection from '@/components/TeamLogoSection'
import ClubColorsSection from '@/components/ClubColorsSection'
import ImageIcon from '@/components/icons/ImageIcon'
import GroupIcon from '@/components/icons/GroupIcon'
import StafSection from '@/components/settings/StafSection'
import TeamsSection from '@/components/settings/TeamsSection'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'

// `icon` accepteert ofwel de naam van een glyph uit het zelf-gehoste,
// gesubsette Material Symbols-icoonfont (`.ms`, app/globals.css:117-140) —
// de meeste secties hierboven — ofwel al kant-en-klaar React-icoon-element
// (bv. een inline SVG) voor glyphs die niet in de subset zitten. Zie
// components/icons/ImageIcon.tsx voor de reden achter die uitzondering.
function SectionCard({ icon, title, children }: { icon: string | React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="surface-card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        {typeof icon === 'string' ? (
          <span className="ms text-[20px] text-primary-strong">{icon}</span>
        ) : (
          <span className="text-primary-strong flex-shrink-0">{icon}</span>
        )}
        <span className="font-display text-[16px] font-bold text-ink">{title}</span>
      </div>
      {children}
    </div>
  )
}

export default async function SettingsPage() {
  const [settings, t, ctx] = await Promise.all([
    getAllSettings().catch(() => ({} as Record<string, string>)),
    getDict(),
    getTeamContext(),
  ])

  // Instellingen blijft bereikbaar zonder team (brief §4.2) — `ctx` is dan
  // `null` en elke sectie hieronder die een team vereist blijft verborgen.
  // De secties hieronder volgen brief §4.3 + beslissing 4 (goedkeuring):
  // Weergave/Over/Uitloggen/accountverwijdering voor iedereen, Clublogo/
  // Clubkleuren/Aanwezigheid-default/Staf uitsluitend voor de hoofdtrainer,
  // Trainingsschema ook voor een assistent met Agenda-recht (de ENIGE
  // uitzondering op "een assistent ziet alleen Weergave/Uitloggen/
  // accountverwijdering"), Periodisering-link (mobiel) ook bij
  // Periodisering-recht.
  const isOwner = ctx?.rol === 'owner'
  const magAgenda = ctx ? canEdit(ctx, 'agenda') : false
  const magPeriodisering = ctx ? canEdit(ctx, 'periodisering') : false

  // StafSection is zelf een async server component (haalt listTeamMembers()/
  // getActiveInvite() op). Hier al AWAITEN i.p.v. als <StafSection /> JSX
  // neerzetten: React's normale (niet-RSC) renderer — zoals de acceptatie-
  // tests gebruiken die deze pagina rechtstreeks aanroepen en met
  // testing-library renderen — kan een niet-geawaite, geneste async
  // component niet zelf resolven ("Only Server Components can be async").
  // Binnen de echte Next.js-RSC-pipeline maakt dit geen verschil: Next roept
  // een async server component sowieso gewoon als functie aan.
  const stafSection = isOwner ? await StafSection() : null

  // Teams-sectie (fase 3, brief §4.3, AC 14/49): alle teams waarvan de
  // gebruiker owner is, ongeacht welk team nu actief is. `isOwner` hierboven
  // gaat over het ACTIEVE team — dezelfde gate als Staf — dus deze sectie
  // verschijnt niet voor iemand die elders wel hoofdtrainer is maar nu met
  // een assistent-team actief is (consistent met de rest van §4.3's tabel).
  const eigenTeams = ctx?.teams.filter((team) => team.rol === 'owner') ?? []

  const defaultAttendance = (settings['default_attendance'] ?? 'present') as 'present' | 'unknown'
  const seasonStart = settings['season_start'] ?? ''
  const seasonEnd = settings['season_end'] ?? ''
  const trainingDays = (settings['training_days'] ?? '').split(',').map(Number).filter((n) => !isNaN(n) && n >= 0)
  const trainingTime = settings['training_time'] ?? ''
  const trainingLocation = settings['training_location'] ?? ''

  async function handleSave(formData: FormData) {
    'use server'
    await saveSettings(formData)
    redirect('/settings')
  }

  const radioLabel = 'flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-colors border-[var(--border-soft)] has-[:checked]:border-brand-accent has-[:checked]:bg-surface-sunken'

  // Designronde 3: vier groepen (Weergave, Team, Planning, Account) met een
  // ankernavigatie bovenaan — de pagina was één lange kolom van ±3800px. Elk
  // blok houdt zijn eigen, enige opslaanknop: de blokken slaan los van elkaar
  // op (logo direct bij uploaden, kleuren/aanwezigheid/schema via hun eigen
  // formulier), dus één knop per groep zou die opslaglogica samenvoegen.
  // Volgorde binnen Team blijft logo → kleuren → aanwezigheid (clubkleuren-
  // acceptatietest pint die). Gevarenzone staat als allerlaatste blok.
  const toonTeam = isOwner
  const toonPlanning = isOwner || magAgenda || magPeriodisering
  const groepen = [
    { id: 'weergave', label: t.settings.groupDisplay, zichtbaar: true },
    { id: 'team', label: t.settings.groupTeam, zichtbaar: toonTeam },
    { id: 'planning', label: t.settings.groupPlanning, zichtbaar: toonPlanning },
    { id: 'account', label: t.settings.groupAccount, zichtbaar: true },
  ].filter((g) => g.zichtbaar)

  return (
    <div className="max-w-2xl lg:max-w-3xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />

      <nav
        aria-label={t.settings.groupsNav}
        className="settings-nav sticky z-[var(--z-chrome)] -mx-4 px-4 md:mx-0 md:px-0 py-2"
      >
        <div className="inline-flex max-w-full overflow-x-auto gap-1 p-1 rounded-full bg-surface-sunken border border-[var(--border-soft)]">
          {groepen.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="h-9 px-4 inline-flex items-center whitespace-nowrap text-[13px] font-bold rounded-full text-muted hover:text-ink hover:bg-surface transition-colors">
              {g.label}
            </a>
          ))}
        </div>
      </nav>

      <SettingsGroup id="weergave" label={t.settings.groupDisplay}>
        <SectionCard icon="palette" title={t.settings.displaySection}>
          <div>
            <div className="text-[11px] font-bold text-faint uppercase tracking-wide mb-2">{t.settings.themeLabel}</div>
            <ThemeSelect />
          </div>
          <div>
            <div className="text-[11px] font-bold text-faint uppercase tracking-wide mb-2">{t.settings.languageSection}</div>
            <LanguageSwitcher />
          </div>
        </SectionCard>
      </SettingsGroup>

      {toonTeam && (
        <SettingsGroup id="team" label={t.settings.groupTeam}>
          {/* Club logo — owner-only (brief §4.3) */}
          <SectionCard icon={<ImageIcon className="w-5 h-5" />} title={t.settings.logoSection}>
            <TeamLogoSection initialLogoUrl={settings['team_logo_url'] ?? null} />
          </SectionCard>

          {/* Club colours — owner-only */}
          <SectionCard icon="palette" title={t.settings.clubColorsSection}>
            <ClubColorsSection
              initialPrimary={settings['team_color_primary'] ?? null}
              initialSecondary={settings['team_color_secondary'] ?? null}
            />
          </SectionCard>

          {/* Attendance default — owner-only. Opslaan staat nu ín de kaart. */}
          <form action={handleSave}>
            <SectionCard icon="how_to_reg" title={t.settings.attendanceSection}>
              <p className="text-[13.5px] font-medium text-muted -mt-1">{t.settings.attendanceQuestion}</p>
              <div className="flex flex-col gap-3">
                <label className={radioLabel}>
                  <input type="radio" name="default_attendance" value="present" defaultChecked={defaultAttendance === 'present'} className="w-4 h-4 accent-[var(--primary)]" />
                  <div>
                    <div className="font-bold text-ink flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center"><span className="ms text-[15px]" aria-hidden="true">check</span></span>
                      {t.settings.everyonePresent}
                    </div>
                    <div className="text-[13px] text-faint mt-0.5">{t.settings.everyonePresentHint}</div>
                  </div>
                </label>
                <label className={radioLabel}>
                  <input type="radio" name="default_attendance" value="unknown" defaultChecked={defaultAttendance === 'unknown'} className="w-4 h-4 accent-[var(--faint)]" />
                  <div>
                    <div className="font-bold text-ink flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs font-bold" style={{ background: 'var(--faint)' }}>?</span>
                      {t.settings.everyoneUnknown}
                    </div>
                    <div className="text-[13px] text-faint mt-0.5">{t.settings.everyoneUnknownHint}</div>
                  </div>
                </label>
              </div>
              <div className="flex justify-end">
                <Button type="submit">{t.settings.save}</Button>
              </div>
            </SectionCard>
          </form>

          {/* Staf — owner-only (brief §4.3). listTeamMembers() gooit zelf
              'Geen toegang' voor een assistent, dus deze sectie NOOIT
              renderen buiten isOwner om. */}
          <SectionCard icon={<GroupIcon className="w-5 h-5" />} title={t.staf.section}>
            <p className="text-[13px] text-faint -mt-2">{t.staf.sectionHint}</p>
            {stafSection}
          </SectionCard>

          {/* Teams — owner-only (brief §4.3, fase 3). Los van deleteAccount:
              hier verwijdert de hoofdtrainer één team, niet zijn account. */}
          <SectionCard icon="groups" title={t.teamsBeheer.section}>
            <p className="text-[13px] text-faint -mt-2">{t.teamsBeheer.sectionHint}</p>
            <TeamsSection teams={eigenTeams} />
          </SectionCard>
        </SettingsGroup>
      )}

      {toonPlanning && (
        <SettingsGroup id="planning" label={t.settings.groupPlanning}>
          {/* Training schedule — owner OF assistent met Agenda-recht.
              Dit is de ENIGE uitzondering op "een assistent ziet alleen
              Weergave/Uitloggen/accountverwijdering" (beslissing 4). */}
          {(isOwner || magAgenda) && (
            <SectionCard icon="calendar_month" title={t.settings.scheduleSection}>
              <p className="text-[13px] text-faint -mt-2">{t.settings.scheduleHint}</p>
              <TrainingScheduleForm
                initialSeasonStart={seasonStart}
                initialSeasonEnd={seasonEnd}
                initialDays={trainingDays}
                initialTime={trainingTime}
                initialLocation={trainingLocation}
              />
            </SectionCard>
          )}

          {/* Periodization — mobile entry point, owner of Periodisering-recht */}
          {(isOwner || magPeriodisering) && (
            <Link href="/periodisering" className="block lg:hidden">
              <div className="surface-card px-5 py-4 flex items-center gap-3 hover:bg-surface-sunken transition-colors">
                <span className="ms text-[22px] text-primary-strong flex-shrink-0">monitoring</span>
                <div className="flex-1">
                  <h3 className="font-bold text-ink text-[15px]">{t.settings.periodizationSection}</h3>
                  <p className="text-[13px] text-faint">{t.settings.periodizationHint}</p>
                </div>
                <span className="ms text-[20px] text-faint">chevron_right</span>
              </div>
            </Link>
          )}
        </SettingsGroup>
      )}

      <SettingsGroup id="account" label={t.settings.groupAccount}>
        {/* About */}
        <div className="surface-card px-5 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-[15px] font-bold text-ink mb-0.5">{t.settings.aboutSection}</h3>
            <p className="text-[13px] text-faint">{t.settings.version}</p>
          </div>
          {/* Uitloggen is niet destructief: secundaire knop, niet meer rood. */}
          <form action={signOut} className="flex-shrink-0">
            <Button type="submit" variant="secondary" icon="logout">{t.settings.logout}</Button>
          </form>
        </div>

        {/* Danger zone — altijd het allerlaatste blok */}
        <DeleteAccountSection />
      </SettingsGroup>
    </div>
  )
}

function SettingsGroup({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-kop`} className="settings-group flex flex-col gap-4">
      <h2 id={`${id}-kop`} className="eyebrow px-1 pt-2">{label}</h2>
      {children}
    </section>
  )
}

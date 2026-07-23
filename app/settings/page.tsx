import Link from 'next/link'
import { getAllSettings, saveSettings } from '@/app/actions/settings'
import { redirect } from 'next/navigation'
import { getDict } from '@/lib/i18n'
import { signOut } from '@/app/actions/auth'
import TrainingScheduleForm from '@/components/TrainingScheduleForm'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import DeleteAccountSection from '@/components/DeleteAccountSection'
import ThemeSelect from '@/components/ThemeSelect'

function SectionCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="surface-card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="ms text-[20px] text-primary-strong">{icon}</span>
        <span className="font-display text-[16px] font-bold text-ink">{title}</span>
      </div>
      {children}
    </div>
  )
}

export default async function SettingsPage() {
  const [settings, t] = await Promise.all([
    getAllSettings().catch(() => ({} as Record<string, string>)),
    getDict(),
  ])

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

  return (
    <div className="max-w-lg lg:max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[26px] lg:text-[28px] font-bold tracking-tight text-ink">{t.settings.title}</h1>
        <p className="text-[13.5px] font-semibold text-faint mt-0.5">{t.settings.subtitle}</p>
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start flex flex-col gap-5">
        <div className="flex flex-col gap-5">

          {/* Display: theme + language */}
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

          {/* Attendance default */}
          <form action={handleSave} className="flex flex-col gap-4">
            <SectionCard icon="how_to_reg" title={t.settings.attendanceSection}>
              <p className="text-[13.5px] font-medium text-muted -mt-1">{t.settings.attendanceQuestion}</p>
              <div className="flex flex-col gap-3">
                <label className={radioLabel}>
                  <input type="radio" name="default_attendance" value="present" defaultChecked={defaultAttendance === 'present'} className="w-4 h-4 accent-green-600" />
                  <div>
                    <div className="font-bold text-ink flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold">✓</span>
                      {t.settings.everyonePresent}
                    </div>
                    <div className="text-[13px] text-faint mt-0.5">{t.settings.everyonePresentHint}</div>
                  </div>
                </label>
                <label className={radioLabel}>
                  <input type="radio" name="default_attendance" value="unknown" defaultChecked={defaultAttendance === 'unknown'} className="w-4 h-4 accent-gray-600" />
                  <div>
                    <div className="font-bold text-ink flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs font-bold" style={{ background: 'var(--faint)' }}>?</span>
                      {t.settings.everyoneUnknown}
                    </div>
                    <div className="text-[13px] text-faint mt-0.5">{t.settings.everyoneUnknownHint}</div>
                  </div>
                </label>
              </div>
            </SectionCard>
            <button type="submit" className="w-full py-3 rounded-xl font-bold text-white active:scale-95 transition-all" style={{ background: 'var(--primary)' }}>
              {t.settings.save}
            </button>
          </form>

          {/* Periodization — mobile entry point */}
          <Link href="/periodisering" className="block lg:hidden">
            <div className="surface-card px-5 py-4 flex items-center gap-3 hover:bg-surface-sunken transition-colors">
              <span className="ms text-[22px] text-primary-strong flex-shrink-0">monitoring</span>
              <div className="flex-1">
                <h2 className="font-bold text-ink text-[15px]">{t.settings.periodizationSection}</h2>
                <p className="text-[13px] text-faint">{t.settings.periodizationHint}</p>
              </div>
              <span className="ms text-[20px] text-faint">chevron_right</span>
            </div>
          </Link>

        </div>

        <div className="flex flex-col gap-5">

          {/* Training schedule */}
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

          {/* About */}
          <div className="surface-card px-5 py-4">
            <h2 className="font-display text-[15px] font-bold text-ink mb-0.5">{t.settings.aboutSection}</h2>
            <p className="text-[13px] text-faint">{t.settings.version}</p>
          </div>

          {/* Danger zone */}
          <form action={signOut}>
            <button type="submit" className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm active:scale-95 transition-all"
              style={{ color: '#ef4444', border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)', background: 'color-mix(in srgb, #ef4444 6%, transparent)' }}>
              <span className="ms text-[19px]">logout</span>
              {t.settings.logout}
            </button>
          </form>

          <DeleteAccountSection />

        </div>
      </div>
    </div>
  )
}

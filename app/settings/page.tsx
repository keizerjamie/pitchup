import Link from 'next/link'
import { getAllSettings, saveSettings } from '@/app/actions/settings'
import { redirect } from 'next/navigation'
import { getDict } from '@/lib/i18n'
import { signOut } from '@/app/actions/auth'
import TrainingScheduleForm from '@/components/TrainingScheduleForm'
import LanguageSwitcher from '@/components/LanguageSwitcher'

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

  return (
    <div className="max-w-lg lg:max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{t.settings.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.settings.subtitle}</p>
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start space-y-6 lg:space-y-0">
      <div className="space-y-6">

      {/* Attendance default */}
      <form action={handleSave} className="space-y-4">
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/50">
            <h2 className="font-semibold text-gray-800">{t.settings.attendanceSection}</h2>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-gray-600 mb-4">{t.settings.attendanceQuestion}</p>
            <div className="space-y-3">
              <label className="flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors has-[:checked]:border-accent has-[:checked]:bg-brand-light border-gray-200">
                <input type="radio" name="default_attendance" value="present" defaultChecked={defaultAttendance === 'present'} className="w-4 h-4 accent-green-600" />
                <div>
                  <div className="font-semibold text-gray-800 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold">✓</span>
                    {t.settings.everyonePresent}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">{t.settings.everyonePresentHint}</div>
                </div>
              </label>
              <label className="flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors has-[:checked]:border-gray-400 has-[:checked]:bg-gray-50 border-gray-200">
                <input type="radio" name="default_attendance" value="unknown" defaultChecked={defaultAttendance === 'unknown'} className="w-4 h-4 accent-gray-600" />
                <div>
                  <div className="font-semibold text-gray-800 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-gray-300 text-white flex items-center justify-center text-xs font-bold">?</span>
                    {t.settings.everyoneUnknown}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">{t.settings.everyoneUnknownHint}</div>
                </div>
              </label>
            </div>
          </div>
        </div>
        <button type="submit" className="w-full bg-brand text-white py-3 rounded-xl font-semibold hover:bg-brand-dark active:scale-95 transition-all">
          {t.settings.save}
        </button>
      </form>

      {/* Periodization — mobile entry point (desktop has the sidebar item) */}
      <Link href="/periodisering" transitionTypes={['nav-forward']} className="block lg:hidden">
        <div className="glass-card rounded-2xl px-5 py-4 flex items-center gap-3 hover:shadow-lg transition-shadow">
          <svg className="w-5 h-5 text-brand flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
          <div className="flex-1">
            <h2 className="font-semibold text-gray-800">{t.settings.periodizationSection}</h2>
            <p className="text-sm text-gray-500">{t.settings.periodizationHint}</p>
          </div>
          <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </Link>

      {/* Language */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/50">
          <h2 className="font-semibold text-gray-800">{t.settings.languageSection}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t.settings.languageHint}</p>
        </div>
        <div className="px-5 py-4">
          <LanguageSwitcher />
        </div>
      </div>

      </div>{/* end left column */}

      <div className="space-y-6">

      {/* Training schedule */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/50">
          <h2 className="font-semibold text-gray-800">{t.settings.scheduleSection}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t.settings.scheduleHint}</p>
        </div>
        <div className="px-5 py-5">
          <TrainingScheduleForm
            initialSeasonStart={seasonStart}
            initialSeasonEnd={seasonEnd}
            initialDays={trainingDays}
            initialTime={trainingTime}
            initialLocation={trainingLocation}
          />
        </div>
      </div>

      {/* About */}
      <div className="glass-card rounded-2xl px-5 py-4">
        <h2 className="font-semibold text-gray-800 mb-1">{t.settings.aboutSection}</h2>
        <p className="text-sm text-gray-500">{t.settings.version}</p>
      </div>

      {/* Logout */}
      <form action={signOut}>
        <button type="submit" className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-red-500 border border-red-100 hover:bg-red-50 active:scale-95 transition-all text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          {t.settings.logout}
        </button>
      </form>

      </div>{/* end right column */}
      </div>{/* end grid */}
    </div>
  )
}

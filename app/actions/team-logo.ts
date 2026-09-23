'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE, logError } from '@/lib/errors'
import { MAX_LOGO_BYTES, TEAM_LOGO_BUCKET, sniffImageMimeType, teamLogoPath } from '@/lib/logo-upload'
import { requireTeamContext } from '@/lib/team-context'

// Vaste padconventie: één object per team, extensieloos. De eerste map ís de
// tenant-grens — daar hangt de RLS op storage.objects aan. Die policies heten
// "team-logos: owner schrijft/vervangt/wist teammap" en "team-logos: lid leest
// teammap" en staan sinds fase 1 in supabase/team-rls.sql; de oudere kopieën in
// supabase/team-logo.sql en supabase/rls.sql zijn daar gedropt.
// Het pad wordt altijd uit ctx.teamId opgebouwd, nooit uit client-invoer.
// Bucketnaam en pad komen uit lib/logo-upload.ts, zodat deze action en de
// AVG-opruiming in app/actions/auth.ts niet uit elkaar kunnen lopen. Ze staan
// daar en niet hier omdat een 'use server'-bestand alleen async functies mag
// exporteren.
const LOGO_SETTINGS_KEY = 'team_logo_url'

const NOT_LOGGED_IN = 'Je bent niet (meer) ingelogd. Log opnieuw in en probeer het nogmaals.'
const NO_PERMISSION = 'Alleen de hoofdtrainer kan het clublogo wijzigen.'
// Zelfde tekst als de melding van assertCanEdit/assertIsOwner: neutraal, en
// verraadt niet of het aan de rol, het team of iets anders ligt.
const NO_ACCESS = 'Geen toegang'

// Beide actions geven { error } terug in plaats van te throwen: ze worden vanuit
// een formulier op /settings aangeroepen, waar de melding naast het veld hoort
// te verschijnen. Zelfde contract als updatePassword in app/actions/auth.ts.
export async function uploadTeamLogo(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // requireTeamContext onderscheidt 'Niet ingelogd' van 'Geen team'; die twee
  // mogen niet dezelfde melding krijgen. "Log opnieuw in" helpt niemand die
  // wél is ingelogd maar (vanaf fase 2) geen enkel team meer heeft.
  const ctx = await requireTeamContext().catch((fout: Error) => fout)
  if (ctx instanceof Error) {
    return { error: ctx.message === 'Geen team' ? NO_ACCESS : NOT_LOGGED_IN }
  }
  // Het clublogo is hoofdtrainer-werk, ook voor een assistent met alle zes
  // bewerkrechten. Hier geen assertIsOwner(): deze actions geven { error }
  // terug in plaats van te throwen.
  if (ctx.rol !== 'owner') return { error: NO_PERMISSION }

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Kies een afbeelding om te uploaden.' }
  }

  if (file.size > MAX_LOGO_BYTES) {
    return { error: `Het bestand is te groot. Maximaal ${MAX_LOGO_BYTES / (1024 * 1024)} MB.` }
  }

  // Het type komt uit de magic bytes, niet uit file.type: die header stuurt de
  // client zelf mee. Het gesnifte type is meteen het content-type waarmee we
  // opslaan, zodat het extensieloze object toch correct geserveerd wordt.
  const contentType = sniffImageMimeType(new Uint8Array(await file.arrayBuffer()))
  if (!contentType) {
    return { error: 'Alleen PNG-, JPG- of WebP-afbeeldingen zijn toegestaan.' }
  }

  const path = teamLogoPath(ctx.teamId)
  const { error: uploadError } = await supabase.storage
    .from(TEAM_LOGO_BUCKET)
    .upload(path, file, { upsert: true, contentType, cacheControl: '3600' })

  if (uploadError) {
    logError('team-logo.uploadTeamLogo', uploadError)
    return { error: GENERIC_ERROR_MESSAGE }
  }

  // Cache-buster: het opslagpad is vast per team, dus zonder ?v=... blijft een
  // vervangen logo uit de browser-/CDN-cache komen.
  const { data: { publicUrl } } = supabase.storage.from(TEAM_LOGO_BUCKET).getPublicUrl(path)
  const { error: settingsError } = await supabase
    .from('settings')
    .upsert(
      { team_id: ctx.teamId, key: LOGO_SETTINGS_KEY, value: `${publicUrl}?v=${Date.now()}` },
      { onConflict: 'team_id,key' },
    )

  if (settingsError) {
    logError('team-logo.uploadTeamLogo.settings', settingsError)
    return { error: GENERIC_ERROR_MESSAGE }
  }

  revalidatePath('/settings')
  // Het logo staat in de layout (zijbalk), dus de hele layout moet mee.
  revalidatePath('/', 'layout')
  return { error: null }
}

export async function deleteTeamLogo(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // requireTeamContext onderscheidt 'Niet ingelogd' van 'Geen team'; die twee
  // mogen niet dezelfde melding krijgen. "Log opnieuw in" helpt niemand die
  // wél is ingelogd maar (vanaf fase 2) geen enkel team meer heeft.
  const ctx = await requireTeamContext().catch((fout: Error) => fout)
  if (ctx instanceof Error) {
    return { error: ctx.message === 'Geen team' ? NO_ACCESS : NOT_LOGGED_IN }
  }
  // Het clublogo is hoofdtrainer-werk, ook voor een assistent met alle zes
  // bewerkrechten. Hier geen assertIsOwner(): deze actions geven { error }
  // terug in plaats van te throwen.
  if (ctx.rol !== 'owner') return { error: NO_PERMISSION }

  // Volgorde is bewust: eerst het bestand, dan pas de settings-rij. Faalt de
  // bestandsverwijdering, dan stoppen we en blijft de rij staan — dat is
  // consistent, want er ís dan nog een logo.
  const { error: storageError } = await supabase.storage
    .from(TEAM_LOGO_BUCKET)
    .remove([teamLogoPath(ctx.teamId)])
  if (storageError) {
    logError('team-logo.deleteTeamLogo.storage', storageError)
    return { error: GENERIC_ERROR_MESSAGE }
  }

  // Afwezigheid van de rij = geen logo; we schrijven bewust geen lege string
  // (settings.value is NOT NULL).
  const { error: settingsError } = await supabase
    .from('settings')
    .delete()
    .eq('team_id', ctx.teamId)
    .eq('key', LOGO_SETTINGS_KEY)

  // Faalt alleen dit deel, dan is het bestand al weg en zou een foutmelding de
  // gebruiker aanzetten tot nog een poging die niets meer kan opruimen. We
  // loggen het en melden succes; de achterblijvende rij wijst naar een
  // niet-bestaand object en wordt bij de volgende upload overschreven.
  if (settingsError) logError('team-logo.deleteTeamLogo.settings', settingsError)

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { error: null }
}

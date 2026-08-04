'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-policy'
import { genericError, logError } from '@/lib/errors'
import { getSiteUrl } from '@/lib/site-url'
import {
  PASSWORD_RESET_POLICY,
  SIGN_IN_IP_POLICY,
  SIGN_IN_POLICY,
  SIGN_UP_IP_POLICY,
  SIGN_UP_POLICY,
  checkRateLimit,
  clearRateLimit,
  clientIp,
  ipRateLimitKey,
  rateLimitKey,
  recordAttempt,
} from '@/lib/rate-limit'

function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000))
}

export async function signIn(_prevState: { error: string } | null, formData: FormData) {
  const supabase = await createClient()

  const email = ((formData.get('email') as string) ?? '').trim()
  const password = (formData.get('password') as string) ?? ''

  // Twee tellers: per e-mail+IP tegen het raden van één wachtwoord, én ruimer
  // per IP tegen password spraying (één bron die veel verschillende accounts
  // probeert en zo nooit de eerste teller raakt). De melding is bewust gelijk
  // voor bestaande en niet-bestaande accounts.
  const ip = clientIp(await headers())
  const key = rateLimitKey('signin', email, ip)
  const ipKey = ipRateLimitKey('signin', ip)

  const limited = checkRateLimit(key)
  const ipLimited = checkRateLimit(ipKey)
  if (limited.blocked || ipLimited.blocked) {
    const retryAfterMs = Math.max(limited.retryAfterMs, ipLimited.retryAfterMs)
    return { error: `Te veel inlogpogingen. Probeer het over ${minutes(retryAfterMs)} minuten opnieuw.` }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    recordAttempt(key, SIGN_IN_POLICY)
    recordAttempt(ipKey, SIGN_IN_IP_POLICY)
    return { error: 'E-mailadres of wachtwoord klopt niet' }
  }

  // Alleen de e-mail+IP-teller wordt gewist. De IP-teller blijft staan: anders
  // kan een aanvaller met één eigen geldig account de spray-teller resetten.
  clearRateLimit(key)
  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signUp(_prevState: { error: string } | null, formData: FormData) {
  const supabase = await createClient()

  const email = ((formData.get('email') as string) ?? '').trim()
  const password = (formData.get('password') as string) ?? ''
  const teamName = ((formData.get('team_name') as string) ?? '').trim().slice(0, 80)

  if (!teamName) return { error: 'Vul een teamnaam in' }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn` }
  }

  // Ook registreren is getthrottled — anders is dit het enige auth-endpoint dat
  // onbeperkt aangeroepen kan worden (mass account creation, mail-versturen op
  // kosten van het project). Per e-mail+IP én per IP, want een aanvaller kiest
  // bij elke poging een nieuw adres. Elke poging telt mee, ook een geslaagde.
  const ip = clientIp(await headers())
  const key = rateLimitKey('signup', email, ip)
  const ipKey = ipRateLimitKey('signup', ip)

  const limited = checkRateLimit(key)
  const ipLimited = checkRateLimit(ipKey)
  if (limited.blocked || ipLimited.blocked) {
    const retryAfterMs = Math.max(limited.retryAfterMs, ipLimited.retryAfterMs)
    return { error: `Te veel registratiepogingen. Probeer het over ${minutes(retryAfterMs)} minuten opnieuw.` }
  }
  recordAttempt(key, SIGN_UP_POLICY)
  recordAttempt(ipKey, SIGN_UP_IP_POLICY)

  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) {
    // Eén generieke melding voor élke registratiefout — ook voor "e-mailadres
    // bestaat al". Een aparte melding voor dat geval zou een aanvaller laten
    // aflezen welke adressen een account hebben (user enumeration). De ruwe
    // Supabase-melding gaat alleen als foutcode naar de log.
    logError('auth.signUp', error)
    return { error: 'Registratie is niet gelukt. Controleer je gegevens en probeer het opnieuw.' }
  }
  if (!data.user) return { error: 'Registratie mislukt, probeer opnieuw' }

  // With email confirmation enabled there is no session yet; the settings
  // insert would silently fail under RLS and the redirect would bounce back
  // to /login without explanation.
  if (!data.session) {
    return { error: 'Bevestig eerst je e-mailadres via de link in je inbox, en log daarna in' }
  }

  const { error: settingsError } = await supabase.from('settings').insert({
    team_id: data.user.id,
    key: 'team_name',
    value: teamName,
  })
  if (settingsError) logError('auth.signUp.settings', settingsError)

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function requestPasswordReset(_prevState: { sent: boolean } | null, formData: FormData) {
  const supabase = await createClient()
  const email = ((formData.get('email') as string) ?? '').trim()

  if (email) {
    const key = rateLimitKey('password-reset', email, clientIp(await headers()))

    // De basis-URL komt uit de server-configuratie, nooit uit de `origin`- of
    // `Host`-header: die is door de client te sturen en zou de hersteltoken naar
    // een vreemd domein kunnen laten wijzen.
    const siteUrl = getSiteUrl()

    if (!siteUrl) {
      logError('auth.requestPasswordReset', { code: 'site_url_missing' })
    } else if (!checkRateLimit(key).blocked) {
      recordAttempt(key, PASSWORD_RESET_POLICY)
      // Deliberately ignore the result: the response must not reveal whether
      // the address exists (user enumeration).
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/reset-password`,
      })
    }
  }

  // Altijd hetzelfde antwoord — ook bij throttling of een ontbrekende
  // configuratie — zodat er niets over het adres of de status te concluderen is.
  return { sent: true }
}

// Zet een nieuw wachtwoord voor de ingelogde (of via de herstelmail
// aangemelde) gebruiker. Bewust een server action en geen directe
// `supabase.auth.updateUser()` vanuit de browser: alleen hier is
// MIN_PASSWORD_LENGTH echt af te dwingen — het `minLength`-attribuut op een
// input is met een aangepaste request triviaal te omzeilen.
export async function updatePassword(
  _prevState: { error: string | null } | null,
  formData: FormData,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const password = (formData.get('password') as string) ?? ''

  // Zelfde controle als de andere ingelogde actions: zonder geldige sessie
  // (de herstellink logt de gebruiker in) mag er niets gewijzigd worden.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Je bent niet (meer) ingelogd. Vraag een nieuwe herstellink aan.' }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn` }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    // Ruwe Supabase-melding blijft binnen: alleen context + foutcode in de log.
    logError('auth.updatePassword', error)
    return { error: 'Wachtwoord bijwerken is niet gelukt. Probeer het opnieuw.' }
  }

  revalidatePath('/', 'layout')
  return { error: null }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

// AVG / right to erasure: wipes all of the team's data and the auth account
// itself. Vereist de service-role-key; zonder die key wordt er niets verwijderd.
export async function deleteAccount() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Eerst controleren, dán pas verwijderen: anders zou de data gewist worden
  // terwijl het auth-account blijft bestaan. Faalt hard in plaats van de
  // auth-verwijdering stilzwijgend over te slaan.
  const admin = createAdminClient()
  if (!admin) {
    logError('auth.deleteAccount', { code: 'service_role_key_missing' })
    throw new Error('Account verwijderen is nu niet mogelijk. Neem contact op met de beheerder.')
  }

  // Delete all data owned by this team. RLS restricts each delete to the
  // caller's own rows; events/players cascade to attendance, lineups,
  // metingen and oefeningen, but we clear every table explicitly to be sure.
  for (const table of ['oefeningen', 'metingen', 'attendance', 'lineups', 'events', 'players', 'settings']) {
    const { error } = await supabase.from(table).delete().eq('team_id', user.id)
    if (error) throw genericError(`auth.deleteAccount.${table}`, error)
  }

  const { error: authError } = await admin.auth.admin.deleteUser(user.id)
  if (authError) throw genericError('auth.deleteAccount.authUser', authError)

  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

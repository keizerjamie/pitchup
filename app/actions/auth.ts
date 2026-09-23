'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-policy'
import { genericError, logError } from '@/lib/errors'
import { TEAM_LOGO_BUCKET, teamLogoPath } from '@/lib/logo-upload'
import { getSiteUrl } from '@/lib/site-url'
import { TEAM_NAAM_METADATA_KEY, getTeamContext, maakEigenTeam } from '@/lib/team-context'
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

  const [limited, ipLimited] = await Promise.all([checkRateLimit(key), checkRateLimit(ipKey)])
  if (limited.blocked || ipLimited.blocked) {
    const retryAfterMs = Math.max(limited.retryAfterMs, ipLimited.retryAfterMs)
    return { error: `Te veel inlogpogingen. Probeer het over ${minutes(retryAfterMs)} minuten opnieuw.` }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    await Promise.all([recordAttempt(key, SIGN_IN_POLICY), recordAttempt(ipKey, SIGN_IN_IP_POLICY)])
    return { error: 'E-mailadres of wachtwoord klopt niet' }
  }

  // Alleen de e-mail+IP-teller wordt gewist. De IP-teller blijft staan: anders
  // kan een aanvaller met één eigen geldig account de spray-teller resetten.
  await clearRateLimit(key)
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

  const [limited, ipLimited] = await Promise.all([checkRateLimit(key), checkRateLimit(ipKey)])
  if (limited.blocked || ipLimited.blocked) {
    const retryAfterMs = Math.max(limited.retryAfterMs, ipLimited.retryAfterMs)
    return { error: `Te veel registratiepogingen. Probeer het over ${minutes(retryAfterMs)} minuten opnieuw.` }
  }
  await Promise.all([recordAttempt(key, SIGN_UP_POLICY), recordAttempt(ipKey, SIGN_UP_IP_POLICY)])

  // De teamnaam gaat als user-metadata mee. Staat e-mailbevestiging aan in
  // Supabase, dan is er hieronder nog geen sessie en kunnen de teamrijen niet
  // geschreven worden (RLS); het zelfherstel in lib/team-context.ts maakt het
  // team dan alsnog aan bij de eerste request mét sessie. Zie
  // TEAM_NAAM_METADATA_KEY daar voor de volledige onderbouwing, inclusief
  // waarom dit een expliciete vlag is en geen "nul teams → maak een team".
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { [TEAM_NAAM_METADATA_KEY]: teamName } },
  })

  if (error) {
    // Eén generieke melding voor élke registratiefout — ook voor "e-mailadres
    // bestaat al". Een aparte melding voor dat geval zou een aanvaller laten
    // aflezen welke adressen een account hebben (user enumeration). De ruwe
    // Supabase-melding gaat alleen als foutcode naar de log.
    logError('auth.signUp', error)
    return { error: 'Registratie is niet gelukt. Controleer je gegevens en probeer het opnieuw.' }
  }
  if (!data.user) return { error: 'Registratie mislukt, probeer opnieuw' }

  // Met e-mailbevestiging aan is er nog geen sessie; de teamrijen zouden onder
  // RLS stil mislukken. De metadata-vlag hierboven zorgt dat het zelfherstel
  // in lib/team-context.ts het team alsnog aanmaakt zodra deze gebruiker voor
  // het eerst mét sessie een pagina opent. Dit account is dus NIET stuk.
  if (!data.session) {
    return { error: 'Bevestig eerst je e-mailadres via de link in je inbox, en log daarna in' }
  }

  // Is er wél meteen een sessie, dan maken we het team hier al aan: dat scheelt
  // de gebruiker een halve pagina-render wachten en houdt het faalpad
  // zichtbaar. maakEigenTeam gooit bij een mislukte teams- of owner-rij —
  // zonder die twee is het account onbruikbaar, dus dat mag niet stil gebeuren.
  // De vlag blijft in dat geval staan, zodat het zelfherstel het bij de
  // volgende login alsnog probeert.
  try {
    await maakEigenTeam(supabase, data.user.id, teamName)
  } catch {
    // maakEigenTeam heeft al gelogd via genericError; hier geen tweede log en
    // nooit de ruwe fout naar de client.
    return { error: 'Je account is aangemaakt, maar het opzetten van je team is niet gelukt. Log in om het opnieuw te proberen.' }
  }

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
    } else if (!(await checkRateLimit(key)).blocked) {
      await recordAttempt(key, PASSWORD_RESET_POLICY)
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

  // Bewust getTeamContext() en NIET requireTeamContext(): iemand zonder team
  // moet zijn account kunnen blijven verwijderen (AVG). Dan is er simpelweg
  // geen teamdata om op te ruimen.
  //
  // FASE 1: een account heeft precies één team en is daar owner van, dus deze
  // ene context volstaat. De lus over álle rollen (eigen teams verwijderen,
  // assistent-lidmaatschappen opzeggen) hoort bij fase 3.
  const ctx = await getTeamContext()
  const teamId = ctx?.rol === 'owner' ? ctx.teamId : null

  // Eerst controleren, dán pas verwijderen: anders zou de data gewist worden
  // terwijl het auth-account blijft bestaan. Faalt hard in plaats van de
  // auth-verwijdering stilzwijgend over te slaan.
  const admin = createAdminClient()
  if (!admin) {
    logError('auth.deleteAccount', { code: 'service_role_key_missing' })
    throw new Error('Account verwijderen is nu niet mogelijk. Neem contact op met de beheerder.')
  }

  // Het clublogo staat in Storage en hangt dus aan geen enkele tabel; zonder
  // deze stap zou het bestand na accountverwijdering blijven bestaan (AVG).
  // Bucket en pad komen uit lib/logo-upload.ts — dezelfde bron als
  // app/actions/team-logo.ts, zodat een wijziging van de padconventie deze
  // opruiming niet stil kan laten missen.
  // Bewust logError en géén throw: een ontbrekend object — een team dat nooit
  // een logo uploadde — mag de accountverwijdering niet blokkeren.
  if (teamId) {
    const { error: storageError } = await supabase.storage
      .from(TEAM_LOGO_BUCKET)
      .remove([teamLogoPath(teamId)])
    if (storageError) logError('auth.deleteAccount.storage', storageError)
  }

  // Oefeningen zijn PERSOONLIJK bezit (oefeningen.team_id = de eigenaar-user,
  // geen teams.id) en horen dus bij het account, niet bij het team. Ze gaan
  // altijd mee, ook als dit account nergens hoofdtrainer is. De FK-cascade op
  // training_oefeningen.oefening_id ruimt daarna elke koppeling op — óók in
  // trainingsplannen van andere teams; een cascade wordt op databaseniveau
  // uitgevoerd en is niet aan RLS onderworpen.
  // `eigenaarId` en niet `teamId`: oefeningen.team_id is de EIGENAAR-USER.
  // De naam maakt zichtbaar dat hier bewust de user-id staat en niet de
  // tenant-sleutel.
  const eigenaarId = user.id
  const { error: oefeningError } = await supabase
    .from('oefeningen')
    .delete()
    .eq('team_id', eigenaarId)
  if (oefeningError) throw genericError('auth.deleteAccount.oefeningen', oefeningError)

  if (teamId) {
    // De volledige lijst, in FK-veilige volgorde. Eerder stonden hier alleen
    // zeven tabellen met de aanname dat de rest wel zou cascaden. Dat klopte
    // niet voor categorie_metingen (alleen een team_id, geen FK naar events of
    // players): de nulmetingen per onderdeel bleven als wees achter. RLS
    // beperkt elke delete tot rijen van dit team; het expliciete filter is de
    // tweede laag.
    for (const table of [
      'training_oefeningen',
      'task_overrides',
      'match_squad',
      'match_events',
      'match_ratings',
      'lineups',
      'attendance',
      'absence_periods',
      'categorie_metingen',
      'metingen',
      'events',
      'players',
      'settings',
    ]) {
      const { error } = await supabase.from(table).delete().eq('team_id', teamId)
      if (error) throw genericError(`auth.deleteAccount.${table}`, error)
    }

    // Als laatste het team zelf: de cascade op team_members en team_invites
    // ruimt de lidmaatschappen op, inclusief die van eventuele assistenten.
    const { error: teamError } = await supabase.from('teams').delete().eq('id', teamId)
    if (teamError) throw genericError('auth.deleteAccount.teams', teamError)
  }

  const { error: authError } = await admin.auth.admin.deleteUser(user.id)
  if (authError) throw genericError('auth.deleteAccount.authUser', authError)

  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

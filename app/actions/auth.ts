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
import { isInviteToken, veiligeNextPath } from '@/lib/invite-token'
import { TEAM_NAAM_METADATA_KEY, maakEigenTeam } from '@/lib/team-context'
import { NA_ACCEPTATIE_PAD, verzilverInvite, zetActiefTeamCookie } from '@/lib/team-invites'
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

// Eén melding voor élke ongeldige uitnodiging: verlopen, gebruikt,
// ingetrokken of onbekend zijn bewust niet te onderscheiden (AC 23/24/25).
const INVITE_ONGELDIG = 'Deze uitnodiging is niet (meer) geldig. Vraag de hoofdtrainer om een nieuwe link.'

export async function signIn(_prevState: { error: string } | null, formData: FormData) {
  const supabase = await createClient()

  const email = ((formData.get('email') as string) ?? '').trim()
  const password = (formData.get('password') as string) ?? ''
  // Waar gaan we na het inloggen heen? Alleen een eigen uitnodigingspad komt
  // erdoor; alles anders valt terug op '/'. Zonder die grens is dit een open
  // redirect (`?next=https://kwaadaardig.example`). De regel staat in
  // veiligeNextPath (lib/invite-token.ts) zodat hij niet uit elkaar kan lopen
  // met de tokenvorm zelf.
  const next = veiligeNextPath(formData.get('next'))

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
  redirect(next)
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
  // zichtbaar. maakEigenTeam loopt sinds fase 2 via de RPC create_team, die de
  // teams-rij, de owner-rij en de teamnaam in ÉÉN transactie schrijft — nooit
  // meer een team zonder hoofdtrainer. Hij gooit bij elke fout; zonder team is
  // het account onbruikbaar en dat mag niet stil gebeuren. De vlag blijft in
  // dat geval staan, zodat het zelfherstel het bij de volgende login alsnog
  // probeert.
  try {
    await maakEigenTeam(supabase, teamName)
  } catch {
    // maakEigenTeam heeft al gelogd via genericError; hier geen tweede log en
    // nooit de ruwe fout naar de client.
    return { error: 'Je account is aangemaakt, maar het opzetten van je team is niet gelukt. Log in om het opnieuw te proberen.' }
  }

  revalidatePath('/', 'layout')
  redirect('/')
}

// Registreren VIA EEN UITNODIGING (AC 3, BR 51).
//
// Drie dingen die deze functie bewust NIET doet, en die samen businessregel 51
// afdwingen ("wie via een uitnodiging binnenkomt krijgt geen eigen team"):
//   1. geen teamnaam-veld,
//   2. geen create_team(),
//   3. GEEN metadata-vlag TEAM_NAAM_METADATA_KEY. Die vlag is het enige
//      signaal waaraan het zelfherstel in lib/team-context.ts een gewone
//      registratie herkent; zou hij hier gezet worden, dan kreeg de genodigde
//      na e-mailbevestiging alsnog een leeg eigen team.
//
// Dezelfde rate-limiting als signUp: dit is een tweede weg naar hetzelfde
// supabase.auth.signUp(), dus zonder gedeelde tellers zou hij de limiet van
// signUp omzeilen. Bewust dezelfde scope ('signup'), zodat de twee wegen
// dezelfde teller delen.
export async function signUpViaInvite(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const supabase = await createClient()

  const email = ((formData.get('email') as string) ?? '').trim()
  const password = (formData.get('password') as string) ?? ''
  const token = (formData.get('token') as string) ?? ''

  if (!isInviteToken(token)) return { error: INVITE_ONGELDIG }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn` }
  }

  const ip = clientIp(await headers())
  const key = rateLimitKey('signup', email, ip)
  const ipKey = ipRateLimitKey('signup', ip)

  const [limited, ipLimited] = await Promise.all([checkRateLimit(key), checkRateLimit(ipKey)])
  if (limited.blocked || ipLimited.blocked) {
    const retryAfterMs = Math.max(limited.retryAfterMs, ipLimited.retryAfterMs)
    return { error: `Te veel registratiepogingen. Probeer het over ${minutes(retryAfterMs)} minuten opnieuw.` }
  }
  await Promise.all([recordAttempt(key, SIGN_UP_POLICY), recordAttempt(ipKey, SIGN_UP_IP_POLICY)])

  // Geen `options.data`: zie punt 3 hierboven.
  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) {
    // Eén generieke melding voor élke registratiefout, ook voor "e-mailadres
    // bestaat al" — anders is hieruit af te lezen welke adressen een account
    // hebben (user enumeration). Zelfde regel als in signUp.
    logError('auth.signUpViaInvite', error)
    return { error: 'Registratie is niet gelukt. Controleer je gegevens en probeer het opnieuw.' }
  }
  if (!data.user) return { error: 'Registratie mislukt, probeer opnieuw' }

  // FAALTAK ZONDER SESSIE (e-mailbevestiging staat aan in Supabase, brief
  // §2.2). Er is geen pending-mechanisme en geen extra cookie nodig: de
  // uitnodiging is nog ongebruikt en dus nog geldig, dus de genodigde opent na
  // het bevestigen simpelweg dezelfde link opnieuw.
  if (!data.session) {
    return { error: 'Bevestig eerst je e-mailadres en open daarna de uitnodigingslink opnieuw.' }
  }

  const resultaat = await verzilverInvite(supabase, token, 'auth.signUpViaInvite')
  if (resultaat.status === 'invalid' || !resultaat.teamId) {
    // Het account bestaat nu wél. Dat is geen halve staat: deze persoon kan
    // gewoon inloggen en belandt in de lege staat, waar hij een nieuwe link kan
    // openen of zelf een team kan aanmaken.
    return { error: INVITE_ONGELDIG }
  }

  await zetActiefTeamCookie(resultaat.teamId)
  revalidatePath('/', 'layout')
  // Zelfde bestemming als acceptInvite: registreren via een uitnodiging is
  // óók "je bent toegevoegd aan <team>" en verdient dezelfde bevestiging.
  redirect(NA_ACCEPTATIE_PAD)
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

// De teamdata van ÉÉN team, in FK-veilige volgorde. De lijst is bewust
// volledig en niet "de rest cascadet wel": categorie_metingen heeft alleen een
// team_id en geen FK naar events of players, dus de nulmetingen per onderdeel
// bleven vroeger als wees achter. RLS beperkt elke delete tot rijen waar dit
// account bij mag; het expliciete team_id-filter is de tweede laag.
const TEAM_TABELLEN = [
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
] as const

// AVG / right to erasure: wist alle teams waarvan dit account hoofdtrainer is,
// zegt elk assistent-lidmaatschap op, verwijdert de persoonlijke oefeningen en
// daarna het auth-account zelf. Vereist de service-role-key; zonder die key
// wordt er niets verwijderd.
//
// DE LUS OVER ALLE ROLLEN IS NIET OPTIONEEL SINDS FASE 2. Tot fase 1 had een
// account precies één team en was het daar owner van, dus volstond de actieve
// teamcontext. Vanaf fase 2 leveren createTeam (app/actions/team.ts) en
// acceptInvite (app/actions/team-invites.ts) meerdere lidmaatschappen op.
// Alleen het ACTIEVE team opruimen zou drie dingen stukmaken:
//   1. de data van het niet-actieve team blijft staan — inclusief
//      persoonsgegevens van spelers — terwijl de bevestigingstekst volledige
//      verwijdering belooft;
//   2. de owner-rij van dat team blijft achter met een user_id die niet meer
//      in auth.users bestaat (er is bewust geen FK, zie
//      supabase/teams-en-leden.sql). De sanity-check "geen team zonder
//      hoofdtrainer" slaat daar NIET op aan: het team is onbereikbaar maar
//      ziet er gezond uit;
//   3. assistent-lidmaatschappen bij teams van anderen blijven als wees staan.
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

  // Bewust een directe, op user_id gescopede lees en NIET getTeamContext():
  // die geeft het ACTIEVE team vooraan en is cache()-gewrapt, terwijl hier
  // juist élk lidmaatschap nodig is. Iemand zonder enkel lidmaatschap moet
  // zijn account gewoon kunnen verwijderen (AVG) — dan is deze lijst leeg en
  // is er simpelweg geen teamdata om op te ruimen.
  const { data: ledenRijen, error: ledenError } = await supabase
    .from('team_members')
    .select('team_id, rol')
    .eq('user_id', user.id)
  if (ledenError) throw genericError('auth.deleteAccount.lidmaatschappen', ledenError)

  const rijen = ((ledenRijen ?? []) as { team_id?: unknown; rol?: unknown }[]).filter(
    (rij): rij is { team_id: string; rol: unknown } => typeof rij.team_id === 'string',
  )
  const eigenTeams = rijen.filter((rij) => rij.rol === 'owner').map((rij) => rij.team_id)
  const assistentTeams = rijen.filter((rij) => rij.rol !== 'owner').map((rij) => rij.team_id)

  // ── 1. Eigen teams: alles weg (AC 14, BR 48) ──────────────
  // Elke fout gooit en stopt de hele verwijdering. Dat is met opzet: het
  // auth-account blijft dan bestaan, zodat de gebruiker het opnieuw kan
  // proberen in plaats van achter te blijven met data die aan een verdwenen
  // account hangt. Het contextlabel bevat het volgnummer van het team (niet
  // het id — daar zou een tenant-sleutel mee in de log belanden), zodat een
  // gedeeltelijke mislukking terug te vinden is.
  for (const [index, teamId] of eigenTeams.entries()) {
    const teamLabel = `auth.deleteAccount.team${index + 1}`

    // Het clublogo staat in Storage en hangt dus aan geen enkele tabel; zonder
    // deze stap zou het bestand na accountverwijdering blijven bestaan (AVG).
    // Bucket en pad komen uit lib/logo-upload.ts — dezelfde bron als
    // app/actions/team-logo.ts, zodat een wijziging van de padconventie deze
    // opruiming niet stil kan laten missen.
    // Bewust logError en géén throw: een ontbrekend object — een team dat nooit
    // een logo uploadde — mag de accountverwijdering niet blokkeren.
    const { error: storageError } = await supabase.storage
      .from(TEAM_LOGO_BUCKET)
      .remove([teamLogoPath(teamId)])
    if (storageError) logError(`${teamLabel}.storage`, storageError)

    for (const table of TEAM_TABELLEN) {
      const { error } = await supabase.from(table).delete().eq('team_id', teamId)
      if (error) throw genericError(`${teamLabel}.${table}`, error)
    }

    // Als laatste het team zelf: de cascade op team_members en team_invites
    // ruimt de lidmaatschappen op, inclusief die van eventuele assistenten.
    // Hun accounts blijven bestaan (AC 14).
    const { error: teamError } = await supabase.from('teams').delete().eq('id', teamId)
    if (teamError) throw genericError(`${teamLabel}.teams`, teamError)
  }

  // ── 2. Teams van anderen: alleen het eigen lidmaatschap ───
  // De teamdata blijft volledig intact (AC 10/21) — een assistent die vertrekt
  // neemt niets mee. De DELETE-policy "team_members: owner of vertrek"
  // (supabase/teams-en-leden.sql) staat precies deze eigen rij toe.
  for (const [index, teamId] of assistentTeams.entries()) {
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', user.id)
    if (error) throw genericError(`auth.deleteAccount.lidmaatschap${index + 1}`, error)
  }

  // ── 3. Persoonlijk bezit ──────────────────────────────────
  // Oefeningen zijn PERSOONLIJK bezit (oefeningen.team_id = de eigenaar-user,
  // geen teams.id) en horen dus bij het account, niet bij het team. Ze gaan
  // altijd mee, ook als dit account nergens hoofdtrainer is. De FK-cascade op
  // training_oefeningen.oefening_id ruimt daarna elke koppeling op — óók in
  // trainingsplannen van andere teams; een cascade wordt op databaseniveau
  // uitgevoerd en is niet aan RLS onderworpen.
  // `eigenaarId` en niet een team-id: oefeningen.team_id is de EIGENAAR-USER.
  // De naam maakt zichtbaar dat hier bewust de user-id staat en niet de
  // tenant-sleutel.
  const eigenaarId = user.id
  const { error: oefeningError } = await supabase
    .from('oefeningen')
    .delete()
    .eq('team_id', eigenaarId)
  if (oefeningError) throw genericError('auth.deleteAccount.oefeningen', oefeningError)

  // ── 4. Pas nu het account zelf ────────────────────────────
  // Alle teamdata is hier weg. Andersom zou een mislukking halverwege data
  // achterlaten die aan een niet-bestaand account hangt en die niemand meer
  // kan benaderen.
  const { error: authError } = await admin.auth.admin.deleteUser(user.id)
  if (authError) throw genericError('auth.deleteAccount.authUser', authError)

  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

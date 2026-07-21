'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function signIn(_prevState: { error: string } | null, formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) return { error: 'E-mailadres of wachtwoord klopt niet' }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signUp(_prevState: { error: string } | null, formData: FormData) {
  const supabase = await createClient()

  const email = ((formData.get('email') as string) ?? '').trim()
  const password = (formData.get('password') as string) ?? ''
  const teamName = ((formData.get('team_name') as string) ?? '').trim().slice(0, 80)

  if (!teamName) return { error: 'Vul een teamnaam in' }
  if (password.length < 6) return { error: 'Wachtwoord moet minimaal 6 tekens zijn' }

  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) return { error: error.message }
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
  if (settingsError) console.error('team_name opslaan mislukt:', settingsError.message)

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function requestPasswordReset(_prevState: { sent: boolean } | null, formData: FormData) {
  const supabase = await createClient()
  const email = ((formData.get('email') as string) ?? '').trim()

  if (email) {
    const origin = (await headers()).get('origin') ?? ''
    // Deliberately ignore the result: the response must not reveal whether
    // the address exists (user enumeration).
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    })
  }

  return { sent: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

// AVG / right to erasure: wipes all of the team's data and, when the
// service-role key is configured, the auth account itself.
export async function deleteAccount() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Delete all data owned by this team. RLS restricts each delete to the
  // caller's own rows; events/players cascade to attendance, lineups,
  // metingen and oefeningen, but we clear every table explicitly to be sure.
  for (const table of ['oefeningen', 'metingen', 'attendance', 'lineups', 'events', 'players', 'settings']) {
    const { error } = await supabase.from(table).delete().eq('team_id', user.id)
    if (error) throw new Error(`Verwijderen van ${table} mislukt: ${error.message}`)
  }

  // Remove the auth account itself. Needs the service-role key; without it the
  // data is gone but the (email-only) auth row remains until the key is set.
  const admin = createAdminClient()
  if (admin) {
    await admin.auth.admin.deleteUser(user.id)
  }

  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

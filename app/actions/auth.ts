'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

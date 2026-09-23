import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import InviteRegisterForm from './InviteRegisterForm'

// Registratie via uitnodiging (brief §2.2/§4.4, backend-contract §4):
// dezelfde registratiepagina als app/register/page.tsx, zonder teamnaam-veld
// (BR 51: registreren via een uitnodiging levert nooit een eigen team op).
//
// Server component: `isAuthPage` in proxy.ts dekt alleen /register, niet dit
// pad (backend-feedback §7), dus een reeds-ingelogde bezoeker wordt hier zelf
// netjes teruggestuurd naar de invite-pagina (die herkent zijn sessie en
// toont dan het bevestigingsscherm i.p.v. een tweede keer registreren).
export default async function InviteRegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect(`/invite/${token}`)

  return <InviteRegisterForm token={token} />
}

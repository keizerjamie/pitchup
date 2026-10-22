import { getDict } from '@/lib/i18n'
import PageSkeleton from '@/components/ui/Skeleton'

// Designronde 3: directe reactie op elke paginawissel. Zonder dit bestand
// bleef de oude pagina staan tot de server (Supabase-queries) klaar was — op
// de iPhone voelde een tik daardoor "dood". Deze root-loading geldt voor alle
// routes onder de root-layout; de app-chrome (zijbalk, kop, onderbalk) blijft
// staan omdat die in de layout zit. Next prefetcht dit skelet mee met elke
// <Link>, dus het verschijnt zonder netwerkronde.
export default async function Loading() {
  const t = await getDict()
  return <PageSkeleton label={t.event.loading} />
}

import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

// Pure redirect (AC4). Geen auth-check, geen query, geen tussenscherm — alle
// guards (auth, isUuid, notFound) leven op /players/[id] zelf. `redirect()` in
// een server component is standaard 'replace' (Next-docs redirect.md), dus de
// oude URL verdwijnt uit de history en "terug" vanaf het profiel loopt niet in
// een lus. Bewust geen `type`-argument meegeven.
export default async function PlayerAbsencePage({ params }: Props) {
  const { id } = await params
  redirect(`/players/${id}?tab=aanwezigheid`)
}

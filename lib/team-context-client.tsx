'use client'

// Client-context met rol/rechten/teams van het ACTIEVE team, voor diep geneste
// client components die niet via een prop van hun server-component-pagina
// bereikt kunnen worden (met name components/GlobalFab.tsx, dat overal in de
// chrome zit en niet per pagina een prop krijgt). Zelfde patroon als
// lib/i18n-context.tsx (DictProvider/useDict): een verplichte Provider, een
// hook die zonder Provider hard faalt zodat een vergeten wrap meteen opvalt
// i.p.v. stil undefined-gedrag te geven.
//
// PAGINA-NIVEAU canEdit-PROPS GAAN HIER NIET DOORHEEN. Server components
// (pages) berekenen canEdit(ctx, '<onderdeel>') zelf en geven het resultaat
// als gewone prop door aan hun editors (brief §4.5/§4.6) — dat blijft de
// hoofdweg. Deze context is uitsluitend voor chrome-componenten die overal
// gemount zijn en geen pagina-specifieke prop kunnen krijgen.

import { createContext, useContext } from 'react'
import type { TeamLidmaatschap } from '@/lib/team-context'
import type { TeamRechten, TeamRol } from '@/lib/team-rechten'

export type TeamContextClientValue = {
  teamId: string
  rol: TeamRol
  rechten: TeamRechten
  teams: TeamLidmaatschap[]
}

// null = geen actief team (lege staat) — chrome-componenten die hierop
// leunen (GlobalFab) worden door AppShell dan sowieso niet gerenderd, maar de
// hook blijft defensief null-safe voor het geval dat ooit verandert.
const TeamContextClientContext = createContext<TeamContextClientValue | null | undefined>(undefined)

export function TeamContextClientProvider({
  value,
  children,
}: {
  value: TeamContextClientValue | null
  children: React.ReactNode
}) {
  return (
    <TeamContextClientContext.Provider value={value}>{children}</TeamContextClientContext.Provider>
  )
}

export function useTeamContextClient(): TeamContextClientValue | null {
  const value = useContext(TeamContextClientContext)
  if (value === undefined) {
    throw new Error('useTeamContextClient must be used within TeamContextClientProvider')
  }
  return value
}

// Kleine, pure spiegel van canEdit() uit lib/team-context.ts — die is
// server-only (importeert next/headers) en mag dus niet in een client
// bundle terechtkomen. Zelfde regel: rol==='owner' of het losse recht.
// `ctx === null` (geen actief team) betekent altijd "geen recht".
export function canEditClient(
  ctx: TeamContextClientValue | null,
  onderdeel: keyof TeamRechten,
): boolean {
  if (!ctx) return false
  return ctx.rol === 'owner' || ctx.rechten[onderdeel] === true
}

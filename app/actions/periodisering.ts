'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { MEETBARE_CATEGORIES, type OefeningCategorie } from '@/lib/types'
import { clampStapOverride } from '@/lib/periodization-stappen'
import { isDateString } from '@/lib/season-dates'
import { genericError } from '@/lib/errors'

// ────────────────────────────────────────────────
// Nulmeting per periodiseringsonderdeel
// ────────────────────────────────────────────────
// Eén rij `categorie_metingen` = één meting van één onderdeel op één datum
// (supabase/nulmeting-per-onderdeel.sql). Meerdere rijen per onderdeel vormen
// de geschiedenis; de rij met de HOOGSTE datum is de actuele meting. Er komt
// geen event meer aan te pas — een meting is geen agenda-item.

// Wat de guards van een bestaande rij nodig hebben. `categorie` komt hier
// vandaan en NOOIT uit de client (patroon updateKoppeling in
// app/actions/training-plan.ts): de client mag niet bepalen welk onderdeel er
// bijgewerkt wordt.
type MetingRij = { id: string; categorie: string; datum: string }

// De meting zelf, altijd op team_id gescoped: een rij van een ander team
// bestaat voor deze actie simpelweg niet — zelfde melding als een onbekend id,
// zodat het antwoord niet verraadt dat de rij wél ergens bestaat.
async function haalEigenMeting(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  teamId: string,
): Promise<MetingRij> {
  const { data } = await supabase
    .from('categorie_metingen')
    .select('id, categorie, datum')
    .eq('id', id)
    .eq('team_id', teamId)
    .maybeSingle()
  if (!data) throw new Error('Meting niet gevonden')
  return data as MetingRij
}

// Alleen de nieuwste meting van een onderdeel is te bewerken of te verwijderen;
// de geschiedenis daaronder is alleen-lezen. "Nieuwste" = hoogste datum over
// ALLE rijen van dat onderdeel, ook toekomstige — anders is een vertypt jaartal
// niet meer te corrigeren.
async function assertNieuwsteMeting(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rij: MetingRij,
  teamId: string,
): Promise<void> {
  const { data: nieuwste } = await supabase
    .from('categorie_metingen')
    .select('id')
    .eq('team_id', teamId)
    .eq('categorie', rij.categorie)
    .order('datum', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!nieuwste || nieuwste.id !== rij.id) {
    throw new Error('Alleen de nieuwste meting is te bewerken')
  }
}

// Categorie-specifieke clamp (1 t/m maxStap), zonder clampSteps te dupliceren.
// `?? 1` is puur de typing: clampStapOverride geeft alleen null terug bij een
// null-invoer, en die komt hier nooit voorbij.
function stapVoor(stap: number, categorie: string): number {
  return clampStapOverride(stap, categorie) ?? 1
}

// Nulmeting van één onderdeel opslaan: zonder `id` een nieuwe meting, met `id`
// een correctie op de nieuwste meting van dat onderdeel.
//
// Een stap buiten het bereik levert bewust GEEN foutmelding op maar wordt
// geclampt (zelfde afweging als updateKoppeling); een ongeldige datum wél,
// want daar valt niets zinnigs van te maken. Een datum in de toekomst is
// toegestaan: die telt pas mee vanaf die dag.
export async function saveCategorieMeting(input: {
  id?: string
  categorie: string
  datum: string
  stap: number
  notes: string | null
}): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  // Bij een nieuwe meting komt de categorie van de client en moet ze in de
  // whitelist staan; bij bewerken komt ze uit de opgehaalde rij en wordt het
  // clientveld volledig genegeerd.
  if (input.id === undefined && !MEETBARE_CATEGORIES.includes(input.categorie as OefeningCategorie)) {
    throw new Error('Ongeldig onderdeel')
  }

  // Weigert ook 2026-02-30 en 2026-13-01, die Date stilzwijgend doorrolt.
  if (!isDateString(input.datum)) throw new Error('Ongeldige datum')

  const notes = input.notes?.trim().slice(0, 1000) || null

  if (input.id === undefined) {
    const categorie = input.categorie

    // Twee keer versturen levert één rij op: (team_id, categorie, datum) is de
    // idempotentie-sleutel, de laatste waarde wint.
    const { error } = await supabase.from('categorie_metingen').upsert(
      {
        team_id: user.id,
        categorie,
        datum: input.datum,
        stap: stapVoor(input.stap, categorie),
        notes,
      },
      { onConflict: 'team_id,categorie,datum' },
    )
    if (error) throw genericError('periodisering.saveCategorieMeting', error)
  } else {
    const bestaand = await haalEigenMeting(supabase, input.id, user.id)
    await assertNieuwsteMeting(supabase, bestaand, user.id)

    // Verplaatsen naar een datum waarop dit onderdeel al een meting heeft zou
    // op de UNIQUE-constraint stuklopen; die ruwe fout mag de client niet zien.
    const { data: bezet } = await supabase
      .from('categorie_metingen')
      .select('id')
      .eq('team_id', user.id)
      .eq('categorie', bestaand.categorie)
      .eq('datum', input.datum)
      .neq('id', input.id)
      .maybeSingle()
    if (bezet) throw new Error('Er staat al een meting voor dit onderdeel op deze datum')

    const { error } = await supabase
      .from('categorie_metingen')
      .update({
        datum: input.datum,
        stap: stapVoor(input.stap, bestaand.categorie),
        notes,
      })
      .eq('id', input.id)
      .eq('team_id', user.id)
    if (error) throw genericError('periodisering.saveCategorieMeting', error)
  }

  revalidatePath('/periodisering')
  revalidatePath('/')
}

// Nulmeting verwijderen. Alleen de nieuwste van dat onderdeel; de rest van de
// geschiedenis blijft staan.
export async function deleteCategorieMeting(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')

  const bestaand = await haalEigenMeting(supabase, id, user.id)
  await assertNieuwsteMeting(supabase, bestaand, user.id)

  const { error } = await supabase
    .from('categorie_metingen')
    .delete()
    .eq('id', id)
    .eq('team_id', user.id)

  if (error) throw genericError('periodisering.deleteCategorieMeting', error)

  revalidatePath('/periodisering')
  revalidatePath('/')
}

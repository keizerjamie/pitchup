// Indeling van de inzichtenpagina (/inzichten): welke kaart in welk thema staat
// en welke kaart een conclusie in "Wat valt op" meeneemt.
//
// Puur en zonder React of databasetoegang. Het Signaal-type komt alleen als
// type binnen: lib/inzichten.ts (bepaalSignalen, drempels) blijft ongewijzigd.

import type { Signaal } from '@/lib/inzichten'

export type KaartSleutel =
  | 'vorm'
  | 'opkomstPerMaand'
  | 'aanwezigheid'
  | 'ratings'
  | 'doelpunten'
  | 'topWorstRatings'
  | 'topWorstAanwezigheid'
  | 'trainingsinhoud'
  | 'thuisUit'
  | 'formatie'
  | 'topscorers'
  | 'geleRodeKaarten'
  | 'kwartier'
  | 'tegendoelpunten'
  | 'speelkansen'
  | 'stijgersDalers'
  | 'positiedekking'
  | 'opkomstSelectieRating'
  | 'blessuresPerMaand'
  | 'speelminuten'
  | 'belasting'
  | 'periodiseringVoortgang'
  | 'invulDiscipline'
  | 'srpe'
  | 'doelstellingOordeel'

export type ThemaSleutel = 'team' | 'wedstrijden' | 'spelers' | 'training'

export interface ThemaDefinitie {
  sleutel: ThemaSleutel
  // Volgorde = de volgorde van het oude grid.
  kaarten: readonly KaartSleutel[]
  standaardOpen: boolean
}

export const THEMAS: readonly ThemaDefinitie[] = [
  {
    sleutel: 'team',
    kaarten: ['vorm', 'opkomstPerMaand', 'aanwezigheid', 'ratings', 'doelpunten', 'topWorstRatings', 'topWorstAanwezigheid', 'trainingsinhoud'],
    standaardOpen: true,
  },
  {
    sleutel: 'wedstrijden',
    kaarten: ['thuisUit', 'formatie', 'topscorers', 'geleRodeKaarten', 'kwartier', 'tegendoelpunten'],
    standaardOpen: false,
  },
  {
    sleutel: 'spelers',
    kaarten: ['speelkansen', 'stijgersDalers', 'positiedekking', 'opkomstSelectieRating', 'blessuresPerMaand', 'speelminuten'],
    standaardOpen: false,
  },
  {
    sleutel: 'training',
    kaarten: ['belasting', 'periodiseringVoortgang', 'invulDiscipline', 'srpe', 'doelstellingOordeel'],
    standaardOpen: false,
  },
]

// Kaarten die over de volle breedte van het twee-koloms-raster staan.
export const BREDE_KAARTEN: ReadonlySet<KaartSleutel> = new Set<KaartSleutel>([
  'vorm',
  'speelkansen',
  'opkomstSelectieRating',
  'belasting',
])

export type ConclusieActie = 'spelers' | 'kalender'

export const ACTIE_HREF: Record<ConclusieActie, string> = {
  spelers: '/players',
  kalender: '/events',
}

const SIGNAAL_KOPPELING: Record<string, { kaart: KaartSleutel; actie: ConclusieActie }> = {
  'spelers-onder-drempel': { kaart: 'topWorstAanwezigheid', actie: 'spelers' },
  'opkomst-onder-doel': { kaart: 'opkomstPerMaand', actie: 'kalender' },
  'opkomst-boven-doel': { kaart: 'opkomstPerMaand', actie: 'kalender' },
  'rating-daling': { kaart: 'ratings', actie: 'spelers' },
  'rating-stijging': { kaart: 'ratings', actie: 'spelers' },
  'doelsaldo-negatief': { kaart: 'thuisUit', actie: 'kalender' },
  'doelsaldo-positief': { kaart: 'thuisUit', actie: 'kalender' },
  'speler-daler': { kaart: 'stijgersDalers', actie: 'spelers' },
  'speler-stijger': { kaart: 'stijgersDalers', actie: 'spelers' },
  'positie-zonder-fit': { kaart: 'positiedekking', actie: 'spelers' },
}

export interface Conclusie {
  signaalId: string
  // null = geen eigen kaart: onbekend id, of de kaart is al door een eerder
  // signaal geclaimd (dan is zelfdeGrafiek true).
  kaart: KaartSleutel | null
  actie: ConclusieActie | null
  zelfdeGrafiek: boolean
}

export interface Koppeling {
  conclusies: Conclusie[]
  // Kaarten die naar "Wat valt op" verhuizen en dus niet meer in een thema staan.
  verhuisd: Set<KaartSleutel>
}

export function koppelSignalen(signalen: readonly Pick<Signaal, 'id'>[]): Koppeling {
  const verhuisd = new Set<KaartSleutel>()
  const conclusies: Conclusie[] = signalen.map((s) => {
    const koppeling = SIGNAAL_KOPPELING[s.id]
    if (!koppeling) return { signaalId: s.id, kaart: null, actie: null, zelfdeGrafiek: false }
    if (verhuisd.has(koppeling.kaart)) {
      return { signaalId: s.id, kaart: null, actie: koppeling.actie, zelfdeGrafiek: true }
    }
    verhuisd.add(koppeling.kaart)
    return { signaalId: s.id, kaart: koppeling.kaart, actie: koppeling.actie, zelfdeGrafiek: false }
  })
  return { conclusies, verhuisd }
}

export interface ThemaIndeling {
  sleutel: ThemaSleutel
  kaarten: KaartSleutel[]
  standaardOpen: boolean
}

// Thema's in vaste volgorde, zonder verhuisde kaarten en zonder lege thema's.
export function verdeelOverThemas(verhuisd: ReadonlySet<KaartSleutel>): ThemaIndeling[] {
  return THEMAS.map((thema) => ({
    sleutel: thema.sleutel,
    kaarten: thema.kaarten.filter((k) => !verhuisd.has(k)),
    standaardOpen: thema.standaardOpen,
  })).filter((thema) => thema.kaarten.length > 0)
}

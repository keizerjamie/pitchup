// Pure validatie voor de clublogo-upload. Bewust geen 'use server' en geen
// React: hierdoor is dit los te testen én te hergebruiken door de server action
// (app/actions/team-logo.ts).

// Zelfde grens als file_size_limit op de bucket (supabase/team-logo.sql):
// de database is het tweede vangnet, deze controle het eerste.
export const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2MB

// Bucketnaam en padconventie staan hier en niet in de server action, zodat élke
// plek die het logobestand aanraakt (upload/verwijderen in
// app/actions/team-logo.ts én de AVG-opruiming in app/actions/auth.ts) dezelfde
// bron gebruikt. Een 'use server'-bestand mag alleen async functies exporteren,
// dus delen vanuit de action zelf kan niet.
export const TEAM_LOGO_BUCKET = 'team-logos'

// Padconventie: team-logos/<team_id>/logo. Het eerste padsegment ÍS de
// tenant-grens: de RLS op storage.objects eist
// (storage.foldername(name))[1] = auth.uid() (supabase/team-logo.sql,
// supabase/rls.sql). Wijzigt deze functie, dan moet die policy mee — en
// andersom. De userId komt altijd uit de sessie, nooit uit client-invoer.
// Vaste, extensieloze bestandsnaam, zodat een vervangende upload met upsert
// hetzelfde object overschrijft en er geen wees-bestand kan ontstaan.
export function teamLogoPath(userId: string): string {
  return `${userId}/logo`
}

export type LogoMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

// Herkent het bestandstype aan de MAGIC BYTES, niet aan `file.type`: die header
// komt van de client en is triviaal te vervalsen (een .exe met
// Content-Type: image/png). Alleen wat hier herkend wordt, gaat als
// content-type mee naar Storage.
export function sniffImageMimeType(bytes: Uint8Array): LogoMimeType | null {
  // PNG: 89 50 4E 47
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return 'image/png'
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  // WebP: 'RIFF' op 0-3 en 'WEBP' op 8-11 (bytes 4-7 zijn de bestandsgrootte).
  // Beide blokken zijn nodig: 'RIFF' alleen dekt ook WAV/AVI.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  return null
}

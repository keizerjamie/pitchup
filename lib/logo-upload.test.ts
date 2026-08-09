import { describe, it, expect } from 'vitest'
import { MAX_LOGO_BYTES, TEAM_LOGO_BUCKET, sniffImageMimeType, teamLogoPath } from '@/lib/logo-upload'

// Echte kopbytes van de drie toegestane formaten. Wat erachter komt doet er
// voor de detectie niet toe, dus de "bestanden" zijn bewust minimaal.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // 'RIFF'
  0x24, 0x00, 0x00, 0x00, // bestandsgrootte
  0x57, 0x45, 0x42, 0x50, // 'WEBP'
  0x56, 0x50, 0x38, 0x20, // 'VP8 '
])

describe('sniffImageMimeType — herkent de toegestane formaten', () => {
  it('herkent PNG', () => {
    expect(sniffImageMimeType(PNG)).toBe('image/png')
  })

  it('herkent JPEG', () => {
    expect(sniffImageMimeType(JPEG)).toBe('image/jpeg')
  })

  it('herkent WebP', () => {
    expect(sniffImageMimeType(WEBP)).toBe('image/webp')
  })

  it('kijkt alleen naar de kop, niet naar de rest van het bestand', () => {
    const groot = new Uint8Array(5000)
    groot.set(PNG, 0)
    expect(sniffImageMimeType(groot)).toBe('image/png')
  })
})

describe('sniffImageMimeType — weigert al het andere', () => {
  it('weigert een lege byte-array', () => {
    expect(sniffImageMimeType(new Uint8Array([]))).toBeNull()
  })

  it('weigert een te korte array die op PNG lijkt', () => {
    expect(sniffImageMimeType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull()
  })

  it('weigert een te korte array die op JPEG lijkt', () => {
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })

  it('weigert willekeurige bytes', () => {
    expect(sniffImageMimeType(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]))).toBeNull()
  })

  it('weigert een PDF (%PDF-kop)', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    expect(sniffImageMimeType(pdf)).toBeNull()
  })

  it('weigert een GIF — geldig plaatje, maar niet toegestaan', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00])
    expect(sniffImageMimeType(gif)).toBeNull()
  })

  it('weigert een RIFF-bestand dat geen WEBP is (bv. WAV)', () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // 'WAVE'
      0x66, 0x6d, 0x74, 0x20,
    ])
    expect(sniffImageMimeType(wav)).toBeNull()
  })

  it('weigert een RIFF-kop zonder de tweede vier bytes', () => {
    expect(sniffImageMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]))).toBeNull()
  })

  it('weigert bytes met de juiste letters op de verkeerde plek', () => {
    // 'WEBP' staat hier op offset 4 in plaats van 8.
    const verschoven = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x57, 0x45, 0x42, 0x50,
      0x00, 0x00, 0x00, 0x00,
    ])
    expect(sniffImageMimeType(verschoven)).toBeNull()
  })
})

describe('MAX_LOGO_BYTES', () => {
  it('is 2 MB, gelijk aan de file_size_limit op de bucket', () => {
    expect(MAX_LOGO_BYTES).toBe(2097152)
  })
})

describe('TEAM_LOGO_BUCKET', () => {
  it('is de bucket uit supabase/team-logo.sql en supabase/schema.sql', () => {
    expect(TEAM_LOGO_BUCKET).toBe('team-logos')
  })
})

describe('teamLogoPath — vastgelegde padconventie', () => {
  const teamId = '11111111-1111-4111-8111-111111111111'

  it('bouwt <team_id>/logo', () => {
    expect(teamLogoPath(teamId)).toBe(`${teamId}/logo`)
  })

  // Dragend voor de tenant-isolatie: de RLS op storage.objects vergelijkt
  // (storage.foldername(name))[1] met auth.uid(). Staat het team-id niet in het
  // EERSTE padsegment, dan valt die afscherming weg.
  it('zet het team-id in het eerste padsegment', () => {
    expect(teamLogoPath(teamId).split('/')[0]).toBe(teamId)
  })

  it('geeft per team een eigen pad', () => {
    expect(teamLogoPath('team-a')).not.toBe(teamLogoPath('team-b'))
  })

  // Extensieloze, vaste bestandsnaam: daardoor overschrijft een vervangende
  // upload met upsert hetzelfde object en blijft er geen wees-bestand achter.
  it('gebruikt één vaste, extensieloze bestandsnaam per team', () => {
    const segmenten = teamLogoPath(teamId).split('/')
    expect(segmenten).toHaveLength(2)
    expect(segmenten[1]).toBe('logo')
    expect(segmenten[1]).not.toContain('.')
  })
})

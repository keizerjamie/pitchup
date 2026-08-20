import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Repo-hygiene: geen onzichtbare controletekens in de bron.
//
// Aanleiding (2026-08-20): in lib/lineup-form.ts stond de scheider tussen
// event- en spelerid als LETTERLIJKE 0x00-byte in plaats van als escape.
// Gevolg: `file` zag het bestand als 'data' en een gewone `grep` sloeg het
// zonder waarschuwing over. Geen foutmelding, geen rode check, geen lint-klacht
// — het bestand was onvindbaar bij elke repo-brede zoekactie. lib/lineup-form.test.ts
// bewaakt sindsdien dat ene bestand; deze test doet dat voor de hele repo.
//
// Zelfreferentie: dit bestand beschrijft controletekens uitsluitend in
// escape-notatie (de zes tekens backslash-u-0-0-0-0), nooit als echte byte.
// Daarom wordt het gewoon meegescand en NIET uitgezonderd: een echt defect in
// dit bestand hoort net zo hard rood te worden als elders. De test hieronder
// 'zondert zichzelf niet uit' legt dat vast.

// --- Wat we scannen -------------------------------------------------------

// Allowlist in plaats van blocklist: we lopen alleen deze mappen af, plus de
// losse bronbestanden in de projectroot (o.a. de *.acceptance.test.tsx,
// proxy.ts en de configs). node_modules/, .next/, .git/ en public/ zijn zo
// structureel onbereikbaar — er valt geen build-output "per ongeluk" binnen.
const BRON_MAPPEN = ['lib', 'app', 'components', 'scripts', 'messages', 'supabase'] as const

// Alles wat als tekst geschreven en met grep teruggezocht wordt. Binaire
// assets (public/) en .json blijven erbuiten: JSON met een controlteken erin
// laat JSON.parse hard struikelen, dus dat faalt al luid uit zichzelf.
const BRON_EXTENSIES = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.sql',
  '.css',
  '.md',
])

const ROOT = process.cwd()
const DIT_BESTAND = 'bronbestanden-controletekens.test.ts'

// --- Welke tekens zijn fout ----------------------------------------------

// Verboden: alle C0-controltekens (0x00–0x1F) plus DEL (0x7F).
// Uitgezonderd: tab (0x09), line feed (0x0A) en carriage return (0x0D) — die
// horen in tekstbestanden thuis en mogen nooit vals alarm geven.
//
// De scan is bewust op BYTE-niveau, niet op code points. In geldige UTF-8
// komen bytes < 0x80 uitsluitend voor als het ASCII-teken zelf; vervolgbytes
// van meerbyte-tekens (é, 🙂) liggen altijd >= 0x80. Byte-scannen kan dus
// geen vals alarm geven op niet-ASCII tekst, en het scheelt het decoderen van
// elk bestand.
const TOEGESTANE_CONTROLTEKENS = new Set([0x09, 0x0a, 0x0d])

const NAMEN: Record<number, string> = {
  0x00: 'NUL',
  0x01: 'SOH',
  0x02: 'STX',
  0x03: 'ETX',
  0x04: 'EOT',
  0x05: 'ENQ',
  0x06: 'ACK',
  0x07: 'BEL',
  0x08: 'BS',
  0x0b: 'VT',
  0x0c: 'FF',
  0x0e: 'SO',
  0x0f: 'SI',
  0x10: 'DLE',
  0x11: 'DC1',
  0x12: 'DC2',
  0x13: 'DC3',
  0x14: 'DC4',
  0x15: 'NAK',
  0x16: 'SYN',
  0x17: 'ETB',
  0x18: 'CAN',
  0x19: 'EM',
  0x1a: 'SUB',
  0x1b: 'ESC',
  0x1c: 'FS',
  0x1d: 'GS',
  0x1e: 'RS',
  0x1f: 'US',
  0x7f: 'DEL',
}

function isVerbodenControlbyte(byte: number): boolean {
  if (byte === 0x7f) return true
  return byte < 0x20 && !TOEGESTANE_CONTROLTEKENS.has(byte)
}

function hex(byte: number): string {
  return `0x${byte.toString(16).padStart(2, '0')}`
}

function escape(codePoint: number): string {
  return `\\u${codePoint.toString(16).padStart(4, '0')}`
}

// Regel + kolom worden pas berekend als er echt een treffer is; de hete lus
// hieronder telt alleen bytes.
function positie(buf: Buffer, offset: number): { regel: number; kolom: number } {
  let regel = 1
  let regelStart = 0
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) {
      regel++
      regelStart = i + 1
    }
  }
  // Kolom in tekens, niet in bytes: dat is wat een editor toont.
  return { regel, kolom: buf.toString('utf8', regelStart, offset).length + 1 }
}

// Toont de regel met alle controletekens als escape, zodat de melding zelf
// niet opnieuw onleesbaar wordt.
function regelFragment(buf: Buffer, offset: number): string {
  let start = offset
  while (start > 0 && buf[start - 1] !== 0x0a) start--
  let eind = offset
  while (eind < buf.length && buf[eind] !== 0x0a) eind++
  const ruw = buf.toString('utf8', start, eind).replace(/\r$/, '')
  const zichtbaar = Array.from(ruw)
    .map((teken) => {
      const cp = teken.codePointAt(0) ?? 0
      return cp === 0x09 || (cp >= 0x20 && cp !== 0x7f) ? teken : escape(cp)
    })
    .join('')
  return zichtbaar.length > 120 ? `${zichtbaar.slice(0, 120)}…` : zichtbaar
}

/** Meldingen voor één bestand; leeg als het bestand schoon is. */
function scanInhoud(relatiefPad: string, buf: Buffer): string[] {
  const meldingen: string[] = []
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]
    if (!isVerbodenControlbyte(byte)) continue
    const { regel, kolom } = positie(buf, i)
    const naam = NAMEN[byte] ?? 'C0'
    meldingen.push(
      `${relatiefPad}:${regel}:${kolom} — ${naam} (${hex(byte)}) op byte-offset ${i}. ` +
        `Regel: "${regelFragment(buf, i)}". ` +
        `Vervang de kale byte door de escape ${escape(byte)} in de bron.`
    )
  }
  return meldingen
}

/** Alle bronbestanden onder een map, recursief, in stabiele volgorde. */
function bestandenIn(map: string): string[] {
  const gevonden: string[] = []
  for (const item of readdirSync(map, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const volledig = path.join(map, item.name)
    if (item.isDirectory()) {
      gevonden.push(...bestandenIn(volledig))
    } else if (item.isFile() && BRON_EXTENSIES.has(path.extname(item.name))) {
      gevonden.push(volledig)
    }
  }
  return gevonden
}

/** De bronbestanden van het project: BRON_MAPPEN + losse bestanden in de root. */
function verzamelBronbestanden(root: string): string[] {
  const losseRootbestanden = readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isFile() && BRON_EXTENSIES.has(path.extname(item.name)))
    .map((item) => path.join(root, item.name))
    .sort()
  const uitMappen = BRON_MAPPEN.flatMap((map) => bestandenIn(path.join(root, map)))
  return [...losseRootbestanden, ...uitMappen]
}

function scanBestanden(root: string, bestanden: string[]): string[] {
  return bestanden.flatMap((bestand) =>
    scanInhoud(path.relative(root, bestand), readFileSync(bestand))
  )
}

const BRONBESTANDEN = verzamelBronbestanden(ROOT)
const RELATIEF = BRONBESTANDEN.map((bestand) => path.relative(ROOT, bestand))

// --- De bewaking zelf -----------------------------------------------------

describe('bronbestanden — controletekens', () => {
  it('bevat nergens een controlteken dat er niet hoort', () => {
    // Faalt dit: de melding noemt bestand, regel:kolom, naam en hexcode van het
    // teken en de regel eromheen. Repareer de bron; zonder deze test blijft
    // zo'n bestand onzichtbaar voor grep.
    expect(scanBestanden(ROOT, BRONBESTANDEN)).toEqual([])
  })

  it('scant daadwerkelijk de hele bron en niet stiekem nul bestanden', () => {
    // Zonder deze controle zou een kapotte walker de test altijd groen maken.
    expect(BRONBESTANDEN.length).toBeGreaterThan(200)
    expect(RELATIEF).toContain(path.join('lib', 'lineup-form.ts'))
    expect(RELATIEF).toContain(path.join('components', 'LineupBuilder.tsx'))
    expect(RELATIEF).toContain(path.join('messages', 'nl.ts'))
    expect(RELATIEF).toContain(path.join('supabase', 'schema.sql'))
    expect(RELATIEF).toContain(path.join('scripts', 'smoke.mjs'))
    expect(RELATIEF).toContain('proxy.ts')
    // Een acceptance-test uit de projectroot hoort er ook bij.
    expect(RELATIEF.some((p) => p.endsWith('.acceptance.test.tsx'))).toBe(true)
    // En een route-handler diep in app/.
    expect(RELATIEF.some((p) => p.startsWith(`app${path.sep}`))).toBe(true)
  })

  it('zondert zichzelf niet uit', () => {
    // Deze test schrijft over controletekens; hij mag zichzelf daarom niet
    // buiten de scan houden — dat zou een echt defect hier verbergen.
    expect(RELATIEF).toContain(DIT_BESTAND)
    const eigenBron = readFileSync(path.join(ROOT, DIT_BESTAND))
    expect(scanInhoud(DIT_BESTAND, eigenBron)).toEqual([])
    // De notatie staat er als escape-tekst in, niet als byte.
    expect(eigenBron.toString('utf8')).toContain('backslash-u-0-0-0-0')
  })

  it('raakt geen build-output of dependencies aan', () => {
    expect(RELATIEF.filter((p) => p.split(path.sep).some((deel) => deel === 'node_modules'))).toEqual([])
    expect(RELATIEF.filter((p) => p.split(path.sep).some((deel) => deel.startsWith('.')))).toEqual([])
  })
})

describe('scanInhoud — wat wel en niet fout is', () => {
  const buf = (tekst: string) => Buffer.from(tekst, 'utf8')

  it('laat tab, line feed en carriage return met rust', () => {
    const tekst = 'const a = 1\tconst b = 2\r\n\tregel twee\n'
    expect(scanInhoud('x.ts', buf(tekst))).toEqual([])
  })

  it('geeft geen vals alarm op niet-ASCII tekst', () => {
    // Vervolgbytes van meerbyte-UTF-8 liggen >= 0x80 en mogen nooit als
    // controlteken gelden.
    expect(scanInhoud('x.ts', buf('naïeve strafschop — 🙂 ü ß 日本語'))).toEqual([])
  })

  it('vangt een NUL-byte en noemt bestand, regel, kolom en code', () => {
    const inhoud = Buffer.concat([buf('regel een\nconst sleutel = `a'), Buffer.from([0x00]), buf('b`\n')])
    const meldingen = scanInhoud('lib/voorbeeld.ts', inhoud)
    expect(meldingen).toHaveLength(1)
    expect(meldingen[0]).toContain('lib/voorbeeld.ts:2:19')
    expect(meldingen[0]).toContain('NUL')
    expect(meldingen[0]).toContain('0x00')
    // De regel eromheen staat erbij, met het teken leesbaar als escape.
    expect(meldingen[0]).toContain('const sleutel = `a\\u0000b`')
  })

  it('vangt ook de andere C0-tekens en DEL', () => {
    for (const [byte, naam] of [
      [0x01, 'SOH'],
      [0x07, 'BEL'],
      [0x08, 'BS'],
      [0x0b, 'VT'],
      [0x0c, 'FF'],
      [0x1a, 'SUB'],
      [0x1b, 'ESC'],
      [0x1f, 'US'],
      [0x7f, 'DEL'],
    ] as const) {
      const meldingen = scanInhoud('x.ts', Buffer.concat([buf('abc'), Buffer.from([byte]), buf('def')]))
      expect(meldingen).toHaveLength(1)
      expect(meldingen[0]).toContain(naam)
      expect(meldingen[0]).toContain('x.ts:1:4')
    }
  })

  it('telt regels vanaf 1 en kolommen in tekens, niet in bytes', () => {
    // Vier meerbyte-tekens vóór de NUL: kolom 5, niet 9.
    const inhoud = Buffer.concat([buf('\n\nöööö'), Buffer.from([0x00])])
    expect(scanInhoud('x.ts', inhoud)[0]).toContain('x.ts:3:5')
  })

  it('meldt elk voorkomen apart', () => {
    const inhoud = Buffer.concat([Buffer.from([0x00]), buf('a\nb'), Buffer.from([0x00])])
    expect(scanInhoud('x.ts', inhoud)).toHaveLength(2)
  })
})

// --- Bewijs dat de bewaking bijt ------------------------------------------

describe('mutatiebewijs — de scan vangt een echt besmet bestand', () => {
  it('vindt een NUL in een bestand diep in de boom en is daarna weer schoon', () => {
    const tijdelijk = mkdtempSync(path.join(tmpdir(), 'controletekens-'))
    try {
      const diep = path.join(tijdelijk, 'lib', 'sub')
      mkdirSync(diep, { recursive: true })
      const schoon = path.join(diep, 'schoon.ts')
      const besmet = path.join(diep, 'besmet.ts')
      writeFileSync(schoon, 'export const a = 1\n\texport const b = 2\r\n')
      writeFileSync(
        besmet,
        Buffer.concat([Buffer.from('export const s = `x', 'utf8'), Buffer.from([0x00]), Buffer.from('y`\n', 'utf8')])
      )

      const bestanden = bestandenIn(tijdelijk)
      expect(bestanden).toHaveLength(2)

      const meldingen = scanBestanden(tijdelijk, bestanden)
      expect(meldingen).toHaveLength(1)
      expect(meldingen[0]).toContain(path.join('lib', 'sub', 'besmet.ts'))
      expect(meldingen[0]).toContain('NUL')
      expect(meldingen[0]).not.toContain('schoon.ts')

      // Herstel: zonder de kale byte is het weer stil.
      writeFileSync(besmet, 'export const s = `x\\u0000y`\n')
      expect(scanBestanden(tijdelijk, bestandenIn(tijdelijk))).toEqual([])
    } finally {
      rmSync(tijdelijk, { recursive: true, force: true })
    }
  })

  it('kijkt alleen naar bronextensies, niet naar binaire assets', () => {
    const tijdelijk = mkdtempSync(path.join(tmpdir(), 'controletekens-'))
    try {
      writeFileSync(path.join(tijdelijk, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x1b]))
      writeFileSync(path.join(tijdelijk, 'dump.bin'), Buffer.from([0x00, 0x00]))
      expect(bestandenIn(tijdelijk)).toEqual([])
      expect(scanBestanden(tijdelijk, bestandenIn(tijdelijk))).toEqual([])
    } finally {
      rmSync(tijdelijk, { recursive: true, force: true })
    }
  })
})

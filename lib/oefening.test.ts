import { describe, it, expect } from 'vitest'
import {
  OEFENING_INHOUD_KOLOMMEN,
  oefeningKopieRij,
  validateOefening,
  type OefeningInput,
} from '@/lib/oefening'

// Dit bestand dekt bewust ALLEEN de regels rond flexibele oefenvormen
// (grootteMax / aantal_neutralen_max) en, onderaan, de kopieer-rij van fase 4
// (OEFENING_INHOUD_KOLOMMEN / oefeningKopieRij). De overige validatie van
// validateOefening is al gedekt via app/actions/oefening-library.test.ts en de
// acceptatietests; die dekking wordt hier niet gekopieerd.

const baseInput = (over: Partial<OefeningInput> = {}): OefeningInput => ({
  naam: 'Rondo',
  categorie: 'partijen_klein',
  teams: [],
  aantal_neutralen: 0,
  ...over,
})

describe('validateOefening — grootteMax', () => {
  it('bewaart een geldig bereik op een team zonder formatie', () => {
    const v = validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 6 }] }))
    expect(v.teams).toEqual([{ grootte: 4, formaties: [], keeperInGrootte: true, grootteMax: 6 }])
  })

  it('laat het veld WEG zonder bereik (byte-identieke JSONB als vóór de feature)', () => {
    const v = validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [] }] }))
    expect(v.teams).toEqual([{ grootte: 4, formaties: [], keeperInGrootte: true }])
    expect(Object.keys(v.teams[0]).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])

    // Expliciete null telt óók als "geen bereik".
    const metNull = validateOefening(
      baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: null }] }),
    )
    expect(Object.keys(metNull.teams[0]).sort()).toEqual(['formaties', 'grootte', 'keeperInGrootte'])
  })

  it('staat een bereik toe dat gelijk is aan de grootte', () => {
    const v = validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 4 }] }))
    expect(v.teams[0].grootteMax).toBe(4)
  })

  it('weigert een formatie samen met een bereik', () => {
    expect(() =>
      validateOefening(baseInput({ teams: [{ grootte: 4, formaties: ['2-0-1'], grootteMax: 6 }] })),
    ).toThrow('Formatie kan niet samen met een spelersbereik')
  })

  it('weigert een bovengrens onder de teamgrootte', () => {
    expect(() =>
      validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 3 }] })),
    ).toThrow('Bovengrens kleiner dan de teamgrootte')
  })

  it('weigert een bovengrens buiten VALID_TEAM_SIZES', () => {
    expect(() =>
      validateOefening(baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 12 }] })),
    ).toThrow('Ongeldige teamgrootte')
    expect(() =>
      validateOefening(
        baseInput({ teams: [{ grootte: 4, formaties: [], grootteMax: 'zes' }] as never }),
      ),
    ).toThrow('Ongeldige teamgrootte')
  })
})

describe('validateOefening — aantal_neutralen_max', () => {
  it('bewaart basis 0 met een geldige bovengrens (0 is een echte basiswaarde)', () => {
    const v = validateOefening(baseInput({ aantal_neutralen: 0, aantal_neutralen_max: 4 }))
    expect(v.aantal_neutralen).toBe(0)
    expect(v.aantal_neutralen_max).toBe(4)
  })

  it('geeft null zonder bovengrens', () => {
    expect(validateOefening(baseInput({ aantal_neutralen: 2 })).aantal_neutralen_max).toBeNull()
    expect(
      validateOefening(baseInput({ aantal_neutralen: 2, aantal_neutralen_max: null }))
        .aantal_neutralen_max,
    ).toBeNull()
  })

  it('staat een bovengrens 0 toe bij een basis van 0', () => {
    const v = validateOefening(baseInput({ aantal_neutralen: 0, aantal_neutralen_max: 0 }))
    expect(v.aantal_neutralen_max).toBe(0)
  })

  it('weigert een bovengrens onder het basisaantal', () => {
    expect(() =>
      validateOefening(baseInput({ aantal_neutralen: 3, aantal_neutralen_max: 1 })),
    ).toThrow('Bovengrens kleiner dan het aantal neutralen')
  })

  it('clamt een bovengrens boven de kolomgrens van 30', () => {
    expect(validateOefening(baseInput({ aantal_neutralen: 2, aantal_neutralen_max: 99 }))
      .aantal_neutralen_max).toBe(30)
  })
})

// ─────────────────────────────────────────────────────────────
// Fase 4 — kopiëren naar de eigen bibliotheek (AC 20, BR 56)
// ─────────────────────────────────────────────────────────────

describe('OEFENING_INHOUD_KOLOMMEN', () => {
  // Het vangnet voor een toekomstig veld: komt er een kolom bij in
  // ValidatedOefening die hier ontbreekt, dan zou een kopie dat veld stil
  // laten vallen.
  it('is precies de set velden die validateOefening oplevert', () => {
    const volledig = validateOefening(baseInput({
      beschrijving: 'x', duur_min: 10, breedte_m: 20, lengte_m: 30,
      orientatie: 'breedte', veldzone: 'midden', aantal_neutralen_max: 2,
    }))
    expect([...OEFENING_INHOUD_KOLOMMEN].sort()).toEqual(Object.keys(volledig).sort())
  })

  it('bevat geen id, eigenaar of aanmaakdatum', () => {
    const kolommen: readonly string[] = OEFENING_INHOUD_KOLOMMEN
    expect(kolommen).not.toContain('id')
    expect(kolommen).not.toContain('team_id')
    expect(kolommen).not.toContain('created_at')
  })
})

describe('oefeningKopieRij', () => {
  const bron = {
    naam: 'Rondo 4v2',
    beschrijving: 'Twee touch',
    categorie: 'partijen_klein',
    duur_min: 12,
    breedte_m: 20,
    lengte_m: 15.5,
    orientatie: 'lengte',
    veldzone: null,
    teams: [{ grootte: 4, formaties: [] }],
    aantal_neutralen: 2,
    aantal_neutralen_max: null,
    diagram: { markers: [] },
  }

  it('neemt alle inhoud letterlijk over, ook de naam (beslissing 10), en zet de nieuwe eigenaar', () => {
    expect(oefeningKopieRij(bron, 'nieuwe-eigenaar')).toEqual({ ...bron, team_id: 'nieuwe-eigenaar' })
  })

  it('neemt id, created_at en de oude eigenaar NIET over — de database geeft een nieuw id', () => {
    const rij = oefeningKopieRij(
      { ...bron, id: 'oud-id', created_at: '2026-01-01T00:00:00Z', team_id: 'oude-eigenaar' },
      'nieuwe-eigenaar',
    )
    expect(rij).not.toHaveProperty('id')
    expect(rij).not.toHaveProperty('created_at')
    expect(rij.team_id).toBe('nieuwe-eigenaar')
  })

  it('normaliseert en clampt NIET — een kopie heeft dezelfde inhoud als het origineel (AC 20)', () => {
    // Een legacy teamvorm {grootte, formatie} blijft precies zoals hij was;
    // de dual-read bij het lezen normaliseert hem, net als bij het origineel.
    const legacy = { ...bron, teams: [{ grootte: 6, formatie: '3-2' }] }
    expect(oefeningKopieRij(legacy, 'u').teams).toBe(legacy.teams)
  })

  it('laat een ontbrekende kolom weg, zodat de kolomdefault geldt in plaats van NULL', () => {
    const { aantal_neutralen_max: _weg, ...zonder } = bron
    void _weg
    const rij = oefeningKopieRij(zonder, 'u')
    expect(rij).not.toHaveProperty('aantal_neutralen_max')
    // NULL-waarden in de bron gaan wél mee: dat ís de inhoud.
    expect(rij).toHaveProperty('veldzone', null)
  })

  it('kan de eigenaar niet laten overschrijven door een bronveld', () => {
    expect(oefeningKopieRij({ ...bron, team_id: 'aanvaller' }, 'echte-eigenaar').team_id).toBe('echte-eigenaar')
  })
})

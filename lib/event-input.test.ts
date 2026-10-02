import { describe, it, expect } from 'vitest'
import {
  EVENT_INPUT_ERROR_MESSAGES,
  VALID_HOME_AWAY,
  VALID_MATCH_TYPES,
  parseEventBaseInput,
} from '@/lib/event-input'

// Pure invoervalidatie: geen mocks, geen Supabase. Gedeeld door createEvent en
// updateEvent (app/actions/events.ts), dus de volgorde van de controles en de
// afkapgrenzen liggen hier vast.

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const TRAINING = { date: '2026-09-10', time: '19:00', location: 'Sportpark', notes: 'Hesjes mee' }

const WEDSTRIJD = {
  date: '2026-09-12',
  time: '14:30',
  location: 'Veld 2',
  notes: 'Shirts wassen',
  opponent: 'DVC',
  match_type: 'league',
  home_away: 'away',
}

function code(fields: Record<string, string>, type: 'training' | 'match') {
  const result = parseEventBaseInput(form(fields), type)
  return result.ok ? null : result.code
}

function value(fields: Record<string, string>, type: 'training' | 'match') {
  const result = parseEventBaseInput(form(fields), type)
  if (!result.ok) throw new Error(`onverwachte fout: ${result.code}`)
  return result.value
}

describe('parseEventBaseInput — succes', () => {
  it('leest een geldige training; match is null', () => {
    expect(parseEventBaseInput(form(TRAINING), 'training')).toEqual({
      ok: true,
      value: { date: '2026-09-10', time: '19:00', location: 'Sportpark', notes: 'Hesjes mee', match: null },
    })
  })

  it('leest een geldige wedstrijd met de drie wedstrijdvelden', () => {
    expect(parseEventBaseInput(form(WEDSTRIJD), 'match')).toEqual({
      ok: true,
      value: {
        date: '2026-09-12',
        time: '14:30',
        location: 'Veld 2',
        notes: 'Shirts wassen',
        match: { opponent: 'DVC', match_type: 'league', home_away: 'away' },
      },
    })
  })

  it('maakt van een leeg tijdveld null', () => {
    expect(value({ ...TRAINING, time: '' }, 'training').time).toBeNull()
  })

  it('maakt van een ontbrekend tijdveld null', () => {
    expect(value({ date: '2026-09-10' }, 'training').time).toBeNull()
  })

  it('maakt van een lege locatie en lege notities null', () => {
    const v = value({ ...TRAINING, location: '', notes: '' }, 'training')
    expect(v.location).toBeNull()
    expect(v.notes).toBeNull()
  })

  it('maakt van een ontbrekende locatie en ontbrekende notities null', () => {
    const v = value({ date: '2026-09-10' }, 'training')
    expect(v.location).toBeNull()
    expect(v.notes).toBeNull()
  })

  it('accepteert de randen van de dag', () => {
    expect(value({ ...TRAINING, time: '00:00' }, 'training').time).toBe('00:00')
    expect(value({ ...TRAINING, time: '23:59' }, 'training').time).toBe('23:59')
  })

  it('accepteert elke waarde uit beide whitelists', () => {
    for (const match_type of VALID_MATCH_TYPES) {
      for (const home_away of VALID_HOME_AWAY) {
        expect(value({ ...WEDSTRIJD, match_type, home_away }, 'match').match)
          .toEqual({ opponent: 'DVC', match_type, home_away })
      }
    }
  })

  it('accepteert een schrikkeldag en een datum in het verleden', () => {
    expect(value({ ...TRAINING, date: '2024-02-29' }, 'training').date).toBe('2024-02-29')
    expect(value({ ...TRAINING, date: '2019-01-01' }, 'training').date).toBe('2019-01-01')
  })
})

describe('parseEventBaseInput — ongeldige invoer', () => {
  it('weigert een lege datum', () => {
    expect(code({ ...TRAINING, date: '' }, 'training')).toBe('invalid_date')
  })

  it('weigert een ontbrekende datum', () => {
    expect(code({ time: '19:00' }, 'training')).toBe('invalid_date')
  })

  it('weigert een maand die niet bestaat', () => {
    expect(code({ ...TRAINING, date: '2026-13-01' }, 'training')).toBe('invalid_date')
  })

  it('weigert een dag die niet bestaat in plaats van door te rollen', () => {
    expect(code({ ...TRAINING, date: '2026-02-30' }, 'training')).toBe('invalid_date')
  })

  it('weigert een datum in een ander formaat', () => {
    expect(code({ ...TRAINING, date: '10-09-2026' }, 'training')).toBe('invalid_date')
    expect(code({ ...TRAINING, date: '2026-09-10T00:00:00' }, 'training')).toBe('invalid_date')
  })

  it.each(['25:00', '9:5', '14:30:00', 'abc'])('weigert het tijdstip %s', (time) => {
    expect(code({ ...TRAINING, time }, 'training')).toBe('invalid_time')
    expect(code({ ...WEDSTRIJD, time }, 'match')).toBe('invalid_time')
  })

  it('weigert een onbekend wedstrijdtype', () => {
    expect(code({ ...WEDSTRIJD, match_type: 'onzin' }, 'match')).toBe('invalid_match_type')
  })

  it('weigert een ontbrekend wedstrijdtype', () => {
    expect(code({ date: '2026-09-12', home_away: 'home' }, 'match')).toBe('invalid_match_type')
  })

  it('weigert een onbekende thuis/uit-waarde', () => {
    expect(code({ ...WEDSTRIJD, home_away: 'onzin' }, 'match')).toBe('invalid_home_away')
  })

  it('weigert een ontbrekende thuis/uit-waarde', () => {
    expect(code({ date: '2026-09-12', match_type: 'cup' }, 'match')).toBe('invalid_home_away')
  })

  it('meldt bij meerdere fouten de eerste in de vaste volgorde datum, tijd, wedstrijdtype, thuis/uit', () => {
    const allesFout = { date: 'x', time: 'x', match_type: 'x', home_away: 'x' }
    expect(code(allesFout, 'match')).toBe('invalid_date')
    expect(code({ ...allesFout, date: '2026-09-12' }, 'match')).toBe('invalid_time')
    expect(code({ ...allesFout, date: '2026-09-12', time: '' }, 'match')).toBe('invalid_match_type')
    expect(code({ ...allesFout, date: '2026-09-12', time: '', match_type: 'cup' }, 'match'))
      .toBe('invalid_home_away')
  })
})

describe('parseEventBaseInput — randgevallen', () => {
  it('kapt een locatie van 201 tekens af op 200', () => {
    expect(value({ ...TRAINING, location: 'a'.repeat(201) }, 'training').location).toBe('a'.repeat(200))
  })

  it('kapt notities van 2001 tekens af op 2000', () => {
    expect(value({ ...TRAINING, notes: 'b'.repeat(2001) }, 'training').notes).toBe('b'.repeat(2000))
  })

  it('kapt een tegenstander van 101 tekens af op 100', () => {
    expect(value({ ...WEDSTRIJD, opponent: 'c'.repeat(101) }, 'match').match!.opponent)
      .toBe('c'.repeat(100))
  })

  it('laat waarden precies op de grens ongemoeid', () => {
    const v = value(
      { ...WEDSTRIJD, location: 'a'.repeat(200), notes: 'b'.repeat(2000), opponent: 'c'.repeat(100) },
      'match',
    )
    expect(v.location).toHaveLength(200)
    expect(v.notes).toHaveLength(2000)
    expect(v.match!.opponent).toHaveLength(100)
  })

  it('geeft een lege of ontbrekende tegenstander door als lege string', () => {
    // Verplicht maken is aan de aanroeper: updateEvent weigert dit, createEvent niet.
    expect(value({ ...WEDSTRIJD, opponent: '' }, 'match').match!.opponent).toBe('')
    expect(value({ date: '2026-09-12', match_type: 'cup', home_away: 'home' }, 'match').match!.opponent)
      .toBe('')
  })

  it('trimt de tegenstander niet', () => {
    expect(value({ ...WEDSTRIJD, opponent: '  DVC ' }, 'match').match!.opponent).toBe('  DVC ')
  })

  it('negeert wedstrijdvelden bij een training, ook als ze ongeldig zijn', () => {
    const v = value({ ...TRAINING, opponent: 'DVC', match_type: 'onzin', home_away: 'onzin' }, 'training')
    expect(v.match).toBeNull()
    expect(v).toEqual({
      date: '2026-09-10', time: '19:00', location: 'Sportpark', notes: 'Hesjes mee', match: null,
    })
  })

  it('leest geen type, team_id, verzameltijd, trainingstype, doelstelling of uitslag', () => {
    const v = value({
      ...WEDSTRIJD,
      type: 'training',
      team_id: 'ander-team',
      gather_time: '99:99',
      trainingstype: 'onzin',
      doelstelling: 'x',
      goals_for: '3',
      goals_against: '1',
    }, 'match')
    expect(Object.keys(v).sort()).toEqual(['date', 'location', 'match', 'notes', 'time'])
    expect(Object.keys(v.match!).sort()).toEqual(['home_away', 'match_type', 'opponent'])
  })

  it('behandelt een bestand in een tekstveld als leeg', () => {
    const fd = form(WEDSTRIJD)
    fd.set('location', new File(['x'], 'x.txt'))
    fd.set('notes', new File(['x'], 'x.txt'))
    fd.set('opponent', new File(['x'], 'x.txt'))
    const result = parseEventBaseInput(fd, 'match')
    expect(result).toMatchObject({ ok: true, value: { location: null, notes: null, match: { opponent: '' } } })
  })

  it('weigert een bestand als datum of tijd', () => {
    const datum = form(TRAINING)
    datum.set('date', new File(['x'], 'x.txt'))
    expect(parseEventBaseInput(datum, 'training')).toEqual({ ok: false, code: 'invalid_date' })

    const tijd = form(TRAINING)
    tijd.set('time', new File(['x'], 'x.txt'))
    expect(parseEventBaseInput(tijd, 'training')).toEqual({ ok: false, code: 'invalid_time' })
  })
})

describe('EVENT_INPUT_ERROR_MESSAGES', () => {
  it('houdt de meldingen die createEvent al gooide', () => {
    expect(EVENT_INPUT_ERROR_MESSAGES).toEqual({
      invalid_date: 'Ongeldige datum',
      invalid_time: 'Ongeldig tijdstip',
      invalid_match_type: 'Ongeldig wedstrijdtype',
      invalid_home_away: 'Ongeldig thuis/uit',
    })
  })
})

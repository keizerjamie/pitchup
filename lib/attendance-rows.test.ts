import { describe, it, expect } from 'vitest'
import { buildAttendanceRow, resolveAttendanceStatus } from '@/lib/attendance-rows'
import type { AttendanceRowInput } from '@/lib/attendance-rows'
import type { AttendanceStatus } from '@/lib/types'

// Pure beslisregel: geen mocks, geen klok, geen Supabase. `today` en
// `eventDate` zijn kale strings die de test zelf kiest. De volledige matrix van
// gast × blessure × afmeldperiode × datum staat hieronder, plus de sleutelset
// die gelijk moet blijven omdat PostgREST een bulk-insert met afwijkende
// kolommen weigert.

const PERIOD = 'ap-1'
const TODAY = '2026-10-20'
const YESTERDAY = '2026-10-19'
const TOMORROW = '2026-10-21'

function input(over: Partial<AttendanceRowInput> = {}): AttendanceRowInput {
  return {
    eventId: 'e1',
    playerId: 'p1',
    teamId: 'team-1',
    defaultStatus: 'present',
    injured: false,
    eventDate: TODAY,
    today: TODAY,
    periodId: null,
    isGuest: false,
    ...over,
  }
}

describe('buildAttendanceRow — matrix blessure × afmeldperiode', () => {
  it('(a) geen blessure en geen periode → de standaardstatus, zonder herkomst', () => {
    expect(buildAttendanceRow(input())).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'present',
      absence_period_id: null,
    })
  })

  it('(b) alleen een blessure, event vandaag → injured, zonder herkomst', () => {
    expect(buildAttendanceRow(input({ injured: true }))).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'injured',
      absence_period_id: null,
    })
  })

  it('(c) alleen een periode → absent met herkomst', () => {
    expect(buildAttendanceRow(input({ periodId: PERIOD }))).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'absent',
      absence_period_id: PERIOD,
    })
  })

  it('(d) blessure én periode → injured, herkomst blijft gezet (blessure wint, besluit 11)', () => {
    expect(buildAttendanceRow(input({ injured: true, periodId: PERIOD }))).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'injured',
      absence_period_id: PERIOD,
    })
  })

  it('geldt ook met "unknown" als standaardstatus (de backfill op de eventpagina)', () => {
    expect(buildAttendanceRow(input({ defaultStatus: 'unknown' })).status).toBe('unknown')
    expect(buildAttendanceRow(input({ defaultStatus: 'unknown', injured: true })).status).toBe('injured')
    expect(buildAttendanceRow(input({ defaultStatus: 'unknown', periodId: PERIOD })).status).toBe('absent')
  })

  it('neemt de ids en het team over zoals aangeleverd (tenant-scope blijft van de aanroeper)', () => {
    const row = buildAttendanceRow(input({ eventId: 'e9', playerId: 'p9', teamId: 'team-9' }))
    expect(row.event_id).toBe('e9')
    expect(row.player_id).toBe('p9')
    expect(row.team_id).toBe('team-9')
  })
})

// Blessure is de toestand van NU: alleen events vanaf vandaag krijgen
// 'injured' (AC15/AC18, besluit 8).
describe('buildAttendanceRow — blessure en de datum van het event', () => {
  it('event vandaag → injured', () => {
    expect(buildAttendanceRow(input({ injured: true, eventDate: TODAY })).status).toBe('injured')
  })

  it('event in de toekomst → injured', () => {
    expect(buildAttendanceRow(input({ injured: true, eventDate: TOMORROW })).status).toBe('injured')
  })

  it('event in het verleden → de standaardstatus, géén injured (AC18)', () => {
    expect(buildAttendanceRow(input({ injured: true, eventDate: YESTERDAY })).status).toBe('present')
    expect(
      buildAttendanceRow(input({ injured: true, eventDate: YESTERDAY, defaultStatus: 'unknown' })).status,
    ).toBe('unknown')
  })

  it('event in het verleden met periode → absent met herkomst', () => {
    const row = buildAttendanceRow(input({ injured: true, eventDate: YESTERDAY, periodId: PERIOD }))
    expect(row.status).toBe('absent')
    expect(row.absence_period_id).toBe(PERIOD)
  })

  it('event in het verleden van een geblesseerde gast → absent (gastregel)', () => {
    expect(
      buildAttendanceRow(input({ injured: true, isGuest: true, eventDate: YESTERDAY })).status,
    ).toBe('absent')
  })

  it('vergelijkt als kale YYYY-MM-DD-string over een jaar- en maandgrens heen', () => {
    expect(
      buildAttendanceRow(input({ injured: true, today: '2026-12-31', eventDate: '2027-01-01' })).status,
    ).toBe('injured')
    expect(
      buildAttendanceRow(input({ injured: true, today: '2026-11-01', eventDate: '2026-10-31' })).status,
    ).toBe('present')
  })
})

// Een gastspeler staat afwezig, ongeacht de teamstandaard en een
// afmeldperiode. Een BLESSURE weegt wel zwaarder dan het gastschap (V1): een
// geblesseerde gast krijgt 'injured' op events vanaf vandaag.
describe('buildAttendanceRow — matrix gast × blessure × periode', () => {
  const defaults: AttendanceStatus[] = ['present', 'unknown']

  for (const defaultStatus of defaults) {
    describe(`standaardstatus '${defaultStatus}'`, () => {
      it('gast zonder blessure en zonder periode → absent', () => {
        expect(buildAttendanceRow(input({ defaultStatus, isGuest: true })).status).toBe('absent')
      })

      it('gast + blessure → injured (V1: blessure vóór gastregel)', () => {
        const row = buildAttendanceRow(input({ defaultStatus, isGuest: true, injured: true }))
        expect(row.status).toBe('injured')
        expect(row.absence_period_id).toBeNull()
      })

      it('gast + afmeldperiode → absent, herkomst blijft bewaard', () => {
        const row = buildAttendanceRow(input({ defaultStatus, isGuest: true, periodId: PERIOD }))
        expect(row.status).toBe('absent')
        expect(row.absence_period_id).toBe(PERIOD)
      })

      it('gast + blessure + afmeldperiode → injured met herkomst', () => {
        const row = buildAttendanceRow(
          input({ defaultStatus, isGuest: true, injured: true, periodId: PERIOD }),
        )
        expect(row.status).toBe('injured')
        expect(row.absence_period_id).toBe(PERIOD)
      })

      it('reguliere speler zonder blessure/periode volgt de standaardstatus', () => {
        expect(buildAttendanceRow(input({ defaultStatus, isGuest: false })).status).toBe(defaultStatus)
      })

      it('reguliere speler: blessure → injured, periode → absent', () => {
        expect(buildAttendanceRow(input({ defaultStatus, injured: true })).status).toBe('injured')
        expect(buildAttendanceRow(input({ defaultStatus, periodId: PERIOD })).status).toBe('absent')
        expect(
          buildAttendanceRow(input({ defaultStatus, injured: true, periodId: PERIOD })).status,
        ).toBe('injured')
      })
    })
  }

  it('gastschap weegt zwaarder dan de teamstandaard "present"', () => {
    expect(buildAttendanceRow(input({ defaultStatus: 'present', isGuest: true })).status).toBe('absent')
  })
})

describe('buildAttendanceRow — sleutelset', () => {
  it('geeft altijd exact dezelfde vijf sleutels terug, zonder injury_set', () => {
    // PostgREST weigert een bulk-insert waarin de objecten verschillende
    // kolommen hebben; absence_period_id gaat dus altijd mee. De
    // invoervelden isGuest, eventDate en today mogen geen kolom toevoegen.
    const combinaties: Partial<AttendanceRowInput>[] = [
      {},
      { injured: true },
      { injured: true, eventDate: YESTERDAY },
      { periodId: PERIOD },
      { injured: true, periodId: PERIOD },
      { isGuest: true },
      { isGuest: true, injured: true },
      { isGuest: true, periodId: PERIOD },
      { isGuest: true, injured: true, periodId: PERIOD },
    ]
    for (const over of combinaties) {
      const row = buildAttendanceRow(input(over))
      expect(Object.keys(row).sort()).toEqual(
        ['absence_period_id', 'event_id', 'player_id', 'status', 'team_id'],
      )
      expect(row).not.toHaveProperty('injury_set')
    }
  })
})

// Dezelfde regel wordt hergebruikt door markRecovered (app/actions/players.ts)
// en revokeAbsencePeriod (app/actions/attendance.ts): de status waarnaar een
// rij wordt teruggezet is 'absent' voor een gast en anders de teamstandaard.
describe('resolveAttendanceStatus — hergebruik bij herstel/intrekken', () => {
  it('gast → absent, ongeacht de teamstandaard', () => {
    expect(resolveAttendanceStatus({ defaultStatus: 'present', isGuest: true })).toBe('absent')
    expect(resolveAttendanceStatus({ defaultStatus: 'unknown', isGuest: true })).toBe('absent')
  })

  it('reguliere speler → de teamstandaard', () => {
    expect(resolveAttendanceStatus({ defaultStatus: 'present', isGuest: false })).toBe('present')
    expect(resolveAttendanceStatus({ defaultStatus: 'unknown', isGuest: false })).toBe('unknown')
  })

  it('injuredOnDate → injured, ook vóór gast en periode', () => {
    expect(resolveAttendanceStatus({ defaultStatus: 'present', isGuest: false, injuredOnDate: true })).toBe('injured')
    expect(resolveAttendanceStatus({ defaultStatus: 'present', isGuest: true, injuredOnDate: true })).toBe('injured')
    expect(
      resolveAttendanceStatus({ defaultStatus: 'present', isGuest: false, injuredOnDate: true, periodId: PERIOD }),
    ).toBe('injured')
  })

  it('periode weegt zwaarder dan de standaard', () => {
    expect(resolveAttendanceStatus({ defaultStatus: 'present', isGuest: false, periodId: PERIOD })).toBe('absent')
  })
})

import { describe, it, expect } from 'vitest'
import { buildAttendanceRow, resolveAttendanceStatus } from '@/lib/attendance-rows'
import type { AttendanceRowInput } from '@/lib/attendance-rows'
import type { AttendanceStatus } from '@/lib/types'

// Pure beslisregel: geen mocks, geen datums, geen Supabase. De volledige matrix
// van gast × blessure × afmeldperiode staat hieronder, plus de sleutelset die
// gelijk moet blijven omdat PostgREST een bulk-insert met afwijkende kolommen
// weigert.

const PERIOD = 'ap-1'

function input(over: Partial<AttendanceRowInput> = {}): AttendanceRowInput {
  return {
    eventId: 'e1',
    playerId: 'p1',
    teamId: 'team-1',
    defaultStatus: 'present',
    injured: false,
    periodId: null,
    isGuest: false,
    ...over,
  }
}

describe('buildAttendanceRow — matrix blessure × afmeldperiode', () => {
  it('(a) geen blessure en geen periode → de standaardstatus, geen markeringen', () => {
    expect(buildAttendanceRow(input())).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'present',
      injury_set: false,
      absence_period_id: null,
    })
  })

  it('(b) alleen een blessure → absent met injury_set, zonder herkomst', () => {
    expect(buildAttendanceRow(input({ injured: true }))).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'absent',
      injury_set: true,
      absence_period_id: null,
    })
  })

  it('(c) alleen een periode → absent met herkomst, zonder blessuremarkering', () => {
    expect(buildAttendanceRow(input({ periodId: PERIOD }))).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'absent',
      injury_set: false,
      absence_period_id: PERIOD,
    })
  })

  it('(d) blessure én periode → absent met beide markeringen', () => {
    expect(buildAttendanceRow(input({ injured: true, periodId: PERIOD }))).toEqual({
      event_id: 'e1',
      player_id: 'p1',
      team_id: 'team-1',
      status: 'absent',
      injury_set: true,
      absence_period_id: PERIOD,
    })
  })

  it('geldt ook met "unknown" als standaardstatus (de backfill op de eventpagina)', () => {
    expect(buildAttendanceRow(input({ defaultStatus: 'unknown' })).status).toBe('unknown')
    expect(buildAttendanceRow(input({ defaultStatus: 'unknown', injured: true })).status).toBe('absent')
    expect(buildAttendanceRow(input({ defaultStatus: 'unknown', periodId: PERIOD })).status).toBe('absent')
  })

  it('neemt de ids en het team over zoals aangeleverd (tenant-scope blijft van de aanroeper)', () => {
    const row = buildAttendanceRow(input({ eventId: 'e9', playerId: 'p9', teamId: 'team-9' }))
    expect(row.event_id).toBe('e9')
    expect(row.player_id).toBe('p9')
    expect(row.team_id).toBe('team-9')
  })
})

// AC5-AC9: een gastspeler staat ALTIJD afwezig, ongeacht de teamstandaard en
// ongeacht de combinatie met blessure of afmeldperiode. Alle acht combinaties,
// bij beide mogelijke standaardstatussen.
describe('buildAttendanceRow — matrix gast × blessure × periode', () => {
  const defaults: AttendanceStatus[] = ['present', 'unknown']

  for (const defaultStatus of defaults) {
    describe(`standaardstatus '${defaultStatus}'`, () => {
      it('gast zonder blessure en zonder periode → absent (AC5-AC8)', () => {
        expect(buildAttendanceRow(input({ defaultStatus, isGuest: true })).status).toBe('absent')
      })

      it('gast + blessure → absent (AC9)', () => {
        const row = buildAttendanceRow(input({ defaultStatus, isGuest: true, injured: true }))
        expect(row.status).toBe('absent')
        expect(row.injury_set).toBe(true)
      })

      it('gast + afmeldperiode → absent, herkomst blijft bewaard (AC9)', () => {
        const row = buildAttendanceRow(input({ defaultStatus, isGuest: true, periodId: PERIOD }))
        expect(row.status).toBe('absent')
        expect(row.absence_period_id).toBe(PERIOD)
      })

      it('gast + blessure + afmeldperiode → absent met beide markeringen (AC9)', () => {
        const row = buildAttendanceRow(
          input({ defaultStatus, isGuest: true, injured: true, periodId: PERIOD }),
        )
        expect(row.status).toBe('absent')
        expect(row.injury_set).toBe(true)
        expect(row.absence_period_id).toBe(PERIOD)
      })

      it('reguliere speler zonder blessure/periode volgt de standaardstatus', () => {
        expect(buildAttendanceRow(input({ defaultStatus, isGuest: false })).status).toBe(defaultStatus)
      })

      it('reguliere speler met blessure of periode blijft absent', () => {
        expect(buildAttendanceRow(input({ defaultStatus, injured: true })).status).toBe('absent')
        expect(buildAttendanceRow(input({ defaultStatus, periodId: PERIOD })).status).toBe('absent')
        expect(
          buildAttendanceRow(input({ defaultStatus, injured: true, periodId: PERIOD })).status,
        ).toBe('absent')
      })
    })
  }

  it('gastschap weegt zwaarder dan de teamstandaard "present"', () => {
    // Zonder de eerste tak zou deze rij op 'present' komen — precies het gat
    // dat AC5-AC8 dichtzet.
    expect(buildAttendanceRow(input({ defaultStatus: 'present', isGuest: true })).status).toBe('absent')
  })
})

describe('buildAttendanceRow — sleutelset', () => {
  it('geeft altijd exact dezelfde sleutelset terug, ongeacht de combinatie', () => {
    // PostgREST weigert een bulk-insert waarin de objecten verschillende
    // kolommen hebben; injury_set en absence_period_id gaan dus altijd mee. Het
    // nieuwe isGuest is een INVOERveld en mag hier geen kolom toevoegen.
    const combinaties: Partial<AttendanceRowInput>[] = [
      {},
      { injured: true },
      { periodId: PERIOD },
      { injured: true, periodId: PERIOD },
      { isGuest: true },
      { isGuest: true, injured: true },
      { isGuest: true, periodId: PERIOD },
      { isGuest: true, injured: true, periodId: PERIOD },
    ]
    for (const over of combinaties) {
      expect(Object.keys(buildAttendanceRow(input(over))).sort()).toEqual(
        ['absence_period_id', 'event_id', 'injury_set', 'player_id', 'status', 'team_id'],
      )
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

  it('blessure en periode blijven zwaarder wegen dan de standaard', () => {
    expect(resolveAttendanceStatus({ defaultStatus: 'present', isGuest: false, injured: true })).toBe('absent')
    expect(resolveAttendanceStatus({ defaultStatus: 'present', isGuest: false, periodId: PERIOD })).toBe('absent')
  })
})

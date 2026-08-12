import { describe, it, expect } from 'vitest'
import { buildAttendanceRow } from '@/lib/attendance-rows'
import type { AttendanceRowInput } from '@/lib/attendance-rows'

// Pure beslisregel: geen mocks, geen datums, geen Supabase. De volledige matrix
// van blessure × afmeldperiode staat hieronder, plus de sleutelset die gelijk
// moet blijven omdat PostgREST een bulk-insert met afwijkende kolommen weigert.

const PERIOD = 'ap-1'

function input(over: Partial<AttendanceRowInput> = {}): AttendanceRowInput {
  return {
    eventId: 'e1',
    playerId: 'p1',
    teamId: 'team-1',
    defaultStatus: 'present',
    injured: false,
    periodId: null,
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

  it('geeft altijd exact dezelfde sleutelset terug, ongeacht de combinatie', () => {
    // PostgREST weigert een bulk-insert waarin de objecten verschillende
    // kolommen hebben; injury_set en absence_period_id gaan dus altijd mee.
    const combinaties: Partial<AttendanceRowInput>[] = [
      {},
      { injured: true },
      { periodId: PERIOD },
      { injured: true, periodId: PERIOD },
    ]
    for (const over of combinaties) {
      expect(Object.keys(buildAttendanceRow(input(over))).sort()).toEqual(
        ['absence_period_id', 'event_id', 'injury_set', 'player_id', 'status', 'team_id'],
      )
    }
  })

  it('neemt de ids en het team over zoals aangeleverd (tenant-scope blijft van de aanroeper)', () => {
    const row = buildAttendanceRow(input({ eventId: 'e9', playerId: 'p9', teamId: 'team-9' }))
    expect(row.event_id).toBe('e9')
    expect(row.player_id).toBe('p9')
    expect(row.team_id).toBe('team-9')
  })
})

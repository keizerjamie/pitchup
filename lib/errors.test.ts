import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GENERIC_ERROR_MESSAGE, errorCode, genericError, logError } from '@/lib/errors'

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

function loggedText(): string {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

describe('errorCode', () => {
  it('leest een tekstuele PostgREST-code', () => {
    expect(errorCode({ code: '23505' })).toBe('23505')
  })

  it('leest een numerieke code', () => {
    expect(errorCode({ code: 500 })).toBe('500')
  })

  it('negeert een code met vrije tekst (log-injectie / datalek)', () => {
    expect(errorCode({ code: 'Key (email)=(bob@example.com) already exists' })).toBeNull()
  })

  it('geeft null zonder code', () => {
    expect(errorCode({ message: 'boem' })).toBeNull()
    expect(errorCode(null)).toBeNull()
    expect(errorCode('boem')).toBeNull()
  })
})

describe('logError', () => {
  it('logt context en code, maar nooit de ruwe melding', () => {
    logError('players.createPlayer', {
      code: '23505',
      message: 'duplicate key value violates unique constraint "players_pkey" Key (email)=(bob@example.com)',
      details: 'geheim',
    })

    const text = loggedText()
    expect(text).toContain('players.createPlayer')
    expect(text).toContain('23505')
    expect(text).not.toContain('bob@example.com')
    expect(text).not.toContain('duplicate key')
    expect(text).not.toContain('geheim')
  })

  it('logt zonder code ook een bruikbare regel', () => {
    logError('auth.signUp', { message: 'User already registered' })

    const text = loggedText()
    expect(text).toContain('auth.signUp')
    expect(text).not.toContain('User already registered')
  })
})

describe('genericError', () => {
  it('geeft één vaste melding terug en logt de details', () => {
    const err = genericError('events.createEvent', { code: '42501', message: 'permission denied for table events' })

    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe(GENERIC_ERROR_MESSAGE)
    expect(err.message).not.toContain('permission denied')
    expect(loggedText()).toContain('42501')
  })
})

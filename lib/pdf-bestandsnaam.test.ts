import { describe, it, expect } from 'vitest'
import { pdfBestandsnaam } from '@/lib/pdf-bestandsnaam'

describe('pdfBestandsnaam', () => {
  it('bouwt "{titel} {dd}-{mm}-{jjjj}.pdf" uit een kale YYYY-MM-DD', () => {
    expect(pdfBestandsnaam('Trainingsplan', '2026-10-28')).toBe('Trainingsplan 28-10-2026.pdf')
  })

  it('verwijdert tekens die niet in een bestandsnaam horen en trimt', () => {
    expect(pdfBestandsnaam('  Plan: A/B*?"<>| ', '2026-01-02')).toBe('Plan AB 02-01-2026.pdf')
  })

  it('rekent de datum niet om (geen tijdzoneverschuiving rond middernacht)', () => {
    expect(pdfBestandsnaam('Aanwezigheid', '2026-03-29')).toBe('Aanwezigheid 29-03-2026.pdf')
  })

  it('valt terug op een neutrale naam bij een lege titel en ongeldige datum', () => {
    expect(pdfBestandsnaam('', 'kapot')).toBe('pitchup.pdf')
  })
})

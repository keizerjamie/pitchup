import { describe, it, expect } from 'vitest'
import { nl } from '@/messages/nl'
import { eventTitel, hoofdkaartTeksten, opstellingMistTekst, wanneerTekst, dagKolomTekst } from '@/components/dashboard/vandaag-teksten'
import type { KaartEvent, VandaagKaart } from '@/lib/vandaag-scherm'

const V = '2026-11-16'
const wedstrijd: KaartEvent = { id: 'm', type: 'match', date: '2026-11-17', time: null, opponent: 'Diemen', home_away: 'away' }
const trainingEv: KaartEvent = { id: 't', type: 'training', date: '2026-11-16', time: null, opponent: null, home_away: null }
const kaart = (o: Partial<VandaagKaart>): VandaagKaart =>
  ({ soort: 'squad', event: wedstrijd, open: true, href: '/x', doelTaak: 'squad', legePosities: null, ...o })

describe('wanneerTekst', () => {
  it.each([
    ['2026-11-16', 'vandaag'], ['2026-11-17', 'morgen'], ['2026-11-15', 'gisteren'], ['2026-11-19', 'over 3 dagen'],
  ])('%s → %s', (datum, verwacht) => {
    expect(wanneerTekst(datum, V, nl)).toBe(verwacht)
  })
  it('verder weg of ver verleden → "op <datum>"', () => {
    expect(wanneerTekst('2026-11-30', V, nl)).toMatch(/^op /)
    expect(wanneerTekst('2026-11-10', V, nl)).toMatch(/^op /)
  })
})

describe('dagKolomTekst', () => {
  it('Vandaag / Morgen / Gisteren / datum', () => {
    expect(dagKolomTekst('2026-11-16', V, nl)).toBe(nl.dashboard.today)
    expect(dagKolomTekst('2026-11-17', V, nl)).toBe(nl.dashboard.tomorrow)
    expect(dagKolomTekst('2026-11-15', V, nl)).toBe(nl.vandaag.whenYesterdayCap)
    expect(dagKolomTekst('2026-11-21', V, nl)).not.toMatch(/^(Vandaag|Morgen|Gisteren)$/)
  })
})

describe('eventTitel', () => {
  it('training, thuis, uit, zonder home_away en zonder tegenstander', () => {
    expect(eventTitel(trainingEv, V, nl)).toBe('Training vandaag')
    expect(eventTitel({ ...wedstrijd, home_away: 'home' }, V, nl)).toBe('Diemen thuis')
    expect(eventTitel(wedstrijd, V, nl)).toBe('Diemen uit')
    expect(eventTitel({ ...wedstrijd, home_away: null }, V, nl)).toBe('Diemen')
    expect(eventTitel({ ...wedstrijd, opponent: null }, V, nl)).toBe('Wedstrijd uit')
  })
})

describe('opstellingMistTekst', () => {
  it('1, n en onbekend', () => {
    expect(opstellingMistTekst(1, nl)).toBe('Opstelling mist 1 positie')
    expect(opstellingMistTekst(4, nl)).toBe('Opstelling mist 4 posities')
    expect(opstellingMistTekst(null, nl)).toBe('Opstelling is niet compleet')
  })
})

describe('hoofdkaartTeksten', () => {
  it('open taak: eyebrow Nu te doen; probleem: oranje toon met mist-tekst', () => {
    expect(hoofdkaartTeksten(kaart({}), V, false, nl)).toMatchObject({ tone: 'normaal', eyebrow: 'Nu te doen', primaryLabel: 'Selectie maken', primaryIcon: 'groups' })
    expect(hoofdkaartTeksten(kaart({ soort: 'lineup_onvolledig', doelTaak: 'lineup', legePosities: 2 }), V, false, nl))
      .toMatchObject({ tone: 'probleem', eyebrow: 'Opstelling mist 2 posities', primaryLabel: 'Opstelling afmaken' })
  })
  it('volgend_event: klaar-toon en knop per soort', () => {
    const volg = (o: Partial<VandaagKaart>) => kaart({ soort: 'volgend_event', open: false, ...o })
    expect(hoofdkaartTeksten(volg({ event: trainingEv, doelTaak: 'training_plan' }), V, false, nl)).toMatchObject({ tone: 'klaar', primaryLabel: 'Plan bekijken' })
    expect(hoofdkaartTeksten(volg({ doelTaak: 'squad' }), V, false, nl).primaryLabel).toBe('Selectie maken')
    expect(hoofdkaartTeksten(volg({ doelTaak: 'lineup' }), V, true, nl).primaryLabel).toBe('Opstelling bekijken')
    expect(hoofdkaartTeksten(volg({ doelTaak: 'lineup' }), V, false, nl).primaryLabel).toBe('Opstelling maken')
  })
})

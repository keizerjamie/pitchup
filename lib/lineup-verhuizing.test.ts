import { describe, it, expect } from 'vitest'
import { FORMATIONS } from '@/lib/types'
import type { LineupPosition } from '@/lib/types'
import { slotAffiniteit, slotAfstand, verhuisOpstelling } from '@/lib/lineup-verhuizing'

// Bouwt een volledig bezette opstelling uit een formatiesleutel: elke positie
// krijgt een speler-id dat naar zijn slotlabel verwijst, zodat een testfout
// leesbaar is ("KP-1 staat nu op SP" i.p.v. "p3 staat op index 9").
function bezet(key: string): LineupPosition[] {
  return FORMATIONS[key].positions.map((p, i) => ({
    ...p,
    player_id: `${p.position_label}-${i}`,
  }))
}

function opSlot(posities: LineupPosition[], label: string): string[] {
  return posities.filter((p) => p.position_label === label).map((p) => p.player_id ?? '—')
}

describe('slotAffiniteit', () => {
  it('geeft 1 voor hetzelfde label', () => {
    expect(slotAffiniteit('CM', 'CM')).toBe(1)
    expect(slotAffiniteit('SP', 'SP')).toBe(1)
  })

  it('geeft 1 voor verschillende labels met dezelfde rol', () => {
    // LV en LVB vertalen allebei naar 'Linksachter'.
    expect(slotAffiniteit('LV', 'LVB')).toBe(1)
    expect(slotAffiniteit('RVB', 'RV')).toBe(1)
  })

  it('geeft een middenwaarde voor verwante rollen', () => {
    const cmNaarDm = slotAffiniteit('CM', 'DM')
    expect(cmNaarDm).toBeGreaterThan(0)
    expect(cmNaarDm).toBeLessThan(1)
  })

  it('houdt de keeper absoluut: hij verhuist nergens heen en niemand komt erin', () => {
    for (const label of ['LV', 'MV', 'DM', 'CM', 'LM', 'RM', '10', 'LA', 'RA', 'SP']) {
      expect(slotAffiniteit('KP', label), `KP → ${label}`).toBe(0)
      expect(slotAffiniteit(label, 'KP'), `${label} → KP`).toBe(0)
    }
    expect(slotAffiniteit('KP', 'KP')).toBe(1)
  })

  it('geeft 0 voor een onbekend label in plaats van een willekeurige match', () => {
    expect(slotAffiniteit('ZZ', 'CM')).toBe(0)
    expect(slotAffiniteit('CM', 'ZZ')).toBe(0)
  })
})

describe('slotAfstand', () => {
  it('weegt verticale afstand zwaarder (het veld is 1,4x zo hoog als breed)', () => {
    const horizontaal = slotAfstand({ x: 0, y: 50, position_label: 'A' }, { x: 10, y: 50, position_label: 'B' })
    const verticaal = slotAfstand({ x: 50, y: 0, position_label: 'A' }, { x: 50, y: 10, position_label: 'B' })
    expect(horizontaal).toBeCloseTo(10)
    expect(verticaal).toBeCloseTo(14)
  })
})

describe('verhuisOpstelling — de kern', () => {
  it('houdt bij een wissel naar dezelfde formatie iedereen exact op zijn plek', () => {
    const oud = bezet('4-3-3')
    const uit = verhuisOpstelling(oud, FORMATIONS['4-3-3'].positions)

    expect(uit.verhuisd).toBe(11)
    expect(uit.naarBank).toEqual([])
    expect(uit.posities.map((p) => p.player_id)).toEqual(oud.map((p) => p.player_id))
  })

  it('laat de keeper in het doel staan bij elke wissel', () => {
    for (const doel of Object.keys(FORMATIONS)) {
      const uit = verhuisOpstelling(bezet('4-3-3'), FORMATIONS[doel].positions)
      expect(opSlot(uit.posities, 'KP'), doel).toEqual(['KP-0'])
    }
  })

  it('verhuist de vier verdedigers een-op-een tussen twee 4-backsystemen', () => {
    const uit = verhuisOpstelling(bezet('4-3-3'), FORMATIONS['4-4-2'].positions)

    expect(opSlot(uit.posities, 'LV')).toEqual(['LV-1'])
    expect(opSlot(uit.posities, 'RV')).toEqual(['RV-4'])
    expect(opSlot(uit.posities, 'MV').sort()).toEqual(['MV-2', 'MV-3'])
  })

  it('zet niemand twee keer neer en laat geen slot dubbel bezet', () => {
    for (const doel of Object.keys(FORMATIONS)) {
      const uit = verhuisOpstelling(bezet('4-2-3-1'), FORMATIONS[doel].positions)
      const ids = uit.posities.map((p) => p.player_id).filter(Boolean)
      expect(new Set(ids).size, doel).toBe(ids.length)
      expect(uit.posities.length, doel).toBe(11)
    }
  })

  it('meldt wie geen vergelijkbaar slot had in plaats van hem stil te laten vallen', () => {
    // Elke speler is óf verhuisd, óf staat in naarBank. Nooit allebei, nooit geen van beide.
    for (const bron of Object.keys(FORMATIONS)) {
      for (const doel of Object.keys(FORMATIONS)) {
        const uit = verhuisOpstelling(bezet(bron), FORMATIONS[doel].positions)
        expect(uit.verhuisd + uit.naarBank.length, `${bron} → ${doel}`).toBe(11)
        const opVeld = new Set(uit.posities.map((p) => p.player_id).filter(Boolean))
        for (const id of uit.naarBank) expect(opVeld.has(id), `${bron} → ${doel}: ${id}`).toBe(false)
      }
    }
  })

  it('houdt alle elf spelers op het veld binnen de 4-3-3-familie', () => {
    // De wissel waarvoor de varianten bestaan: van klassiek naar controleur,
    // dubbele 6 of valse 9 en weer terug. Hier mag niemand op de bank belanden.
    // Dit is precies het geval dat de eerste (greedy) implementatie liet
    // vallen: de RM hield niets over terwijl het DM-slot leeg bleef.
    const familie = ['4-3-3', '4-3-3 (controleur)', '4-3-3 (dubbele 6)', '4-3-3 (valse 9)']
    for (const bron of familie) {
      for (const doel of familie) {
        const uit = verhuisOpstelling(bezet(bron), FORMATIONS[doel].positions)
        expect(uit.naarBank, `${bron} → ${doel}`).toEqual([])
      }
    }
  })

  it('houdt bij ELKE wissel minstens tien van de elf spelers op het veld', () => {
    // Ondergrens over alle formatieparen. Wie er in het slechtste geval afvalt,
    // valt af om een echte voetbalreden — twee spitsen naar één spits, of een
    // vleugelverdediger zonder tegenhanger — niet omdat de koppeling faalt.
    // Zakt dit ooit onder de tien, dan is er iets mis met de matching of met de
    // labels van een nieuwe formatie.
    for (const bron of Object.keys(FORMATIONS)) {
      for (const doel of Object.keys(FORMATIONS)) {
        const uit = verhuisOpstelling(bezet(bron), FORMATIONS[doel].positions)
        expect(uit.verhuisd, `${bron} → ${doel}`).toBeGreaterThanOrEqual(10)
      }
    }
  })

  it('verplaatst de zittende bewoner in plaats van de nieuwkomer te laten vallen', () => {
    // Het augmenting path, direct getoetst. In 4-3-3 (controleur) is er één
    // DM-slot en zijn er twee CM-slots; de drie middenvelders uit het klassieke
    // 4-3-3 (LM, CM, RM) passen alleen als de CM doorschuift naar DM.
    const uit = verhuisOpstelling(bezet('4-3-3'), FORMATIONS['4-3-3 (controleur)'].positions)

    expect(uit.naarBank).toEqual([])
    // De speler die in het klassieke 4-3-3 op CM stond, staat nu op DM: hij is
    // opzij gegaan zodat de LM en RM allebei een CM-slot kregen.
    expect(opSlot(uit.posities, 'DM')).toEqual(['CM-6'])
    expect(opSlot(uit.posities, 'CM').sort()).toEqual(['LM-5', 'RM-7'])
  })

  it('laat de verdediging staan en verplaatst alleen wie moet', () => {
    // De regressie die de tweede implementatie (maximale koppeling) opleverde:
    // daar bleven weliswaar alle elf op het veld, maar schoof de hele
    // verdediging een plek op — de linkshalf stond linksachter en de rechtsback
    // op het middenveld. Formeel elf spelers, in de praktijk onbruikbaar.
    const uit = verhuisOpstelling(bezet('4-3-3'), FORMATIONS['4-3-3 (controleur)'].positions)

    expect(opSlot(uit.posities, 'LV')).toEqual(['LV-1'])
    expect(opSlot(uit.posities, 'RV')).toEqual(['RV-4'])
    expect(opSlot(uit.posities, 'MV').sort()).toEqual(['MV-2', 'MV-3'])
    expect(opSlot(uit.posities, 'LA')).toEqual(['LA-8'])
    expect(opSlot(uit.posities, 'RA')).toEqual(['RA-10'])
    expect(opSlot(uit.posities, 'SP')).toEqual(['SP-9'])
  })

  it('kiest bij gelijke affiniteit het dichtstbijzijnde slot', () => {
    // De twee centrale verdedigers hebben identieke affiniteit; alleen de
    // afstand houdt ze aan hun eigen kant van het veld.
    const uit = verhuisOpstelling(bezet('4-3-3'), FORMATIONS['4-4-2'].positions)
    const linkerMv = uit.posities.find((p) => p.position_label === 'MV' && p.x < 50)
    const rechterMv = uit.posities.find((p) => p.position_label === 'MV' && p.x > 50)
    // MV-2 stond op x=38 (links), MV-3 op x=62 (rechts).
    expect(linkerMv?.player_id).toBe('MV-2')
    expect(rechterMv?.player_id).toBe('MV-3')
  })

  it('laat lege slots leeg en verzint niemand erbij', () => {
    const oud = bezet('4-3-3').map((p, i) => (i > 4 ? { ...p, player_id: null } : p))
    const uit = verhuisOpstelling(oud, FORMATIONS['4-4-2'].positions)

    expect(uit.verhuisd).toBe(5)
    expect(uit.posities.filter((p) => p.player_id !== null)).toHaveLength(5)
  })

  it('is deterministisch: dezelfde invoer geeft exact dezelfde uitkomst', () => {
    // Spiegelbeeldige slots (de twee centrale verdedigers) hebben gelijke
    // affiniteit én gelijke afstand; zonder expliciete tie-break zou de
    // uitkomst van de sorteerstabiliteit afhangen.
    const eerste = verhuisOpstelling(bezet('3-4-3'), FORMATIONS['5-3-2'].positions)
    const tweede = verhuisOpstelling(bezet('3-4-3'), FORMATIONS['5-3-2'].positions)
    expect(eerste.posities).toEqual(tweede.posities)
    expect(eerste.naarBank).toEqual(tweede.naarBank)
  })

  it('gaat om met een lege opstelling', () => {
    const leeg = FORMATIONS['4-3-3'].positions.map((p) => ({ ...p, player_id: null }))
    const uit = verhuisOpstelling(leeg, FORMATIONS['3-5-2'].positions)

    expect(uit.verhuisd).toBe(0)
    expect(uit.naarBank).toEqual([])
    expect(uit.posities.every((p) => p.player_id === null)).toBe(true)
  })

  it('respecteert de keuze van de coach: een spits op het middenveld springt niet terug naar de spits', () => {
    // De coach zette een speler bewust op links-midden. Bij de wissel hoort hij
    // op een middenveldslot te landen, niet op de vrije spitspositie — dat is
    // het verschil tussen meeverhuizen en opnieuw optimaliseren.
    const oud: LineupPosition[] = FORMATIONS['4-3-3'].positions.map((p) => ({
      ...p,
      player_id: p.position_label === 'LM' ? 'eigenwijze-keuze' : null,
    }))
    const uit = verhuisOpstelling(oud, FORMATIONS['4-4-2'].positions)

    const slot = uit.posities.find((p) => p.player_id === 'eigenwijze-keuze')
    expect(slot).toBeDefined()
    expect(['LM', 'CM']).toContain(slot!.position_label)
  })
})

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Optimistische updates met rollback per rij (brief §2-OU, §4.3).
//
// - `zet(k, v)` toont `v` direct. Is rij k niet onderweg, dan gaat `opslaan(k, v)`
//   meteen weg; is de rij wél onderweg, dan wordt `v` de wachtende waarde
//   (laatste tik wint) en volgt zodra de lopende opslag klaar is.
// - Andere rijen worden nooit geblokkeerd: elke rij heeft zijn eigen wachtrij.
// - Bij een fout vervalt de wachtende waarde en springt de rij terug naar de
//   laatst bevestigde waarde (zelfde idee als `lastConfirmedRef` in
//   components/MatchSquadEditor.tsx, maar per rij). `onFout(k)` laat de
//   aanroeper een eigen i18n-melding tonen — nooit een serverfout.
// - `zetAlles` is het bulkpad (bv. "iedereen aanwezig"): één server-aanroep
//   voor alle rijen; bij een fout gaat alles terug naar bevestigd en volgt
//   `onFout(BULK_SLEUTEL)`.
// - `synchroniseer(nieuw)` neemt nieuwe server-props over voor rijen die niet
//   onderweg zijn. Aanroepen tijdens render (setState-in-render-patroon, zie
//   components/PlayerAbsenceList.tsx).

export const BULK_SLEUTEL = '*'

export interface RijOpslagOpties<V> {
  bevestigd: Record<string, V>
  opslaan: (k: string, v: V) => Promise<unknown>
  onFout: (k: string) => void
}

export interface RijOpslag<V> {
  waarden: Record<string, V>
  zet: (k: string, v: V) => void
  isOnderweg: (k: string) => boolean
  // Er loopt een rij-opslag óf een bulk-opslag.
  iemandOnderweg: boolean
  // Er loopt een bulk-opslag (alle rijknoppen horen dan uit).
  bulkOnderweg: boolean
  zetAlles: (nieuw: Record<string, V>, opslaanAlles: () => Promise<unknown>) => void
  synchroniseer: (bevestigd: Record<string, V>) => void
}

export function useRijOpslag<V>({ bevestigd, opslaan, onFout }: RijOpslagOpties<V>): RijOpslag<V> {
  const [waarden, setWaarden] = useState<Record<string, V>>(bevestigd)
  const [bevestigdState, setBevestigdState] = useState<Record<string, V>>(bevestigd)
  const [onderweg, setOnderweg] = useState<ReadonlySet<string>>(() => new Set())
  const [bulkOnderweg, setBulkOnderweg] = useState(false)

  // Async-paden lezen de refs (altijd actueel); render leest de state.
  const bevestigdRef = useRef(bevestigd)
  const onderwegRef = useRef<Set<string>>(new Set())
  const wachtendRef = useRef<Map<string, V>>(new Map())
  const bulkRef = useRef(false)
  const opslaanRef = useRef(opslaan)
  const onFoutRef = useRef(onFout)
  useEffect(() => {
    opslaanRef.current = opslaan
    onFoutRef.current = onFout
  })
  useEffect(() => {
    bevestigdRef.current = bevestigdState
  }, [bevestigdState])

  const zetBevestigd = useCallback((updater: (b: Record<string, V>) => Record<string, V>) => {
    const volgend = updater(bevestigdRef.current)
    bevestigdRef.current = volgend
    setBevestigdState(volgend)
  }, [])

  const markeerOnderweg = useCallback((k: string, aan: boolean) => {
    if (aan) onderwegRef.current.add(k)
    else onderwegRef.current.delete(k)
    setOnderweg(new Set(onderwegRef.current))
  }, [])

  const terugNaarBevestigd = useCallback((k: string) => {
    const b = bevestigdRef.current
    setWaarden((w) => {
      const copy = { ...w }
      if (k in b) copy[k] = b[k]
      else delete copy[k]
      return copy
    })
  }, [])

  const verstuur = useCallback(async (k: string, eerste: V) => {
    markeerOnderweg(k, true)
    let huidig = eerste
    try {
      for (;;) {
        await opslaanRef.current(k, huidig)
        const verstuurd = huidig
        zetBevestigd((b) => ({ ...b, [k]: verstuurd }))
        if (!wachtendRef.current.has(k)) return
        const wachtend = wachtendRef.current.get(k) as V
        wachtendRef.current.delete(k)
        // Wachtende waarde gelijk aan wat net is opgeslagen: niets te doen.
        if (Object.is(wachtend, verstuurd)) return
        huidig = wachtend
      }
    } catch {
      wachtendRef.current.delete(k)
      terugNaarBevestigd(k)
      onFoutRef.current(k)
    } finally {
      markeerOnderweg(k, false)
    }
  }, [markeerOnderweg, terugNaarBevestigd, zetBevestigd])

  const zet = useCallback((k: string, v: V) => {
    if (bulkRef.current) return
    setWaarden((w) => ({ ...w, [k]: v }))
    if (onderwegRef.current.has(k)) {
      wachtendRef.current.set(k, v)
      return
    }
    void verstuur(k, v)
  }, [verstuur])

  const zetAlles = useCallback((nieuw: Record<string, V>, opslaanAlles: () => Promise<unknown>) => {
    if (bulkRef.current || onderwegRef.current.size > 0) return
    bulkRef.current = true
    setBulkOnderweg(true)
    setWaarden((w) => ({ ...w, ...nieuw }))
    void (async () => {
      try {
        await opslaanAlles()
        zetBevestigd((b) => ({ ...b, ...nieuw }))
      } catch {
        setWaarden({ ...bevestigdRef.current })
        onFoutRef.current(BULK_SLEUTEL)
      } finally {
        bulkRef.current = false
        setBulkOnderweg(false)
      }
    })()
  }, [zetBevestigd])

  const synchroniseer = useCallback((nieuw: Record<string, V>) => {
    // Rijen die onderweg zijn houden hun lokale waarde en bevestigde waarde;
    // alle andere rijen nemen de serverwaarde over.
    const vast = bulkOnderweg ? null : onderweg
    const overnemen = (huidig: Record<string, V>) => {
      const copy = { ...nieuw }
      if (vast === null) return { ...huidig }
      vast.forEach((k) => {
        if (k in huidig) copy[k] = huidig[k]
        else delete copy[k]
      })
      return copy
    }
    setWaarden(overnemen)
    // bevestigdRef volgt de state via de effect hierboven.
    setBevestigdState(overnemen)
  }, [onderweg, bulkOnderweg])

  const isOnderweg = useCallback((k: string) => onderweg.has(k), [onderweg])

  return {
    waarden,
    zet,
    isOnderweg,
    iemandOnderweg: bulkOnderweg || onderweg.size > 0,
    bulkOnderweg,
    zetAlles,
    synchroniseer,
  }
}

// Wachtrij van lopende opslagacties (client), zodat "PDF delen" pas een PDF
// laat maken nadat de gebruiker zijn wijzigingen is opgeslagen. De PDF wordt
// server-side van de opgeslagen database-stand gerenderd; wat nog als
// debounce of optimistische transitie in de browser hangt, zou er anders
// niet in staan.
//
// Module-singleton: de editors registreren hier, PrintButton wacht erop.

import { useCallback, useTransition } from 'react'

const lopend = new Set<Promise<unknown>>()
const flushers = new Set<() => void>()
const luisteraars = new Set<() => void>()

function seinGewijzigd() {
  luisteraars.forEach((fn) => fn())
}

// Registreert een lopende opslag; haalt hem er na afloop (ook bij een fout)
// weer uit. Geeft dezelfde belofte terug.
export function volgOpslag<T>(p: Promise<T>): Promise<T> {
  lopend.add(p)
  const klaar = () => {
    lopend.delete(p)
  }
  p.then(klaar, klaar)
  seinGewijzigd()
  return p
}

// Een flusher vuurt een openstaande debounce direct af (en start zo de
// opslag, die via volgOpslag/useOpslagTransition in de wachtrij komt).
// Geeft een functie terug om weer af te melden.
export function registreerFlush(fn: () => void): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

// Krijgt een seintje zodra er een nieuwe opslag in de wachtrij komt.
export function abonneerOpslag(fn: () => void): () => void {
  luisteraars.add(fn)
  return () => {
    luisteraars.delete(fn)
  }
}

export class OpslagTimeoutFout extends Error {
  constructor() {
    super('opslag-timeout')
    this.name = 'OpslagTimeoutFout'
  }
}

// Vuurt alle flushers af en wacht tot de wachtrij leeg is. Een mislukte
// opslag blokkeert niet (allSettled): de PDF toont dan de stand in de
// database, net als de rollback op het scherm. Verstrijkt de tijd eerst,
// dan gooit dit een OpslagTimeoutFout.
export async function wachtOpOpslag({ timeoutMs }: { timeoutMs: number }): Promise<void> {
  flushers.forEach((fn) => fn())
  if (lopend.size === 0) return

  let timer: ReturnType<typeof setTimeout> | undefined
  const verlopen = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OpslagTimeoutFout()), timeoutMs)
  })
  try {
    // Herhalen: een afgeronde opslag kan een volgende hebben uitgelokt.
    const leeg = (async () => {
      while (lopend.size > 0) await Promise.allSettled([...lopend])
    })()
    await Promise.race([leeg, verlopen])
  } finally {
    clearTimeout(timer)
  }
}

type OpslagActie = () => void | Promise<void>

// Vervanger voor useTransition met dezelfde [isPending, start]-vorm; een
// async actie wordt in de wachtrij gezet.
export function useOpslagTransition(): [boolean, (actie: OpslagActie) => void] {
  const [isPending, startTransition] = useTransition()
  const start = useCallback(
    (actie: OpslagActie) => {
      startTransition(() => {
        const resultaat = actie()
        if (resultaat) volgOpslag(resultaat)
        return resultaat
      })
    },
    [startTransition],
  )
  return [isPending, start]
}

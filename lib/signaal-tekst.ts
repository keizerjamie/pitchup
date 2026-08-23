import type { Dict } from '@/messages/nl'
import { maandLabel, type Signaal } from '@/lib/inzichten'

// Zet één signaal om naar de zin die de gebruiker leest. Staat hier en niet in
// lib/inzichten.ts omdat dit bestand de Dict nodig heeft en lib/inzichten.ts
// bewust taalonafhankelijk is: bepaalSignalen() levert een sleutel plus
// waarden, deze functie maakt er tekst van.
//
// Gedeeld tussen het scherm (components/inzichten/SignalenBlok.tsx) en het
// print-rapport (components/inzichten/SeizoensrapportPrint.tsx) — twee
// implementaties zouden vroeg of laat twee verschillende zinnen opleveren voor
// hetzelfde signaal.
export function vulSignaalIn(t: Dict, signaal: Signaal): string {
  // De tekstsleutel komt uit de vaste verzameling die bepaalSignalen()
  // hanteert, maar de Dict is getypeerd op zijn eigen sleutels — vandaar deze
  // expliciete opzoeking, met de kale sleutelnaam als terugval in plaats van
  // `undefined` in de UI.
  const sjabloon = (t.insights as unknown as Record<string, string>)[signaal.tekstSleutel] ?? signaal.tekstSleutel

  let tekst = sjabloon
  for (const [sleutel, waarde] of Object.entries(signaal.waarden)) {
    // `maand` krijgt een aparte behandeling: de signaal-logica levert de kale
    // 'YYYY-MM' (taalonafhankelijk, zoals alles in lib/inzichten.ts), hier
    // wordt dat pas een leesbaar maandlabel — met exact dezelfde notatie als
    // de grafiek op het scherm.
    const zichtbaar = sleutel === 'maand' ? maandLabel(String(waarde), t.browserLocale) : String(waarde)
    tekst = tekst.split(`{${sleutel}}`).join(zichtbaar)
  }
  return tekst
}

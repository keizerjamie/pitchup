'use client'

import { useId } from 'react'
import { begroetingScript, begroetingVoorUur, type BegroetingLabels } from '@/lib/begroeting'

// Begroeting op het dashboard. De server rendert een begroeting op servertijd;
// het inline script direct na de span corrigeert die synchroon vóór de eerste
// paint op basis van de klok van het APPARAAT (de server draait in UTC). Bij
// client-navigatie rekent deze component zelf met new Date().getHours() en is
// het script inert (type text/plain). Patroon: Next-docs "Preventing flash
// before hydration".
export default function Begroeting({ labels, nonce }: { labels: BegroetingLabels; nonce?: string }) {
  const id = useId()
  return (
    <>
      <span id={id} suppressHydrationWarning>
        {labels[begroetingVoorUur(new Date().getHours())]}
      </span>
      <script
        nonce={nonce}
        type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: begroetingScript(id, labels) }}
      />
    </>
  )
}

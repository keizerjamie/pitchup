'use client'

import { begroetingVoorUur, lokaalUur, type BegroetingLabels } from '@/lib/begroeting'
import { TIJDZONE_STARTSCHERM } from '@/lib/amsterdam-dag'

// Begroeting op het dashboard, op het Amsterdamse uur: dezelfde klok als de
// datumregel en de kaarten op het startscherm. Server en client rekenen met
// dezelfde tijdzone, dus geen inline script of nonce meer nodig. Rond een
// uurgrens kan de client een ander uur zien dan de server rende;
// suppressHydrationWarning dekt dat ene tekstverschil.
export default function Begroeting({ labels }: { labels: BegroetingLabels }) {
  return (
    <span suppressHydrationWarning>
      {labels[begroetingVoorUur(lokaalUur(new Date(), TIJDZONE_STARTSCHERM))]}
    </span>
  )
}

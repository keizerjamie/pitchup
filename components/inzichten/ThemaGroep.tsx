'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import type { Dict } from '@/messages/nl'
import ChevronIcon from '@/components/icons/ChevronIcon'

// Eén inklapbaar thema op /inzichten. Native <details>/<summary>: toetsenbord
// en screenreader werken vanzelf, en de kaarten blijven ook als het thema
// dicht is gewoon in de DOM (client-state van RatingsChart/DoelpuntenChart
// blijft behouden). Geen animatie en geen koppen-element: de kaarttitels
// blijven de enige h2's op de pagina.
//
// Client-component alleen om bij een periodewissel de standaardstand terug te
// zetten zonder het element te hermonteren (state binnen kaarten blijft staan).

export default function ThemaGroep({
  sleutel,
  titel,
  aantal,
  onvolledig,
  standaardOpen,
  resetSleutel,
  t,
  children,
}: {
  sleutel: string
  titel: string
  aantal: number
  onvolledig: number
  standaardOpen: boolean
  resetSleutel: string
  t: Dict
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.open = standaardOpen
  }, [resetSleutel, standaardOpen])

  const aantalTekst = (aantal === 1 ? t.insights.themaAantalEen : t.insights.themaAantal).replace('{n}', String(aantal))

  return (
    <details data-thema={sleutel} open={standaardOpen} ref={ref} className="group">
      <summary
        className="list-none [&::-webkit-details-marker]:hidden cursor-pointer min-h-12 px-4 flex items-center gap-3 rounded-[var(--radius-card)]"
        style={{ background: 'var(--surface)', border: '1px solid var(--border-soft)' }}
      >
        <span className="font-display text-[15px] font-bold text-ink">{titel}</span>
        <span data-themameta className="text-[12px] font-semibold text-faint">
          {aantalTekst}
        </span>
        {onvolledig > 0 && (
          <span data-themameta className="text-[12px] font-semibold" style={{ color: 'var(--warning-text)' }}>
            {t.insights.themaOnvolledig.replace('{n}', String(onvolledig))}
          </span>
        )}
        <ChevronIcon className="ml-auto w-[18px] h-[18px] text-faint flex-shrink-0 transition-none! group-open:rotate-180" />
      </summary>
      <div className="pt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>
    </details>
  )
}

'use client'

import { useState } from 'react'

interface Props {
  src: string | null
  size: number
  alt: string
  fallback: React.ReactNode
}

// Gedeeld presentatiecomponent voor het teamlogo — gebruikt in AppShell
// (zijbalk + mobiele header) en MatchSquadPrintList (export-kop). Bewust een
// gewone <img>, geen next/image: de host van het logo (Supabase Storage) staat
// niet in images.remotePatterns, en de Image-optimizer zou bij het afdrukken
// (window.print()) een extra, mogelijk niet op tijd afgeronde netwerkronde
// toevoegen. Om diezelfde reden ook GEEN loading="lazy": een lui geladen logo
// kan bij het printen nog niet binnen zijn.
//
// src === null (geen logo ingesteld) of een mislukte load (bv. een
// settings-rij die naar een inmiddels verwijderd bestand wijst) tonen allebei
// dezelfde `fallback` — nooit een kapot beeld-icoon.
export default function TeamLogo({ src, size, alt, fallback }: Props) {
  const [failed, setFailed] = useState(false)
  // Een nieuwe src (bv. na upload/verwijderen) krijgt een schone kans: een
  // eerdere load-fout van een ANDER logo mag de nieuwe niet blijven
  // blokkeren. State tijdens het renderen aanpassen i.p.v. via een effect
  // (het aanbevolen React-patroon voor "reset state bij een prop-wijziging",
  // voorkomt een overbodige extra render-cyclus via useEffect+setState).
  const [prevSrc, setPrevSrc] = useState(src)
  if (src !== prevSrc) {
    setPrevSrc(src)
    setFailed(false)
  }

  const showFallback = src === null || failed

  return (
    <div
      className="rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {showFallback ? (
        fallback
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- zie kopcomment: bewust geen next/image
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

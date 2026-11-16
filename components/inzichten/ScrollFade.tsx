'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// Horizontaal scrollende inhoud met een zachte fade aan de kant(en) waar nog
// inhoud ligt. Puur visueel: de randen vangen geen pointer-events en bewegen
// niet (geen transitie).
//
// Bewust meting met scrollpositie en geen CSS scroll-driven animaties: die
// worden door globals.css voor reduced motion uitgezet en ontbreken in oudere
// Safari/Firefox. Een mask of background-attachment: local zou bovendien de
// sticky eerste kolom van de weektabel overlappen; daarom schuift de
// startrand met `vasteStartkolom` op naast die kolom.
//
// De beginstand is "geen randen" zodat server en eerste client-render gelijk
// zijn; de randen verschijnen pas na de meting in een effect.

interface Randen {
  start: boolean
  eind: boolean
  inset: number
}

const GEEN_RANDEN: Randen = { start: false, eind: false, inset: 0 }

export default function ScrollFade({
  children,
  role,
  ariaLabel,
  wrapperClassName = '',
  vasteStartkolom = false,
}: {
  children: ReactNode
  role?: string
  ariaLabel?: string
  wrapperClassName?: string
  vasteStartkolom?: boolean
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [randen, setRanden] = useState<Randen>(GEEN_RANDEN)

  const meet = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const scrolbaar = max > 1
    const start = scrolbaar && el.scrollLeft > 1
    const eind = scrolbaar && el.scrollLeft < max - 1
    let inset = 0
    if (vasteStartkolom && start) {
      const kolom = el.querySelector('th.sticky')
      inset = kolom ? Math.round(kolom.getBoundingClientRect().width) : 0
    }
    setRanden((vorige) =>
      vorige.start === start && vorige.eind === eind && vorige.inset === inset ? vorige : { start, eind, inset },
    )
  }, [vasteStartkolom])

  useEffect(() => {
    meet()
    const el = scrollerRef.current
    let frame = 0
    const plan = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        meet()
      })
    }
    el?.addEventListener('scroll', plan, { passive: true })
    window.addEventListener('resize', plan)
    let waarnemer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined' && el) {
      waarnemer = new ResizeObserver(plan)
      waarnemer.observe(el)
      if (el.firstElementChild) waarnemer.observe(el.firstElementChild)
    }
    return () => {
      el?.removeEventListener('scroll', plan)
      window.removeEventListener('resize', plan)
      waarnemer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [meet])

  return (
    <div className={`relative ${wrapperClassName}`.trim()}>
      <div ref={scrollerRef} className="overflow-x-auto" role={role} aria-label={ariaLabel}>
        {children}
      </div>
      {randen.start && (
        <div
          data-scroll-rand="start"
          className="pointer-events-none absolute inset-y-0 w-6 z-[1]"
          style={{ left: randen.inset, background: 'linear-gradient(to right, var(--surface), transparent)' }}
        />
      )}
      {randen.eind && (
        <div
          data-scroll-rand="eind"
          className="pointer-events-none absolute inset-y-0 right-0 w-6 z-[1]"
          style={{ background: 'linear-gradient(to left, var(--surface), transparent)' }}
        />
      )}
    </div>
  )
}

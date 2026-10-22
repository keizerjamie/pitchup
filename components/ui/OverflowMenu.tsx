'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react'
import { useDict } from '@/lib/i18n-context'
import { IconButton } from '@/components/ui/Button'

// ⋯-menu rechtsboven in de PageHeader: hier horen de secundaire acties
// (bewerken, kopiëren) en de destructieve (verwijderen). Zo staat verwijderen
// nooit meer naast de hoofdactie of onderaan een lange pagina.
//
// Een item met `action` is een server action die van een server component als
// prop wordt doorgegeven (zelfde patroon als DeleteButton). Met `confirm`
// vraagt het menu eerst bevestiging via window.confirm, net als DeleteButton.

export type OverflowMenuItem = {
  label: string
  /** Material Symbols-naam (moet in de gesubsette font zitten) of een inline-SVG. */
  icon?: string | ReactNode
  danger?: boolean
  confirm?: string
} & ({ href: string; action?: never; onSelect?: never }
  | { action: () => Promise<void>; href?: never; onSelect?: never }
  | { onSelect: () => void; href?: never; action?: never })

// Drie stippen als inline SVG: `more_horiz`/`more_vert` zitten niet in de
// gesubsette icoonfont (zie geheugen.md, icoon-subset-gotcha).
function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

export default function OverflowMenu({ items, label }: { items: OverflowMenuItem[]; label?: string }) {
  const t = useDict()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  function run(item: OverflowMenuItem) {
    if (item.confirm && !window.confirm(item.confirm)) return
    setOpen(false)
    if (item.action) {
      const action = item.action
      startTransition(async () => { await action() })
    } else if (item.onSelect) {
      item.onSelect()
    }
  }

  const itemClass = (danger?: boolean) =>
    `w-full flex items-center gap-3 px-3.5 h-11 rounded-xl text-left text-sm font-semibold transition-colors menu-item ${
      danger ? 'text-[var(--chip-red-fg)]' : 'text-ink'
    }`

  return (
    <div ref={rootRef} className="relative print:hidden">
      <IconButton
        ref={triggerRef}
        aria-label={label ?? t.common.moreActions}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={pending}
        onClick={() => setOpen(o => !o)}
      >
        <DotsIcon />
      </IconButton>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="menu-popover absolute right-0 top-full mt-2 min-w-[220px] p-1.5 z-[var(--z-sheet)]"
        >
          {items.map((item, i) => {
            const content = (
              <>
                {typeof item.icon === 'string'
                  ? <span className="ms text-[20px] opacity-80" aria-hidden="true">{item.icon}</span>
                  : item.icon && <span className="inline-flex w-5 h-5 opacity-80 [&>svg]:w-5 [&>svg]:h-5" aria-hidden="true">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
              </>
            )
            const separator = item.danger && i > 0 && !items[i - 1].danger
            return (
              <div key={item.label}>
                {separator && <div className="my-1 h-px bg-[var(--border-soft)]" role="separator" />}
                {item.href ? (
                  <Link href={item.href} role="menuitem" className={itemClass(item.danger)} onClick={() => setOpen(false)}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" role="menuitem" className={itemClass(item.danger)} onClick={() => run(item)}>
                    {content}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

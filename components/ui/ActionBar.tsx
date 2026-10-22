import type { ReactNode } from 'react'

// Vaste knoppenbalk onder een formulier (designronde 3). Volgorde is overal
// gelijk: secundair (Annuleren) links, primair (Opslaan/Aanmaken) rechts en
// breedst. Op mobiel plakt de balk vlak boven de onderbalk (Navigation:
// 62px track + max(safe-area, 10px) padding) zodat de opslaanknop nooit meer
// achter de navigatie of de FAB valt; vanaf md staat hij gewoon onder het
// formulier.

interface Props {
  /** Secundaire actie, meestal een Annuleren-knop of -link. */
  secondary?: ReactNode
  /** De hoofdactie (submit). */
  primary: ReactNode
  className?: string
}

export default function ActionBar({ secondary, primary, className = '' }: Props) {
  return (
    <div className={`action-bar sticky z-[var(--z-chrome)] -mx-4 px-4 md:mx-0 md:px-0 print:hidden ${className}`}>
      <div className="action-bar-inner flex items-center gap-3 p-2">
        {secondary && <div className="flex-shrink-0">{secondary}</div>}
        <div className="flex-1 min-w-0 [&>*]:w-full">{primary}</div>
      </div>
    </div>
  )
}

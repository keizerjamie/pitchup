import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// jsdom kent window.matchMedia niet standaard. useReducedMotion()
// (lib/use-reduced-motion.ts) roept het aan bij elke render, en zit sinds de
// assistent-trainers-fase-2-feature ook in AppShell.tsx (via TeamSwitcher) —
// dus in vrijwel elke test die AppShell of een van zijn kinderen rendert,
// niet alleen in de tests die animatie zelf toetsen. Vroeger stond deze stub
// verspreid per testbestand (components/PlayerList.test.tsx,
// components/LineupBuilder.test.tsx, ...); nu één plek zodat een nieuw
// bestand hem niet meer zelf hoeft te definiëren. Bestaande per-bestand
// stubs blijven werken (Object.defineProperty overschrijft gewoon opnieuw).
beforeEach(() => {
  // Sommige testbestanden draaien bewust met `@vitest-environment node`
  // (bv. app/actions/events-bulk.test.ts, lib/bulk-matches-xlsx.test.ts) —
  // daar bestaat `window` niet en moet deze stub een no-op zijn.
  if (typeof window === 'undefined') return
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

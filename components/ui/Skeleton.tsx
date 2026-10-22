// Statische placeholder-blokken voor app/loading.tsx (designronde 3). Bewust
// zonder pulse/shimmer: de app heeft geen animaties meer (zie "Geen
// animaties" in app/globals.css). Het skelet verschijnt direct na een tik,
// zodat navigeren vloeiend voelt terwijl de server de pagina rendert.

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-xl ${className}`} style={{ background: 'var(--track)' }} />
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="surface-card p-5 flex flex-col gap-3.5">
      <SkeletonBlock className="h-3 w-24" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <SkeletonBlock className="h-10 w-10 flex-shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <SkeletonBlock className="h-3.5 w-3/5" />
            <SkeletonBlock className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Paginaskelet in de containerconventie van de app: kop (titel + ondertitel)
// en een paar kaarten. Eén generiek skelet voor alle routes — het gaat om de
// directe reactie, niet om een pixel-exacte voorvertoning per pagina.
export default function PageSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8 flex flex-col gap-5"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-2 pt-0.5">
        <SkeletonBlock className="h-7 w-48 lg:h-8" />
        <SkeletonBlock className="h-3.5 w-64 max-w-full" />
      </div>
      <SkeletonBlock className="h-40 rounded-[var(--radius-card)]" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={2} />
      </div>
    </div>
  )
}

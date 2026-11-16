'use client'

import BottomSheet from '@/components/ui/BottomSheet'
import Button from '@/components/ui/Button'
import { useDict } from '@/lib/i18n-context'

// Bevestigingsblad op BottomSheet, met eigen knoplabels (window.confirm kan
// dat niet: "Blijven" en "Toch verlaten"). Annuleren staat links, bevestigen
// rechts (ActionBar-conventie). `gevaar` kleurt de bevestigknop als
// destructief. `nadruk="annuleer"` draait de nadruk om (veilige keuze primair,
// bevestigen secundair, bij `gevaar` met rode tekst en rand i.p.v. gevuld rood).
// Sluitknop, tik op de achtergrond en veeg-naar-beneden
// gelden als annuleren.

interface Props {
  titel: string
  tekst?: string
  bevestigLabel: string
  annuleerLabel: string
  gevaar?: boolean
  nadruk?: 'annuleer' | 'bevestig'
  onBevestig: () => void
  onAnnuleer: () => void
}

export default function BevestigBlad({
  titel, tekst, bevestigLabel, annuleerLabel, gevaar = false, nadruk = 'bevestig', onBevestig, onAnnuleer,
}: Props) {
  const t = useDict()
  return (
    <BottomSheet
      onClose={onAnnuleer}
      titel={titel}
      sluitLabel={t.common.close}
      breedte="md"
      voet={
        <>
          {nadruk === 'annuleer' ? (
            <>
              <Button variant="primary" className="flex-1" onClick={onAnnuleer}>{annuleerLabel}</Button>
              <Button
                variant="secondary"
                className="flex-1"
                style={gevaar ? { color: 'var(--danger)', boxShadow: '0 0 0 1px var(--danger) inset' } : undefined}
                onClick={onBevestig}
              >
                {bevestigLabel}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" className="flex-1" onClick={onAnnuleer}>{annuleerLabel}</Button>
              <Button variant={gevaar ? 'danger' : 'primary'} className="flex-1" onClick={onBevestig}>{bevestigLabel}</Button>
            </>
          )}
        </>
      }
    >
      {tekst && <p className="px-5 py-4 text-[14px] text-muted">{tekst}</p>}
    </BottomSheet>
  )
}

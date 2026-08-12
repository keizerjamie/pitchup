import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import BulkMatchInput from '@/components/BulkMatchInput'

function renderInput() {
  const onParsed = vi.fn()
  const utils = render(
    <DictProvider dict={nl}>
      <BulkMatchInput onParsed={onParsed} />
    </DictProvider>,
  )
  return { ...utils, onParsed }
}

describe('BulkMatchInput — bestand wint stilzwijgend van geplakte tekst (Bevinding 4)', () => {
  it('toont een melding zodra er zowel geplakte tekst als een gekozen bestand zijn', () => {
    renderInput()

    const textarea = screen.getByLabelText(nl.event.bulk.pasteLabel)
    fireEvent.change(textarea, { target: { value: 'za 12 sep 2026 14:30 thuis competitie DVC' } })
    expect(screen.queryByText(nl.event.bulk.fileOverridesText)).not.toBeInTheDocument()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['datum;tijd;tegenstander'], 'wedstrijden.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(screen.getByText(nl.event.bulk.fileOverridesText)).toBeInTheDocument()
  })

  it('toont géén melding wanneer alleen een bestand gekozen wordt (geen tekst geplakt)', () => {
    renderInput()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['datum;tijd;tegenstander'], 'wedstrijden.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(screen.queryByText(nl.event.bulk.fileOverridesText)).not.toBeInTheDocument()
  })

  it('de melding verdwijnt weer als de bestandskeuze wordt teruggedraaid', () => {
    renderInput()

    const textarea = screen.getByLabelText(nl.event.bulk.pasteLabel)
    fireEvent.change(textarea, { target: { value: 'za 12 sep 2026 14:30 thuis competitie DVC' } })

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['datum;tijd;tegenstander'], 'wedstrijden.csv', { type: 'text/csv' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(screen.getByText(nl.event.bulk.fileOverridesText)).toBeInTheDocument()

    // Bestand weer leegmaken (bv. via de bestandsdialoog annuleren) → melding weg.
    fireEvent.change(fileInput, { target: { files: [] } })
    expect(screen.queryByText(nl.event.bulk.fileOverridesText)).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import GatherTimeField from '@/components/GatherTimeField'

// Zelfde print-proxy-helper als wedstrijdselectie.acceptance.test.tsx (jsdom
// past geen @media print toe, dus print:hidden wordt via de class geverifieerd).
function hasPrintHiddenAncestor(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.classList.contains('print:hidden')) return true
    node = node.parentElement
  }
  return false
}

function renderField(overrides: Partial<Parameters<typeof GatherTimeField>[0]> = {}) {
  const onChange = overrides.onChange ?? vi.fn()
  const utils = render(
    <DictProvider dict={nl}>
      <GatherTimeField
        value={'value' in overrides ? overrides.value ?? null : null}
        onChange={onChange}
        isPending={overrides.isPending ?? false}
        error={'error' in overrides ? overrides.error ?? null : null}
      />
    </DictProvider>,
  )
  return { ...utils, onChange }
}

describe('GatherTimeField', () => {
  it('roept onChange aan met de nieuwe waarde na wijzigen + opslaan', () => {
    const { onChange } = renderField({ value: null })
    const input = screen.getByDisplayValue('') as HTMLInputElement
    fireEvent.change(input, { target: { value: '18:30' } })
    fireEvent.click(screen.getByRole('button', { name: nl.matchSquad.gatherTimeSave }))
    expect(onChange).toHaveBeenCalledWith('18:30')
  })

  it('de wisknop is uitgeschakeld zolang er nog geen waarde is', () => {
    renderField({ value: null })
    expect(screen.getByRole('button', { name: nl.matchSquad.gatherTimeClear })).toBeDisabled()
  })

  it('de wisknop roept onChange(null) aan wanneer er wél een waarde is', () => {
    const { onChange } = renderField({ value: '19:00' })
    const clearButton = screen.getByRole('button', { name: nl.matchSquad.gatherTimeClear })
    expect(clearButton).not.toBeDisabled()
    fireEvent.click(clearButton)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('draagt zelf print:hidden — nooit op de afdruk, ongeacht waar het geplaatst wordt', () => {
    renderField({ value: '18:30' })
    const label = screen.getByText(nl.matchSquad.gatherTimeEditLabel)
    const root = label.closest('div')
    expect(hasPrintHiddenAncestor(root as HTMLElement)).toBe(true)
  })

  it('toont de foutmelding wanneer error is gezet', () => {
    renderField({ error: nl.matchSquad.gatherTimeSaveError })
    expect(screen.getByText(nl.matchSquad.gatherTimeSaveError)).toBeInTheDocument()
  })

  it('een "HH:MM:SS"-waarde uit de database (Postgres TIME) verschijnt genormaliseerd in het veld en kan zonder wijziging opnieuw worden opgeslagen', () => {
    const { onChange } = renderField({ value: '17:30:00' })
    // Verschijnt zonder seconden — niet als rauwe "17:30:00".
    const input = screen.getByDisplayValue('17:30') as HTMLInputElement
    expect(screen.queryByDisplayValue('17:30:00')).not.toBeInTheDocument()
    // Direct opslaan zonder de waarde aan te raken mag geen seconden meesturen
    // (de server wijst "HH:MM:SS" af, zie isTimeString() in lib/utils.ts).
    fireEvent.click(screen.getByRole('button', { name: nl.matchSquad.gatherTimeSave }))
    expect(onChange).toHaveBeenCalledWith('17:30')
    expect(input.value).toBe('17:30')
  })

  it('velden zijn uitgeschakeld tijdens isPending', () => {
    renderField({ isPending: true, value: '18:30' })
    expect(screen.getByRole('button', { name: nl.matchSquad.gatherTimeSave })).toBeDisabled()
    expect(screen.getByRole('button', { name: nl.matchSquad.gatherTimeClear })).toBeDisabled()
  })
})

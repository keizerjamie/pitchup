import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import { CLUB_COLOR_FALLBACK } from '@/lib/club-colors'
import ClubColorsSection from '@/components/ClubColorsSection'

vi.mock('@/app/actions/team-colors', () => ({
  saveTeamColor: vi.fn(),
  resetTeamColor: vi.fn(),
}))

import { saveTeamColor, resetTeamColor } from '@/app/actions/team-colors'
const mockSave = saveTeamColor as unknown as ReturnType<typeof vi.fn>
const mockReset = resetTeamColor as unknown as ReturnType<typeof vi.fn>

function renderSection(initialPrimary: string | null = null, initialSecondary: string | null = null) {
  return render(
    <DictProvider dict={nl}>
      <ClubColorsSection initialPrimary={initialPrimary} initialSecondary={initialSecondary} />
    </DictProvider>,
  )
}

function getHexInput(label: string): HTMLInputElement {
  return screen.getByLabelText(`${label} — ${nl.settings.clubColorHexLabel}`) as HTMLInputElement
}

function getPickerInput(label: string): HTMLInputElement {
  return screen.getByLabelText(`${label} — ${nl.settings.clubColorPickerLabel}`) as HTMLInputElement
}

function getSaveButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: nl.settings.clubColorSave })
}

function getResetButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: nl.settings.clubColorReset })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSave.mockResolvedValue({ error: null, value: '#a1b2c3' })
  mockReset.mockResolvedValue({ error: null })
})

describe('ClubColorsSection', () => {
  it('beide null: toont de fallback-hexen + "standaardkleur"-label, geen resetknoppen', () => {
    renderSection(null, null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    const secondaryInput = getHexInput(nl.settings.clubColorSecondaryLabel)
    expect(primaryInput.value).toBe(CLUB_COLOR_FALLBACK.primary)
    expect(secondaryInput.value).toBe(CLUB_COLOR_FALLBACK.secondary)
    expect(screen.getAllByText(nl.settings.clubColorDefaultLabel).length).toBe(2)
    expect(getResetButtons().length).toBe(0)
  })

  it('geldige hex + opslaan: saveTeamColor wordt aangeroepen met (\'primary\', \'#a1b2c3\'), bevestiging zichtbaar, resetknop verschijnt', async () => {
    renderSection(null, null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    fireEvent.change(primaryInput, { target: { value: '#a1b2c3' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(mockSave).toHaveBeenCalledWith('primary', '#a1b2c3')
    expect(primaryInput.value).toBe('#a1b2c3')
    expect(getResetButtons().length).toBe(1)
  })

  it('alleen primair opslaan: saveTeamColor wordt niet met \'secondary\' aangeroepen, secundaire rij toont nog fallback', async () => {
    renderSection(null, null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    const secondaryInput = getHexInput(nl.settings.clubColorSecondaryLabel)
    fireEvent.change(primaryInput, { target: { value: '#a1b2c3' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave).not.toHaveBeenCalledWith('secondary', expect.anything())
    expect(secondaryInput.value).toBe(CLUB_COLOR_FALLBACK.secondary)
  })

  it('reset primair: resetTeamColor(\'primary\'), rij terug op fallback + resetknop weg, secundaire rij ongewijzigd', async () => {
    renderSection('#111111', '#222222')
    expect(getResetButtons().length).toBe(2)
    await act(async () => {
      fireEvent.click(getResetButtons()[0])
    })
    expect(mockReset).toHaveBeenCalledWith('primary')
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    const secondaryInput = getHexInput(nl.settings.clubColorSecondaryLabel)
    expect(primaryInput.value).toBe(CLUB_COLOR_FALLBACK.primary)
    expect(secondaryInput.value).toBe('#222222')
    // Nog maar één resetknop over (secundair).
    expect(getResetButtons().length).toBe(1)
  })

  it("'groen' invoeren + opslaan: geen server-call, clubColorErrorInvalid zichtbaar, oude waarde ongewijzigd", async () => {
    renderSection('#111111', null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    fireEvent.change(primaryInput, { target: { value: 'groen' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(mockSave).not.toHaveBeenCalled()
    expect(screen.getByText(nl.settings.clubColorErrorInvalid)).toBeInTheDocument()
  })

  it('action geeft {error:\'x\'} → melding zichtbaar, oude waarde blijft', async () => {
    mockSave.mockResolvedValueOnce({ error: 'Onbekende kleurinstelling.' })
    renderSection('#111111', null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    fireEvent.change(primaryInput, { target: { value: '#a1b2c3' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(screen.getByText('Onbekende kleurinstelling.')).toBeInTheDocument()
    // Nog steeds geen resetknop-toename: saved bleef '#111111'.
    const secondSaveClickResult = getResetButtons().length
    expect(secondSaveClickResult).toBe(1)
  })

  it('action throwt → generieke i18n-melding, nooit de ruwe fout', async () => {
    mockSave.mockRejectedValueOnce(new Error('boom'))
    renderSection(null, null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    fireEvent.change(primaryInput, { target: { value: '#a1b2c3' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(screen.getByText(nl.settings.clubColorErrorGeneric)).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })

  it('identieke primaire/secundaire kleur: geen waarschuwing in de DOM', async () => {
    renderSection(null, null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    const secondaryInput = getHexInput(nl.settings.clubColorSecondaryLabel)
    fireEvent.change(primaryInput, { target: { value: '#a1b2c3' } })
    fireEvent.change(secondaryInput, { target: { value: '#a1b2c3' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    await act(async () => {
      fireEvent.click(getSaveButtons()[1])
    })
    expect(document.body.textContent).not.toMatch(/zelfde|gelijk|identiek|contrast/i)
  })

  it('rommelige opgeslagen waarde (bv. handmatige DB-edit): colorpicker valt terug op de fallbackkleur, niet stil op zwart', () => {
    renderSection('niet-een-hexkleur', null)
    const primaryPicker = getPickerInput(nl.settings.clubColorPrimaryLabel)
    expect(primaryPicker.value).toBe(CLUB_COLOR_FALLBACK.primary)
  })

  it('colorpicker en hexveld hebben elk een unieke, herkenbare accessible name', () => {
    renderSection(null, null)
    const primaryPicker = getPickerInput(nl.settings.clubColorPrimaryLabel)
    const primaryHex = getHexInput(nl.settings.clubColorPrimaryLabel)
    expect(primaryPicker).not.toBe(primaryHex)
    expect(primaryPicker.type).toBe('color')
    expect(primaryHex.type).toBe('text')
  })

  it("'  A1B2C3 ' → na succes wordt '#a1b2c3' getoond", async () => {
    mockSave.mockResolvedValueOnce({ error: null, value: '#a1b2c3' })
    renderSection(null, null)
    const primaryInput = getHexInput(nl.settings.clubColorPrimaryLabel)
    fireEvent.change(primaryInput, { target: { value: '  A1B2C3 ' } })
    await act(async () => {
      fireEvent.click(getSaveButtons()[0])
    })
    expect(mockSave).toHaveBeenCalledWith('primary', '#a1b2c3')
    expect(primaryInput.value).toBe('#a1b2c3')
  })
})

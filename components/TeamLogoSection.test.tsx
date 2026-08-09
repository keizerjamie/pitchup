import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictProvider } from '@/lib/i18n-context'
import { nl } from '@/messages/nl'
import TeamLogoSection from '@/components/TeamLogoSection'

vi.mock('@/app/actions/team-logo', () => ({
  uploadTeamLogo: vi.fn(),
  deleteTeamLogo: vi.fn(),
}))

import { uploadTeamLogo, deleteTeamLogo } from '@/app/actions/team-logo'
const mockUpload = uploadTeamLogo as unknown as ReturnType<typeof vi.fn>
const mockDelete = deleteTeamLogo as unknown as ReturnType<typeof vi.fn>

function renderSection(initialLogoUrl: string | null = null) {
  return render(
    <DictProvider dict={nl}>
      <TeamLogoSection initialLogoUrl={initialLogoUrl} />
    </DictProvider>,
  )
}

function makeFile(opts: { name?: string; type?: string; size?: number } = {}) {
  const file = new File(['x'.repeat(opts.size ?? 1024)], opts.name ?? 'logo.png', { type: opts.type ?? 'image/png' })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpload.mockResolvedValue({ error: null })
  mockDelete.mockResolvedValue({ error: null })
  // jsdom kent createObjectURL/revokeObjectURL niet standaard.
  Object.defineProperty(window.URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock-preview'), writable: true, configurable: true })
  Object.defineProperty(window.URL, 'revokeObjectURL', { value: vi.fn(), writable: true, configurable: true })
})

describe('TeamLogoSection', () => {
  it('geen logo: verwijderknop is niet zichtbaar, hint-tekst staat er wel', () => {
    renderSection(null)
    expect(screen.queryByRole('button', { name: nl.settings.logoRemove })).not.toBeInTheDocument()
    expect(screen.getByText(nl.settings.logoNone)).toBeInTheDocument()
  })

  it('succesvolle upload toont de preview en de verwijderknop verschijnt', async () => {
    renderSection(null)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [makeFile()] } })
    })
    const uploadButton = screen.getByRole('button', { name: nl.settings.logoUpload })
    await act(async () => {
      fireEvent.click(uploadButton)
    })
    expect(mockUpload).toHaveBeenCalledTimes(1)
    const img = document.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toContain('blob:mock-preview')
    expect(screen.getByRole('button', { name: nl.settings.logoRemove })).toBeInTheDocument()
  })

  it('wél een logo: de verwijderknop is zichtbaar', () => {
    renderSection('https://example.com/logo.png?v=1')
    expect(screen.getByRole('button', { name: nl.settings.logoRemove })).toBeInTheDocument()
  })

  // Story-AC4 (Deel A) — opnieuw uploaden (bij een reeds aanwezig logo)
  // vervangt het oude bestand: de knop heet dan "Ander logo uploaden", de
  // server action krijgt het NIEUW gekozen bestand mee (niet het oude), en
  // de weergave toont na afloop precies één, bijgewerkt logo — geen
  // stapeling van oud + nieuw.
  it('opnieuw uploaden bij een bestaand logo vervangt het oude bestand door het nieuw gekozen bestand', async () => {
    let call = 0
    ;(window.URL.createObjectURL as ReturnType<typeof vi.fn>).mockImplementation(() => `blob:mock-preview-${++call}`)
    renderSection('https://example.com/logo-oud.png?v=1')

    // Bij een al aanwezig logo heet de knop "Ander logo uploaden", niet
    // "Logo uploaden".
    expect(screen.getByRole('button', { name: nl.settings.logoReplace })).toBeInTheDocument()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [makeFile({ name: 'nieuw-logo.png' })] } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.settings.logoReplace }))
    })

    expect(mockUpload).toHaveBeenCalledTimes(1)
    const uploadedFile = (mockUpload.mock.calls[0][0] as FormData).get('logo') as File
    expect(uploadedFile.name).toBe('nieuw-logo.png')

    // Precies één <img>: de nieuwe upload vervangt de weergave, stapelt niet.
    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBe(1)
    expect((imgs[0] as HTMLImageElement).src).toContain('blob:mock-preview-1')
  })

  it('foutmelding bij een door de server afgewezen upload (result.error)', async () => {
    mockUpload.mockResolvedValueOnce({ error: 'Alleen PNG-, JPG- of WebP-afbeeldingen zijn toegestaan.' })
    renderSection(null)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [makeFile()] } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.settings.logoUpload }))
    })
    expect(screen.getByText('Alleen PNG-, JPG- of WebP-afbeeldingen zijn toegestaan.')).toBeInTheDocument()
    // Geen verwijderknop: de upload is niet gelukt, er is dus nog geen logo.
    expect(screen.queryByRole('button', { name: nl.settings.logoRemove })).not.toBeInTheDocument()
  })

  it('clientzijdige voorcontrole: verkeerd bestandstype geeft direct de i18n-foutmelding, zonder de server aan te roepen', async () => {
    renderSection(null)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [makeFile({ type: 'application/pdf', name: 'logo.pdf' })] } })
    })
    expect(screen.getByText(nl.settings.logoErrorType)).toBeInTheDocument()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('clientzijdige voorcontrole: een te groot bestand geeft direct de i18n-foutmelding, zonder de server aan te roepen', async () => {
    renderSection(null)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [makeFile({ size: 3 * 1024 * 1024 })] } })
    })
    expect(screen.getByText(nl.settings.logoErrorSize)).toBeInTheDocument()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('verwijderen: bevestigt via window.confirm en roept deleteTeamLogo() aan', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection('https://example.com/logo.png?v=1')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.settings.logoRemove }))
    })
    expect(confirmSpy).toHaveBeenCalledWith(nl.settings.logoRemoveConfirm)
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: nl.settings.logoRemove })).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('verwijderen: bij annuleren van de confirm wordt deleteTeamLogo() niet aangeroepen', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSection('https://example.com/logo.png?v=1')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nl.settings.logoRemove }))
    })
    expect(mockDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: nl.settings.logoRemove })).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

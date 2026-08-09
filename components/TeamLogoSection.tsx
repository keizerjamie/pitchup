'use client'

import { useRef, useState, useTransition } from 'react'
import { uploadTeamLogo, deleteTeamLogo } from '@/app/actions/team-logo'
import { MAX_LOGO_BYTES } from '@/lib/logo-upload'
import { useDict } from '@/lib/i18n-context'
import TeamLogo from '@/components/TeamLogo'
import ImageIcon from '@/components/icons/ImageIcon'

// Uitsluitend voor de snelle clientzijdige voorcontrole (directe feedback,
// geen beveiliging) — de server sniffed het echte type uit de magic bytes
// (lib/logo-upload.ts, sniffImageMimeType) en is de enige echte poortwachter.
const ACCEPTED_CLIENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface Props {
  initialLogoUrl: string | null
}

export default function TeamLogoSection({ initialLogoUrl }: Props) {
  const t = useDict()
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function resetSelection() {
    setSelectedFile(null)
    setPreviewUrl(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setError(null)
    if (!file) {
      resetSelection()
      return
    }
    if (!ACCEPTED_CLIENT_TYPES.has(file.type)) {
      setError(t.settings.logoErrorType)
      resetSelection()
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(t.settings.logoErrorSize)
      resetSelection()
      return
    }
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function handleUpload() {
    if (!selectedFile) return
    setError(null)
    const formData = new FormData()
    formData.set('logo', selectedFile)
    startTransition(async () => {
      try {
        const result = await uploadTeamLogo(formData)
        if (result.error) {
          setError(result.error)
          return
        }
        setLogoUrl(previewUrl)
        resetSelection()
      } catch {
        setError(t.settings.logoErrorGeneric)
      }
    })
  }

  function handleDelete() {
    if (!confirm(t.settings.logoRemoveConfirm)) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await deleteTeamLogo()
        if (result.error) {
          setError(result.error)
          return
        }
        setLogoUrl(null)
      } catch {
        setError(t.settings.logoErrorGeneric)
      }
    })
  }

  const displayUrl = previewUrl ?? logoUrl

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-faint">{t.settings.logoHint}</p>
      <div className="flex items-center gap-4">
        <TeamLogo
          src={displayUrl}
          size={64}
          alt={t.settings.logoSection}
          fallback={<ImageIcon className="w-7 h-7 text-faint" />}
        />
        <div className="flex flex-col gap-1">
          {!displayUrl && <span className="text-[12.5px] font-semibold text-faint">{t.settings.logoNone}</span>}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            disabled={isPending}
            className="text-[12.5px] text-faint"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleUpload}
          disabled={isPending || !selectedFile}
          className="py-2.5 px-4 rounded-xl font-bold text-white text-[13px] active:scale-95 transition-all disabled:opacity-60"
          style={{ background: 'var(--primary)' }}
        >
          {isPending ? t.settings.logoUploading : logoUrl ? t.settings.logoReplace : t.settings.logoUpload}
        </button>
        {logoUrl && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="py-2.5 px-4 rounded-xl font-semibold text-[13px] active:scale-95 transition-all disabled:opacity-60"
            style={{ color: '#ef4444', border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)', background: 'color-mix(in srgb, #ef4444 6%, transparent)' }}
          >
            {t.settings.logoRemove}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">{error}</p>
      )}
    </div>
  )
}

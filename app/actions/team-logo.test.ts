import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { MAX_LOGO_BYTES } from '@/lib/logo-upload'
import { uploadTeamLogo, deleteTeamLogo } from '@/app/actions/team-logo'

// ────────────────────────────────────────────────
// Mocks (opzet overgenomen uit app/actions/match-squad.test.ts, uitgebreid
// met een storage-dubbel)
// ────────────────────────────────────────────────

type TableResult = { data?: unknown; error?: unknown }

function makeSupabase(opts: {
  user?: { id: string } | null
  tables?: Record<string, TableResult>
  uploadError?: { code?: string; message: string } | null
  removeError?: { code?: string; message: string } | null
} = {}) {
  const user = opts.user === undefined ? { id: 'team-1' } : opts.user
  const tables = opts.tables ?? {}
  type Eq = { col: string; val: unknown }
  const calls = {
    upsert: [] as { table: string; payload: Record<string, unknown>; options: unknown }[],
    delete: [] as { table: string; eqs: Eq[] }[],
    upload: [] as { bucket: string; path: string; file: unknown; options: unknown }[],
    remove: [] as { bucket: string; paths: string[] }[],
    publicUrl: [] as { bucket: string; path: string }[],
  }

  function chain(table: string) {
    const result = tables[table] ?? { data: null, error: null }
    const eqs: Eq[] = []
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return c }
    c.upsert = (payload: Record<string, unknown>, options?: unknown) => {
      calls.upsert.push({ table, payload, options })
      return c
    }
    c.delete = () => { calls.delete.push({ table, eqs }); return c }
    c.maybeSingle = () => Promise.resolve(result)
    c.single = () => Promise.resolve(result)
    ;(c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result)
    return c
  }

  function bucket(name: string) {
    return {
      upload: async (path: string, file: unknown, options: unknown) => {
        calls.upload.push({ bucket: name, path, file, options })
        return { data: opts.uploadError ? null : { path }, error: opts.uploadError ?? null }
      },
      remove: async (paths: string[]) => {
        calls.remove.push({ bucket: name, paths })
        return { data: opts.removeError ? null : [], error: opts.removeError ?? null }
      },
      getPublicUrl: (path: string) => {
        calls.publicUrl.push({ bucket: name, path })
        return { data: { publicUrl: `https://cdn.example/storage/v1/object/public/${name}/${path}` } }
      },
    }
  }

  const supabase = {
    from: (t: string) => chain(t),
    storage: { from: (b: string) => bucket(b) },
    auth: { getUser: async () => ({ data: { user } }) },
  }
  return { supabase, calls }
}

function use(mock: ReturnType<typeof makeSupabase>) {
  vi.mocked(createClient).mockResolvedValue(mock.supabase as unknown as Awaited<ReturnType<typeof createClient>>)
}

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]

// jsdom's Blob/File kent `arrayBuffer()` niet, terwijl die methode in de
// Node-runtime waar server actions écht draaien gewoon bestaat. We vullen hem
// hier per bestand aan zodat het File-object verder een echte jsdom-File blijft
// (en `file instanceof File` in de action dus klopt).
function makeFile(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  const file = new File([bytes], name, { type })
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })
  }
  return file
}

// Bouwt een File met echte magic bytes, plus vulling tot de gevraagde grootte.
function imageFile(header: number[], opts: { size?: number; name?: string; type?: string } = {}): File {
  const size = opts.size ?? 64
  const bytes = new Uint8Array(Math.max(size, header.length))
  bytes.set(header, 0)
  return makeFile(bytes, opts.name ?? 'logo.png', opts.type ?? 'image/png')
}

function form(file?: File | string): FormData {
  const fd = new FormData()
  if (file !== undefined) fd.set('logo', file)
  return fd
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

function logged() {
  return consoleError.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

// ────────────────────────────────────────────────
// uploadTeamLogo — succes
// ────────────────────────────────────────────────

describe('uploadTeamLogo — succespad', () => {
  it('slaat op onder het eigen team-pad, met upsert en het gesnifte content-type', async () => {
    const m = makeSupabase()
    use(m)

    const result = await uploadTeamLogo(form(imageFile(PNG_HEADER)))

    expect(result).toEqual({ error: null })
    expect(m.calls.upload).toHaveLength(1)
    expect(m.calls.upload[0].bucket).toBe('team-logos')
    expect(m.calls.upload[0].path).toBe('team-1/logo')
    expect(m.calls.upload[0].options).toEqual({
      upsert: true,
      contentType: 'image/png',
      cacheControl: '3600',
    })
  })

  it('gebruikt het gesnifte type, niet de door de client meegestuurde file.type', async () => {
    const m = makeSupabase()
    use(m)

    // Client beweert PNG, de bytes zijn JPEG. De bytes winnen.
    await uploadTeamLogo(form(imageFile(JPEG_HEADER, { name: 'logo.png', type: 'image/png' })))

    expect((m.calls.upload[0].options as { contentType: string }).contentType).toBe('image/jpeg')
  })

  it('schrijft de publieke URL met cache-buster in settings, team-gescoped', async () => {
    const m = makeSupabase()
    use(m)

    await uploadTeamLogo(form(imageFile(PNG_HEADER)))

    expect(m.calls.publicUrl).toEqual([{ bucket: 'team-logos', path: 'team-1/logo' }])
    const upsert = m.calls.upsert.find((u) => u.table === 'settings')!
    expect(upsert.payload.team_id).toBe('team-1')
    expect(upsert.payload.key).toBe('team_logo_url')
    expect(upsert.payload.value).toMatch(
      /^https:\/\/cdn\.example\/storage\/v1\/object\/public\/team-logos\/team-1\/logo\?v=\d+$/,
    )
    expect(upsert.options).toEqual({ onConflict: 'team_id,key' })
  })

  it('revalideert zowel /settings als de layout', async () => {
    use(makeSupabase())

    await uploadTeamLogo(form(imageFile(PNG_HEADER)))

    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('accepteert een bestand van precies de maximumgrootte', async () => {
    const m = makeSupabase()
    use(m)

    const result = await uploadTeamLogo(form(imageFile(PNG_HEADER, { size: MAX_LOGO_BYTES })))

    expect(result).toEqual({ error: null })
    expect(m.calls.upload).toHaveLength(1)
  })

  it('accepteert WebP', async () => {
    const m = makeSupabase()
    use(m)

    const webp = imageFile(
      [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
      { name: 'logo.webp', type: 'image/webp' },
    )
    const result = await uploadTeamLogo(form(webp))

    expect(result).toEqual({ error: null })
    expect((m.calls.upload[0].options as { contentType: string }).contentType).toBe('image/webp')
  })
})

// ────────────────────────────────────────────────
// uploadTeamLogo — weigeringen
// ────────────────────────────────────────────────

describe('uploadTeamLogo — weigeringen', () => {
  it('weigert zonder ingelogde gebruiker en schrijft niets', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    const result = await uploadTeamLogo(form(imageFile(PNG_HEADER)))

    expect(result.error).toBeTruthy()
    expect(m.calls.upload).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een ontbrekend bestand', async () => {
    const m = makeSupabase()
    use(m)

    const result = await uploadTeamLogo(form())

    expect(result.error).toBeTruthy()
    expect(m.calls.upload).toHaveLength(0)
  })

  it('weigert een leeg bestand', async () => {
    const m = makeSupabase()
    use(m)

    const result = await uploadTeamLogo(form(new File([], 'leeg.png', { type: 'image/png' })))

    expect(result.error).toBeTruthy()
    expect(m.calls.upload).toHaveLength(0)
  })

  it('weigert een veld dat geen bestand is', async () => {
    const m = makeSupabase()
    use(m)

    const result = await uploadTeamLogo(form('https://ergens/logo.png'))

    expect(result.error).toBeTruthy()
    expect(m.calls.upload).toHaveLength(0)
  })

  it('weigert een bestand groter dan het maximum', async () => {
    const m = makeSupabase()
    use(m)

    const result = await uploadTeamLogo(form(imageFile(PNG_HEADER, { size: MAX_LOGO_BYTES + 1 })))

    expect(result.error).toContain('te groot')
    expect(m.calls.upload).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weigert een bestandstype dat niet is toegestaan', async () => {
    const m = makeSupabase()
    use(m)

    const gif = imageFile([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], { name: 'logo.gif', type: 'image/gif' })
    const result = await uploadTeamLogo(form(gif))

    expect(result.error).toBeTruthy()
    expect(m.calls.upload).toHaveLength(0)
  })

  it('weigert een vervalste header: geldige file.type maar foute magic bytes', async () => {
    const m = makeSupabase()
    use(m)

    // Een uitvoerbaar bestand ('MZ') dat zich voordoet als PNG.
    const nep = makeFile(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), 'logo.png', 'image/png')
    const result = await uploadTeamLogo(form(nep))

    expect(result.error).toBeTruthy()
    expect(m.calls.upload).toHaveLength(0)
    expect(m.calls.upsert).toHaveLength(0)
  })

  it('geeft een generieke melding bij een storage-fout en lekt niets', async () => {
    const m = makeSupabase({
      uploadError: { code: '42501', message: 'new row violates row-level security policy for bucket team-logos' },
    })
    use(m)

    const result = await uploadTeamLogo(form(imageFile(PNG_HEADER)))

    expect(result.error).toBe(GENERIC_ERROR_MESSAGE)
    expect(m.calls.upsert).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('team-logo.uploadTeamLogo')
    expect(logged()).toContain('42501')
    expect(logged()).not.toContain('row-level security policy')
  })

  it('geeft een generieke melding als het opslaan van de URL faalt', async () => {
    const m = makeSupabase({
      tables: { settings: { data: null, error: { code: '23505', message: 'Key (team_id, key)=(team-1, team_logo_url) already exists' } } },
    })
    use(m)

    const result = await uploadTeamLogo(form(imageFile(PNG_HEADER)))

    expect(result.error).toBe(GENERIC_ERROR_MESSAGE)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('team-logo.uploadTeamLogo.settings')
    expect(logged()).not.toContain('already exists')
    expect(logged()).not.toContain('team_logo_url')
  })
})

// ────────────────────────────────────────────────
// deleteTeamLogo
// ────────────────────────────────────────────────

describe('deleteTeamLogo', () => {
  it('verwijdert het eigen bestand en daarna de settings-rij', async () => {
    const m = makeSupabase()
    use(m)

    const result = await deleteTeamLogo()

    expect(result).toEqual({ error: null })
    expect(m.calls.remove).toEqual([{ bucket: 'team-logos', paths: ['team-1/logo'] }])
    const del = m.calls.delete.find((d) => d.table === 'settings')!
    expect(del.eqs).toEqual([
      { col: 'team_id', val: 'team-1' },
      { col: 'key', val: 'team_logo_url' },
    ])
  })

  it('schrijft geen lege waarde weg, maar verwijdert de rij', async () => {
    const m = makeSupabase()
    use(m)

    await deleteTeamLogo()

    expect(m.calls.upsert).toHaveLength(0)
  })

  it('revalideert zowel /settings als de layout', async () => {
    use(makeSupabase())

    await deleteTeamLogo()

    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('weigert zonder ingelogde gebruiker en raakt niets aan', async () => {
    const m = makeSupabase({ user: null })
    use(m)

    const result = await deleteTeamLogo()

    expect(result.error).toBeTruthy()
    expect(m.calls.remove).toHaveLength(0)
    expect(m.calls.delete).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('stopt bij een storage-fout en laat de settings-rij staan', async () => {
    const m = makeSupabase({ removeError: { code: '42501', message: 'permission denied for bucket team-logos' } })
    use(m)

    const result = await deleteTeamLogo()

    expect(result.error).toBe(GENERIC_ERROR_MESSAGE)
    expect(m.calls.delete).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(logged()).toContain('team-logo.deleteTeamLogo.storage')
    expect(logged()).not.toContain('permission denied')
  })

  it('meldt succes als alleen de settings-rij niet gewist kon worden — het bestand is al weg', async () => {
    const m = makeSupabase({
      tables: { settings: { data: null, error: { code: '42501', message: 'permission denied for table settings' } } },
    })
    use(m)

    const result = await deleteTeamLogo()

    expect(result).toEqual({ error: null })
    expect(m.calls.remove).toHaveLength(1)
    expect(logged()).toContain('team-logo.deleteTeamLogo.settings')
    expect(logged()).not.toContain('permission denied')
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
})

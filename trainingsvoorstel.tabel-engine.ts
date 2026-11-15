// Test-hulpbestand voor trainingsvoorstel.acceptance.test.ts(x) — GEEN test zelf
// (vitest pakt alleen *.test.ts(x) op).
//
// Tabel-engine die filters ECHT toepast (geheugen.md, "Testmocks bestaan in twee
// smaken": de chainable stub in app/actions/*.test.ts negeert .eq/.in/... en
// bewijst dus niets over tenant-isolatie of filtergedrag). Ondersteunt precies
// wat stelTrainingVoor, wisselOefening, requireTeamContext, getTrainingLog en
// de trainingsplan-pagina gebruiken:
//   select(kolommen | '*' | embed 'oefeningen(...)'), eq, neq, in, gt, gte, lt,
//   lte, order, limit, maybeSingle, single, insert, update.
// Een embed 'oefeningen(x)' op training_oefeningen wordt opgelost via
// oefening_id -> store.oefeningen (zoals PostgREST de FK-join doet).

export type Row = Record<string, unknown>
export type Op = 'select' | 'insert' | 'update'
export type Call = { table: string; op: Op; payload?: unknown; matched?: number }
export type Fail = { table: string; op: Op; message?: string }

let idTeller = 0
export function resetIdTeller() {
  idTeller = 0
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  return (a as string | number) < (b as string | number) ? -1 : 1
}

// Splitst op komma's op het hoogste niveau (embeds bevatten zelf komma's).
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function makeEngine(opts: {
  user?: { id: string } | null
  members?: Row[]
  tables?: Record<string, Row[]>
  fail?: Fail[]
  // Houdt de uitvoering van een insert vast tot de promise resolved (voor
  // "uitgeschakeld tijdens verwerken").
  holdInsert?: Promise<void>
}) {
  const user = opts.user === undefined ? null : opts.user
  const calls: Call[] = []
  const store: Record<string, Row[]> = {
    team_members: opts.members ?? [],
    settings: [],
    ...(opts.tables ?? {}),
  }

  function table(name: string) {
    if (!store[name]) store[name] = []
    const rows = store[name]
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; ascending: boolean }[] = []
    let limitN: number | null = null
    let columns: string[] | null = null
    let op: Op = 'select'
    let inserted: Row[] = []
    let updatePayload: Row | null = null
    const failFor = (o: Op) => (opts.fail ?? []).find((f) => f.table === name && f.op === o)

    const project = (r: Row): Row => {
      if (!columns) return { ...r }
      const out: Row = {}
      for (const c of columns) {
        const embed = /^(\w+)\((.*)\)$/.exec(c)
        if (c === '*') {
          Object.assign(out, r)
        } else if (embed) {
          const rel = embed[1]
          const relRows = store[rel] ?? []
          const fk = rel === 'oefeningen' ? r['oefening_id'] : r[`${rel}_id`]
          const hit = relRows.find((x) => x['id'] === fk)
          if (!hit) {
            out[rel] = null
          } else if (embed[2].trim() === '*') {
            out[rel] = { ...hit }
          } else {
            const sub: Row = {}
            for (const k of splitTopLevel(embed[2])) sub[k] = hit[k]
            out[rel] = sub
          }
        } else {
          out[c] = r[c]
        }
      }
      return out
    }

    const c: Record<string, unknown> = {}
    c.select = (cols?: string) => {
      if (typeof cols === 'string') columns = splitTopLevel(cols)
      return c
    }
    c.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return c }
    c.neq = (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return c }
    c.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return c }
    c.gt = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) > 0); return c }
    c.gte = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) >= 0); return c }
    c.lt = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) < 0); return c }
    c.lte = (col: string, val: unknown) => { filters.push((r) => r[col] != null && compare(r[col], val) <= 0); return c }
    c.order = (col: string, o?: { ascending?: boolean }) => {
      orders.push({ col, ascending: o?.ascending !== false })
      return c
    }
    c.limit = (n: number) => { limitN = n; return c }
    c.insert = (payload: Row | Row[]) => {
      op = 'insert'
      const items = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
        id: `gen-${name}-${idTeller++}`,
        ...p,
      }))
      calls.push({ table: name, op: 'insert', payload })
      // Alles-of-niets: bij een fout wordt er NIETS toegevoegd.
      if (!failFor('insert')) {
        for (const item of items) rows.push(item)
        inserted = items
      }
      return c
    }
    c.update = (payload: Row) => {
      op = 'update'
      updatePayload = payload
      return c
    }

    const run = (): { data: unknown; error: unknown } => {
      const f = failFor(op)
      if (f) return { data: null, error: { message: f.message ?? 'db kapot', code: 'XX000' } }
      if (op === 'insert') return { data: inserted.map(project), error: null }
      const hits = rows.filter((r) => filters.every((fn) => fn(r)))
      if (op === 'update') {
        for (const h of hits) Object.assign(h, updatePayload)
        calls.push({ table: name, op: 'update', payload: updatePayload, matched: hits.length })
        return { data: null, error: null }
      }
      let out = hits
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const cmp = compare(a[o.col], b[o.col])
            if (cmp !== 0) return o.ascending ? cmp : -cmp
          }
          return 0
        })
      }
      if (limitN !== null) out = out.slice(0, limitN)
      calls.push({ table: name, op: 'select' })
      return { data: out.map(project), error: null }
    }

    c.maybeSingle = async () => {
      const res = run()
      const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data
      return { data, error: res.error }
    }
    c.single = c.maybeSingle
    ;(c as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const go = async () => {
        if (op === 'insert' && opts.holdInsert) await opts.holdInsert
        return run()
      }
      return go().then(resolve, reject)
    }
    return c
  }

  const supabase = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => table(t),
  }
  return { supabase, calls, store }
}

@AGENTS.md

# Pitchup

Team tracker for football coaches: players, calendar, attendance, lineups and
training periodization. Multi-tenant — one team per account.

## Stack
- Next.js 16 (App Router) + React 19, TypeScript
- Supabase (Postgres, Auth, Row Level Security) via @supabase/ssr — no ORM
- Tailwind CSS v4
- i18n: custom cookie-based dictionaries in messages/ (nl/en/de/fr/es)
- Hosted on Vercel (region dub1); database in Supabase (West EU / Ireland)

## Commands
dev: npm run dev
build: npm run build        # must pass before pushing — main auto-deploys to production
test: npm run smoke         # dependency-free HTTP checks vs a running server; no unit-test suite yet
migrate: run the SQL in supabase/*.sql by hand in the Supabase SQL Editor (no ORM/migration tool)
lint: npm run lint

## Architecture rules
- Server Components read data; Server Actions in app/actions/ perform writes.
  There are no API routes (app/api) — pages stay thin, logic lives in the
  actions and in lib/.
- Every query and action is scoped to team_id = auth.uid(). RLS enforces the
  multi-tenancy, but the app always also filters by team_id explicitly.
- Auth runs through @supabase/ssr and proxy.ts (session refresh + redirect
  guard). Supabase clients live in lib/supabase/: server.ts (Server
  Components/Actions), client.ts (browser), admin.ts (server-only service-role,
  active only when SUPABASE_SERVICE_ROLE_KEY is set).
- Folders: app/ routes + app/actions/ server actions · components/ React
  components · lib/ utils, supabase clients, types, i18n, periodization ·
  messages/ translation dictionaries · supabase/ SQL · scripts/ dev scripts ·
  public/ assets + PWA manifest/icons.

## Do not
- Do not use middleware.ts — this Next version replaced it with proxy.ts.
- Do not expose the Supabase service_role key to the client or commit it; it is
  a server-only env var, never NEXT_PUBLIC_.
- Do not store trust-sensitive flags (e.g. a future Pro/subscription plan) in
  the settings table — it is user-writable under RLS. Use a separate table with
  read-only RLS.
- Do not add a root app/loading.tsx while the experimental viewTransition flag
  is on — it leaves streamed segments hidden and unhydrated.
- Do not push a red build to main — main deploys straight to production on Vercel.

## Deeper docs
- AGENTS.md — before writing Next.js code, read the relevant guide in
  node_modules/next/dist/docs/ (this Next version has breaking changes)
- DEPLOY.md — Vercel + Supabase deployment steps
- supabase/*.sql — schema, RLS policies and migrations (run by hand)

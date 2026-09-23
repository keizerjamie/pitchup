// Uitnodigingstokens: genereren, hashen en de vormcheck.
//
// SERVER-ONLY. Dit bestand importeert `node:crypto` (stdlib, geen nieuwe
// dependency) en mag daarom nooit in een client component belanden. Het is
// bewust een plain lib en geen 'use server'-bestand: die mogen alleen async
// functies exporteren, en dit zijn synchrone, pure functies met een constante
// erbij (zie geheugen.md, "Belangrijke gotchas").
//
// ── HET MODEL, IN ÉÉN ALINEA ────────────────────────────────
// Het RUWE token bestaat maar op twee plekken: in de URL die de hoofdtrainer
// deelt, en één keer in het antwoord van createInvite. In de database staat
// uitsluitend de sha256-HASH (supabase/teams-en-leden.sql, kolom
// `token_hash`). Een DB-dump of een logregel met die hash is daarmee
// onbruikbaar als toegangsmiddel, en de link is na het herladen van de pagina
// niet meer te reproduceren — dat is een bewuste keuze van de eigenaar
// (beslissing 5), geen omissie.
//
// Geen zout en geen langzame hash (bcrypt/argon2): dit is geen wachtwoord maar
// 256 bits echte entropie. Een woordenboekaanval bestaat hier niet, en een
// langzame hash zou alleen de eigen server vertragen.

import { createHash, randomBytes } from 'node:crypto'

// 32 bytes = 256 bits. base64url levert daar 43 tekens uit het alfabet
// [A-Za-z0-9_-] van, zonder padding — URL-veilig zonder encoding, dus het
// token overleeft kopiëren en plakken uit een chat-app ongeschonden.
export const INVITE_TOKEN_BYTES = 32

// De vorm die we accepteren. Ruimer dan wat we zelf maken (43 tekens), zodat
// de tokenlengte ooit kan wijzigen zonder dat bestaande links breken, maar
// strak genoeg om te voorkomen dat er vrije tekst in een query, een logregel
// of de `next`-parameter van /login belandt.
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url')
}

// sha256, hex, lowercase — exact de vorm waar create_team_invite op controleert
// (`^[0-9a-f]{64}$`, supabase/team-invites-rpc.sql).
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// Vormcheck vóór elke aanroep met een token uit de URL. Scheelt een
// database-roundtrip bij onzin, en houdt de lengte van wat we doorgeven
// begrensd.
export function isInviteToken(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && INVITE_TOKEN_PATTERN.test(waarde)
}

// De enige toegestane vorm van de `next`-parameter op /login (brief §3.4).
// Zonder deze grens is dat een open redirect: een aanvaller zou
// /login?next=https://kwaadaardig.example kunnen laten volgen ná een geslaagde
// inlog. Alleen een eigen invite-pad komt er langs; al het andere valt terug
// op '/'.
export function veiligeNextPath(waarde: unknown): string {
  if (typeof waarde !== 'string') return '/'
  const token = waarde.startsWith('/invite/') ? waarde.slice('/invite/'.length) : null
  return token && INVITE_TOKEN_PATTERN.test(token) ? `/invite/${token}` : '/'
}

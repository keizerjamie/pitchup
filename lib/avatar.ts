// Avatar-helpers voor spelers: initialen + een op de naam afgeleide achtergrondkleur.
//
// Verhuisd uit components/PlayerList.tsx (was daar de enige gebruiker) zodat
// zowel de spelerslijst als de profielkop (components/players/PlayerProfileHeader.tsx)
// dezelfde speler altijd dezelfde kleur en initialen tonen. Puur, geen
// dependencies, geen 'use client'.

export const AVATAR_BG = ['#16a34a', '#14655c', '#0d3d38', '#1a6b63', '#0f766e', '#15803d']

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase()
}

export function avatarBg(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]
}

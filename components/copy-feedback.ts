// Gedeelde timing voor het "kopieer-label-wissel"-patroon (idle → "Gekopieerd"
// → idle), gebruikt door components/settings/InviteLinkCard.tsx en
// components/CopyOefeningButton.tsx. Eerder stonden hier twee identieke
// paren losse module-constanten; validatieronde fase 3+4 (punt 5) vroeg om
// één gedeelde plek. Zelfde precedent als components/inzichten/chartTheme.ts
// — een plain .ts-bestand naast de componenten, geen lib/-bestand (dat is
// backend-scope).
export const COPY_SUCCESS_HOLD_MS = 1600
export const COPY_LABEL_CROSSFADE_MS = 200

// Gedeeld wachtwoordbeleid. De server (app/actions/auth.ts) en de formulieren
// die een wachtwoord laten kiezen moeten dezelfde minimumlengte gebruiken;
// staat hier los van de server action zodat client-code hem kan importeren
// (een 'use server'-bestand mag alleen async functies exporteren).
export const MIN_PASSWORD_LENGTH = 12

// Bestandsnaam van een gedeelde PDF: "{titel} {dd}-{mm}-{jjjj}.pdf".
//
// `datum` is een kale YYYY-MM-DD-string en wordt NIET via `Date` omgerekend:
// - trainingsplan/selectie geven de datum van het event door (zonloos, dus
//   geen tijdzoneconversie);
// - aanwezigheid/inzichten geven `todayLocal()` (lib/utils.ts) door, de
//   datum van vandaag op het toestel.
// Het formaat is in alle talen numeriek dd-mm-jjjj.

// Tekens die in bestandsnamen op iOS/Windows/macOS niet (veilig) zijn.
const VERBODEN_TEKENS = /[\\/:*?"<>|]/g

export function pdfBestandsnaam(titel: string, datum: string): string {
  const schoneTitel = titel.replace(VERBODEN_TEKENS, '').replace(/\s+/g, ' ').trim()
  const [jaar, maand, dag] = datum.split('-')
  const naam = jaar && maand && dag ? `${schoneTitel} ${dag}-${maand}-${jaar}` : schoneTitel
  return `${naam.trim() || 'pitchup'}.pdf`
}

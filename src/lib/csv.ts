/**
 * Cellule d'un export CSV (séparateur « ; »).
 * Un texte qui commence par = + - @ (ou tabulation / retour chariot) serait
 * interprété comme une formule par Excel ou LibreOffice : on le préfixe d'une
 * apostrophe pour qu'il reste du texte. Les montants ne passent pas par là
 * (un montant négatif commence légitimement par « - »).
 */
export function celluleTexte(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return celluleBrute(s);
}

/** Cellule sans neutralisation des formules (montants, dates générées par l'application). */
export function celluleBrute(v: unknown): string {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

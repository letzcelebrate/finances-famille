import { lireCsvRaiffeisen, type FichierImport } from "./raiffeisen";
import { estBoursorama, lireCsvBoursorama } from "./boursorama";

/** Détecte le format du CSV (Raiffeisen ou Boursorama) et le lit. */
export function lireCsv(texte: string): FichierImport {
  const premiere = texte.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  if (estBoursorama(premiere)) return lireCsvBoursorama(texte);
  return lireCsvRaiffeisen(texte);
}

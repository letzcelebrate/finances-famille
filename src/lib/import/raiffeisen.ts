/**
 * Lecture des CSV Raiffeisen.
 *  - « compte » : export des mouvements du compte courant
 *      Mouvements du compte;;;;
 *      Iban;LU..;;;
 *      Solde;1234,56;EUR;;
 *      Date d'opération;Type de mouvement;Montant;Devise;Communication
 *      13/11/2026;BONIFICATION;80,00;EUR;...
 */

export type LigneImport = {
  date_operation: string; // AAAA-MM-JJ
  libelle: string;
  montant: number;
  devise: string;
  type_mouvement: string;
};

export type FichierImport = {
  format: "raiffeisen_compte";
  identifiant: string; // IBAN
  solde_banque: number | null;
  lignes: LigneImport[];
};

export class ErreurImport extends Error {}

function decouperLigne(ligne: string): string[] {
  // Point-virgule comme séparateur, guillemets possibles autour d'un champ
  const champs: string[] = [];
  let courant = "";
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') {
        courant += '"';
        i++;
      } else {
        entreGuillemets = !entreGuillemets;
      }
    } else if (c === ";" && !entreGuillemets) {
      champs.push(courant);
      courant = "";
    } else {
      courant += c;
    }
  }
  champs.push(courant);
  return champs.map((c) => c.trim());
}

function lireMontant(texte: string): number {
  const propre = texte.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(propre);
  if (!Number.isFinite(n) || propre === "") throw new ErreurImport(`Montant illisible : « ${texte} »`);
  return Math.round(n * 100) / 100;
}

function lireDate(texte: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texte);
  if (!m) throw new ErreurImport(`Date illisible : « ${texte} »`);
  const [, j, mo, a] = m;
  const d = new Date(Date.UTC(Number(a), Number(mo) - 1, Number(j)));
  if (d.getUTCDate() !== Number(j) || d.getUTCMonth() !== Number(mo) - 1) {
    throw new ErreurImport(`Date inexistante : « ${texte} »`);
  }
  return `${a}-${mo}-${j}`;
}

export function lireCsvRaiffeisen(texte: string): FichierImport {
  const lignes = texte.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lignes.length < 4) throw new ErreurImport("Fichier trop court.");

  const entete = decouperLigne(lignes[0]);
  if (entete[0] !== "Mouvements du compte") {
    throw new ErreurImport("Format non reconnu (attendu : export « Mouvements du compte » Raiffeisen).");
  }
  const iban = decouperLigne(lignes[1]);
  if (iban[0] !== "Iban" || !iban[1]) throw new ErreurImport("IBAN introuvable dans le fichier.");
  const solde = decouperLigne(lignes[2]);
  const titres = decouperLigne(lignes[3]);
  const attendus = ["Date d'opération", "Type de mouvement", "Montant", "Devise", "Communication"];
  if (attendus.some((t, i) => titres[i] !== t)) {
    throw new ErreurImport("Colonnes inattendues : le format du fichier a peut-être changé.");
  }

  const operations: LigneImport[] = lignes.slice(4).map((l, i) => {
    const c = decouperLigne(l);
    try {
      return {
        date_operation: lireDate(c[0]),
        type_mouvement: c[1] ?? "",
        montant: lireMontant(c[2] ?? ""),
        devise: c[3] || "EUR",
        libelle: c[4] ?? "",
      };
    } catch (e) {
      throw new ErreurImport(`Ligne ${i + 5} : ${(e as Error).message}`);
    }
  });

  return {
    format: "raiffeisen_compte",
    identifiant: iban[1].replace(/\s/g, ""),
    solde_banque: solde[0] === "Solde" && solde[1] ? lireMontant(solde[1]) : null,
    lignes: operations,
  };
}

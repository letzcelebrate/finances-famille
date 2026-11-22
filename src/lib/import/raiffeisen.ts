/**
 * Lecture des CSV Raiffeisen.
 *  - « compte » : export des mouvements du compte courant
 *      Mouvements du compte;;;;
 *      Iban;LU..;;;
 *      Solde;1234,56;EUR;;
 *      Date d'opération;Type de mouvement;Montant;Devise;Communication
 *      13/11/2026;BONIFICATION;80,00;EUR;...
 *  - « carte » : export des mouvements d'une carte Visa (un relevé par période)
 *      Mouvements de la carte;;;;;;;;;;;;
 *      Numero;4940XXXXXXXX1234;;;;;;;;;;;
 *      Début de période;Fin de période;Date de prélèvement;Montant total de la période;Devise;
 *        Date d'opération;Référence;Pays contrepartie;Montant en EUR;Montant d'origine;
 *        Devise d'origine;Montant commission;Devise commission
 *    Le montant total de la période n'est renseigné que sur la première ligne.
 */

export type LigneImport = {
  date_operation: string; // AAAA-MM-JJ
  libelle: string;
  montant: number;
  devise: string;
  type_mouvement: string;
};

export type FichierImport = {
  format: "raiffeisen_compte" | "raiffeisen_carte" | "boursorama";
  identifiant: string; // IBAN ou numéro de carte masqué
  solde_banque: number | null; // compte courant : solde indiqué par la banque
  periode: { debut: string; fin: string; prelevement: string; total: number } | null; // carte : relevé
  lignes: LigneImport[];
};

export class ErreurImport extends Error {}

export function decouperLigne(ligne: string): string[] {
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

export function lireMontant(texte: string): number {
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
  // Certains fichiers repassés par un tableur ont des virgules parasites en fin de ligne
  const lignes = texte
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/,+$/, ""))
    .filter((l) => l.trim() !== "");
  if (lignes.length < 4) throw new ErreurImport("Fichier trop court.");

  const entete = decouperLigne(lignes[0]);
  if (entete[0] === "Mouvements de la carte") return lireCarte(lignes);
  if (entete[0] !== "Mouvements du compte") {
    throw new ErreurImport("Format non reconnu (attendu : export Raiffeisen « Mouvements du compte » ou « Mouvements de la carte »).");
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
    periode: null,
    lignes: operations,
  };
}

function lireCarte(lignes: string[]): FichierImport {
  const numero = decouperLigne(lignes[1]);
  if (numero[0] !== "Numero" || !numero[1]) throw new ErreurImport("Numéro de carte introuvable dans le fichier.");
  const titres = decouperLigne(lignes[2]);
  const attendus = ["Début de période", "Fin de période", "Date de prélèvement", "Montant total de la période", "Devise",
    "Date d'opération", "Référence", "Pays contrepartie", "Montant en EUR", "Montant d'origine", "Devise d'origine",
    "Montant commission", "Devise commission"];
  if (attendus.some((t, i) => titres[i] !== t)) {
    throw new ErreurImport("Colonnes inattendues : le format du fichier carte a peut-être changé.");
  }

  let periode: FichierImport["periode"] = null;
  const operations: LigneImport[] = lignes.slice(3).map((l, i) => {
    const c = decouperLigne(l);
    try {
      if (!periode && c[3]) {
        periode = { debut: lireDate(c[0]), fin: lireDate(c[1]), prelevement: lireDate(c[2]), total: lireMontant(c[3]) };
      }
      if (c[11]) throw new ErreurImport("une commission est présente : cas non prévu, à traiter à la main");
      const details = [c[7], c[10] && c[10] !== "EUR" ? `${c[9]} ${c[10]}` : ""].filter(Boolean).join(" · ");
      return {
        date_operation: lireDate(c[5]),
        libelle: c[6] ?? "",
        montant: lireMontant(c[8] ?? ""),
        devise: "EUR",
        type_mouvement: details,
      };
    } catch (e) {
      throw new ErreurImport(`Ligne ${i + 4} : ${(e as Error).message}`);
    }
  });

  return {
    format: "raiffeisen_carte",
    identifiant: numero[1].replace(/\s/g, ""),
    solde_banque: null,
    periode,
    lignes: operations,
  };
}

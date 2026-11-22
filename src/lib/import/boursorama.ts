/**
 * Lecture des CSV Boursorama (« Exporter les opérations »).
 * En-tête (séparateur « ; ») :
 *   Date Opération;Date Valeur;Libellé;Libellé Suggéré;Catégorie;Catégorie Parente;
 *   Solde;Commentaire;Numéro Compte;Libellé Compte;Solde;Pointage
 * Particularités :
 *   - la date est au format AAAA-MM-JJ ;
 *   - le MONTANT de l'opération est la 1re colonne « Solde » (format « -3 963,00 ») ;
 *   - la 2e colonne « Solde » est le solde du compte (ignorée) ;
 *   - « Numéro Compte » identifie le compte (un export peut en contenir plusieurs).
 */
import { decouperLigne, ErreurImport, lireMontant, type FichierImport, type LigneImport } from "./raiffeisen";

const BOURSORAMA_ENTETE = "Date Opération";

/** Vrai si la 1re ligne ressemble à un en-tête Boursorama. */
export function estBoursorama(premiereLigne: string): boolean {
  const champs = decouperLigne(premiereLigne);
  return champs[0] === BOURSORAMA_ENTETE && champs.includes("Numéro Compte");
}

function lireDate(texte: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte);
  if (iso) {
    const [, a, mo, j] = iso;
    verifierDate(a, mo, j, texte);
    return `${a}-${mo}-${j}`;
  }
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texte);
  if (fr) {
    const [, j, mo, a] = fr;
    verifierDate(a, mo, j, texte);
    return `${a}-${mo}-${j}`;
  }
  throw new ErreurImport(`Date illisible : « ${texte} »`);
}

function verifierDate(a: string, mo: string, j: string, texte: string) {
  const d = new Date(Date.UTC(Number(a), Number(mo) - 1, Number(j)));
  if (d.getUTCDate() !== Number(j) || d.getUTCMonth() !== Number(mo) - 1) {
    throw new ErreurImport(`Date inexistante : « ${texte} »`);
  }
}

export function lireCsvBoursorama(texte: string): FichierImport {
  const lignes = texte
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/;+$/, ""))
    .filter((l) => l.trim() !== "");
  if (lignes.length < 2) throw new ErreurImport("Fichier trop court.");

  const titres = decouperLigne(lignes[0]);
  if (titres[0] !== BOURSORAMA_ENTETE) {
    throw new ErreurImport("Format non reconnu (attendu : export Boursorama « Date Opération ; … »).");
  }
  const iDate = titres.indexOf("Date Opération");
  const iLibelle = titres.indexOf("Libellé");
  const iMontant = titres.indexOf("Solde"); // la 1re colonne « Solde » = montant de l'opération
  const iCategorie = titres.indexOf("Catégorie");
  const iCompte = titres.indexOf("Numéro Compte");
  if (iDate < 0 || iLibelle < 0 || iMontant < 0 || iCompte < 0) {
    throw new ErreurImport("Colonnes inattendues : le format du fichier Boursorama a peut-être changé.");
  }

  const comptes = new Set<string>();
  const operations: LigneImport[] = lignes.slice(1).map((l, i) => {
    const c = decouperLigne(l);
    try {
      comptes.add((c[iCompte] ?? "").replace(/\s/g, ""));
      return {
        date_operation: lireDate(c[iDate] ?? ""),
        libelle: c[iLibelle] ?? "",
        montant: lireMontant(c[iMontant] ?? ""),
        devise: "EUR",
        type_mouvement: c[iCategorie] ?? "",
      };
    } catch (e) {
      throw new ErreurImport(`Ligne ${i + 2} : ${(e as Error).message}`);
    }
  });

  comptes.delete("");
  if (comptes.size > 1) {
    throw new ErreurImport(
      `Le fichier contient plusieurs comptes (${[...comptes].join(", ")}). Exporte un seul compte à la fois depuis Boursorama.`,
    );
  }

  return {
    format: "boursorama",
    identifiant: [...comptes][0] ?? "",
    solde_banque: null,
    periode: null,
    lignes: operations,
  };
}

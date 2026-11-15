import SparkMD5 from "spark-md5";

/** Même normalisation que scripts/reprise/extraire_excel.py (normaliser). */
export function normaliser(texte: string): string {
  return (texte ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Empreinte d'une opération, identique à celle calculée lors de la reprise
 * de l'historique (MD5 du texte UTF-8 ; SparkMD5.hash encode déjà en UTF-8).
 */
export function empreinte(dateIso: string, libelle: string, montant: number): string {
  return SparkMD5.hash(`${dateIso}|${normaliser(libelle)}|${montant.toFixed(2)}`);
}

/**
 * Clé de comparaison pour repérer les opérations déjà présentes :
 * date + montant + libellé sans aucun espace ni casse. Plus tolérante que
 * l'empreinte (les anciens fichiers Excel ont parfois perdu un espace).
 */
export function cleComparaison(dateIso: string, libelle: string, montant: number): string {
  return `${dateIso}|${(libelle ?? "").replace(/\s+/g, "").toUpperCase()}|${montant.toFixed(2)}`;
}

type Op = { date_operation: string; libelle: string; montant: number };

/**
 * Sépare les lignes d'un fichier en « déjà présentes » et « nouvelles ».
 * Comptage exact : si la base contient 1 opération identique et le fichier 2,
 * une seule est considérée comme déjà présente, l'autre est nouvelle.
 */
export function separerNouvelles<T extends Op>(fichier: T[], existantes: Op[]): { presentes: T[]; nouvelles: T[] } {
  const stock = new Map<string, number>();
  for (const e of existantes) {
    const k = cleComparaison(e.date_operation, e.libelle, Number(e.montant));
    stock.set(k, (stock.get(k) ?? 0) + 1);
  }
  const presentes: T[] = [];
  const nouvelles: T[] = [];
  for (const l of fichier) {
    const k = cleComparaison(l.date_operation, l.libelle, l.montant);
    const n = stock.get(k) ?? 0;
    if (n > 0) {
      stock.set(k, n - 1);
      presentes.push(l);
    } else {
      nouvelles.push(l);
    }
  }
  return { presentes, nouvelles };
}

/**
 * Numérote les opérations identiques (même empreinte) à partir d'un premier
 * numéro libre par empreinte (pour ne pas heurter celles déjà en base).
 */
export function numeroterOccurrences<T extends { empreinte: string }>(
  lignes: T[],
  dejaUtilisees: Map<string, number> = new Map(),
): (T & { occurrence: number })[] {
  const vus = new Map(dejaUtilisees);
  return lignes.map((l) => {
    const n = (vus.get(l.empreinte) ?? 0) + 1;
    vus.set(l.empreinte, n);
    return { ...l, occurrence: n };
  });
}

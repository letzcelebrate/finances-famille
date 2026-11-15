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

type Op = { date_operation: string; libelle: string; montant: number };

const compact = (libelle: string) => (libelle ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Sépare les lignes d'un fichier en « déjà présentes » et « nouvelles ».
 * Une opération est déjà présente si la base contient une opération de même
 * date et même montant dont le libellé est identique (espaces et majuscules
 * ignorés) ou commence par le libellé du fichier : dans Excel, des notes
 * étaient parfois ajoutées à la fin du libellé, ex. « La Rusticana (pizza) ».
 * Comptage exact : si la base contient 1 opération identique et le fichier 2,
 * une seule est considérée comme déjà présente, l'autre est nouvelle.
 */
export function separerNouvelles<T extends Op>(fichier: T[], existantes: Op[]): { presentes: T[]; nouvelles: T[] } {
  // libellés disponibles par (date, montant) ; chacun ne peut servir qu'une fois
  const stock = new Map<string, string[]>();
  for (const e of existantes) {
    const k = `${e.date_operation}|${Number(e.montant).toFixed(2)}`;
    stock.set(k, [...(stock.get(k) ?? []), compact(e.libelle)]);
  }
  const presentes: T[] = [];
  const nouvelles: T[] = [];
  const aRevoir: T[] = [];
  // 1er passage : libellés identiques
  for (const l of fichier) {
    const dispo = stock.get(`${l.date_operation}|${l.montant.toFixed(2)}`) ?? [];
    const i = dispo.indexOf(compact(l.libelle));
    if (i >= 0) {
      dispo.splice(i, 1);
      presentes.push(l);
    } else {
      aRevoir.push(l);
    }
  }
  // 2e passage : libellé de la base complété par une note
  for (const l of aRevoir) {
    const dispo = stock.get(`${l.date_operation}|${l.montant.toFixed(2)}`) ?? [];
    const c = compact(l.libelle);
    const i = c.length >= 3 ? dispo.findIndex((d) => d.startsWith(c)) : -1;
    if (i >= 0) {
      dispo.splice(i, 1);
      presentes.push(l);
    } else {
      nouvelles.push(l);
    }
  }
  // garder l'ordre du fichier
  const ordre = new Map(fichier.map((l, i) => [l, i]));
  const tri = (a: T, b: T) => ordre.get(a)! - ordre.get(b)!;
  return { presentes: presentes.sort(tri), nouvelles: nouvelles.sort(tri) };
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

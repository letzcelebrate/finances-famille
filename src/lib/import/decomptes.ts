/**
 * Décomptes Visa : chaque mois, la banque prélève le relevé d'une carte sur le
 * compte courant (libellé « DECOMPTE VISA AU jj/mm/aaaa »). Ce même montant doit
 * être ajouté en positif sur la carte concernée pour remettre son solde à zéro.
 *
 * Le fichier du compte courant ne dit pas de quelle carte il s'agit : on choisit
 * la carte dont le solde à la date du relevé est le plus proche du montant prélevé.
 */

const RE_DECOMPTE = /^\s*DECOMPTE\s+VISA\s+AU\s+(\d{2})\/(\d{2})\/(\d{4})/i;

/** Date du relevé (AAAA-MM-JJ) si le libellé est un décompte Visa, sinon null. */
export function dateReleve(libelle: string): string | null {
  const m = RE_DECOMPTE.exec(libelle ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export type Decompte = { cle: number; date_operation: string; libelle: string; montant: number };
export type MouvementCarte = { date_operation: string; libelle: string; montant: number };
export type CarteDecompte = { id: number; mouvements: MouvementCarte[] };
export type Attribution = { carte_id: number | null; deja_presente: boolean };

const compact = (t: string) => (t ?? "").replace(/\s+/g, "").toUpperCase();
const arrondi = (n: number) => Math.round(n * 100) / 100;

/** Toutes les façons d'associer n décomptes à des cartes différentes (n petit). */
function permutations(ids: number[], n: number): number[][] {
  if (n === 0) return [[]];
  return ids.flatMap((id) => permutations(ids.filter((x) => x !== id), n - 1).map((p) => [id, ...p]));
}

/**
 * Propose une carte pour chaque décompte (clé → attribution).
 *  - si la carte contient déjà la ligne positive (même date, même montant, même libellé) :
 *    rien à ajouter (deja_presente) ;
 *  - sinon, relevé par relevé (ordre chronologique), on associe les décomptes aux cartes
 *    en minimisant l'écart entre le solde de la carte à la date du relevé et le montant
 *    prélevé ; les lignes positives proposées comptent pour les relevés suivants.
 */
export function attribuerCartes(decomptes: Decompte[], cartes: CarteDecompte[]): Map<number, Attribution> {
  const res = new Map<number, Attribution>();
  const ajouts: { carte_id: number; date_operation: string; montant: number }[] = [];
  const aTraiter: (Decompte & { releve: string })[] = [];

  for (const d of decomptes) {
    const releve = dateReleve(d.libelle);
    if (!releve || d.montant >= 0) continue;
    const deja = cartes.find((c) =>
      c.mouvements.some((m) => m.date_operation === d.date_operation && arrondi(m.montant) === arrondi(-d.montant)
        && compact(m.libelle) === compact(d.libelle)));
    if (deja) res.set(d.cle, { carte_id: deja.id, deja_presente: true });
    else aTraiter.push({ ...d, releve });
  }
  if (cartes.length === 0) {
    for (const d of aTraiter) res.set(d.cle, { carte_id: null, deja_presente: false });
    return res;
  }

  const releves = [...new Set(aTraiter.map((d) => d.releve))].sort();
  for (const releve of releves) {
    const groupe = aTraiter.filter((d) => d.releve === releve);
    const solde = new Map(cartes.map((c) => [
      c.id,
      c.mouvements.filter((m) => m.date_operation <= releve).reduce((s, m) => s + Number(m.montant), 0)
        + ajouts.filter((a) => a.carte_id === c.id && a.date_operation <= releve).reduce((s, a) => s + a.montant, 0),
    ]));
    const ecart = (carteId: number, d: Decompte) => Math.abs(solde.get(carteId)! - d.montant);
    const ids = cartes.map((c) => c.id);

    let choix: number[];
    if (groupe.length <= ids.length && groupe.length <= 4) {
      choix = permutations(ids, groupe.length)
        .map((p) => ({ p, total: p.reduce((s, id, i) => s + ecart(id, groupe[i]), 0) }))
        .sort((a, b) => a.total - b.total)[0].p;
    } else {
      choix = groupe.map((d) => [...ids].sort((a, b) => ecart(a, d) - ecart(b, d))[0]);
    }
    groupe.forEach((d, i) => {
      res.set(d.cle, { carte_id: choix[i], deja_presente: false });
      ajouts.push({ carte_id: choix[i], date_operation: d.date_operation, montant: -d.montant });
    });
  }
  return res;
}

/**
 * Versements Vitis Life : un virement du compte courant vers un contrat de
 * retraite Vitis Life (libellé « Vitis Life, LU…, <titulaire>, Contrat … »)
 * doit être ajouté en positif sur le compte de retraite Vitis.
 */
const RE_VITIS = /^\s*VITIS\s+LIFE\b.*\bCONTRAT\b/i;

export function estVersementVitis(libelle: string): boolean {
  return RE_VITIS.test(libelle ?? "");
}

/**
 * Propose le compte de retraite pour chaque versement Vitis (clé → attribution).
 * Si le compte contient déjà la ligne positive (même date, montant, libellé) :
 * rien à ajouter (deja_presente).
 */
export function attribuerRetraite(lignes: Decompte[], retraite: CarteDecompte | null): Map<number, Attribution> {
  const res = new Map<number, Attribution>();
  for (const l of lignes) {
    if (!estVersementVitis(l.libelle) || l.montant >= 0) continue;
    if (!retraite) {
      res.set(l.cle, { carte_id: null, deja_presente: false });
      continue;
    }
    const deja = retraite.mouvements.some((m) => m.date_operation === l.date_operation
      && arrondi(m.montant) === arrondi(-l.montant) && compact(m.libelle) === compact(l.libelle));
    res.set(l.cle, { carte_id: retraite.id, deja_presente: deja });
  }
  return res;
}

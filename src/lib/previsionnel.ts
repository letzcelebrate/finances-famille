/**
 * Prévisionnel : objectifs par poste, suggestions tirées de l'historique,
 * et prévision de l'année (réel pour les mois passés, prévision pour le mois
 * en cours, objectif pour les mois à venir).
 *
 * Signes : comme les opérations (dépense négative, entrée positive).
 */

export type Mode = "variable" | "regulier";

export type Objectif = {
  poste_id: number;
  mode: Mode;
  /** variable : total attendu par mois concerné ; regulier : montant d'UNE opération */
  montant: number;
  /** regulier : nombre d'opérations par mois concerné */
  nb_operations: number;
  /** mois concernés, 1 = janvier … 12 = décembre */
  mois: number[];
};

export const TOUS_LES_MOIS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Historique d'un poste : par mois (« AAAA-MM »), nombre d'opérations et total. */
export type Historique = Map<string, { nb: number; total: number }>;

export const cleMois = (annee: number, mois: number) => `${annee}-${String(mois).padStart(2, "0")}`;

const arrondi = (n: number) => Math.round(n * 100) / 100;
function mediane(valeurs: number[]): number {
  const v = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Les n mois qui précèdent (annee, mois), du plus ancien au plus récent. */
function moisPrecedents(annee: number, mois: number, n: number): { annee: number; mois: number }[] {
  const res = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(annee, mois - 1 - i, 1);
    res.push({ annee: d.getFullYear(), mois: d.getMonth() + 1 });
  }
  return res;
}

/** Objectif mensuel équivalent (pour comparer et totaliser). */
export function montantDuMois(o: Objectif, mois: number): number {
  if (!o.mois.includes(mois)) return 0;
  return o.mode === "regulier" ? arrondi(o.montant * o.nb_operations) : o.montant;
}

/**
 * Suggestion d'objectif à partir des 24 mois terminés qui précèdent le mois
 * de référence (annee, mois). Renvoie null quand il n'y a rien de significatif.
 *
 * - Régulier tous les mois : présent au moins 10 mois sur les 12 derniers, et
 *   le même nombre d'opérations au moins 9 mois sur 12.
 * - Certains mois seulement : présent 4 mois ou moins sur les 12 derniers, dans
 *   des mois où il était déjà présent l'année d'avant.
 * - Sinon : variable, moyenne mensuelle des 12 derniers mois.
 */
export function suggererObjectif(posteId: number, h: Historique, annee: number, mois: number): Objectif | null {
  const derniers = moisPrecedents(annee, mois, 12);
  const lire = (m: { annee: number; mois: number }) => h.get(cleMois(m.annee, m.mois)) ?? { nb: 0, total: 0 };

  const presents = derniers.filter((m) => lire(m).nb > 0);
  const totalAnnee = derniers.reduce((t, m) => t + lire(m).total, 0);
  const variable = (): Objectif | null => {
    const moyenne = arrondi(totalAnnee / 12);
    return Math.abs(moyenne) < 5 ? null : { poste_id: posteId, mode: "variable", montant: moyenne, nb_operations: 1, mois: TOUS_LES_MOIS };
  };
  const regulier = (occurrences: { nb: number; total: number }[], nb: number, moisConcernes: number[]): Objectif => ({
    poste_id: posteId,
    mode: "regulier",
    montant: arrondi(mediane(occurrences.map((o) => o.total / o.nb))),
    nb_operations: nb,
    mois: moisConcernes,
  });

  if (presents.length >= 10) {
    const frequences = new Map<number, number>();
    for (const m of presents) frequences.set(lire(m).nb, (frequences.get(lire(m).nb) ?? 0) + 1);
    const [nbHabituel, combien] = [...frequences.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (combien >= 9) {
      return regulier(presents.map(lire).filter((o) => o.nb === nbHabituel), nbHabituel, TOUS_LES_MOIS);
    }
    return variable();
  }

  if (presents.length > 0 && presents.length <= 4) {
    const recurrents = presents.filter((m) => lire({ annee: m.annee - 1, mois: m.mois }).nb > 0);
    if (recurrents.length > 0) {
      const occurrences = recurrents.map(lire);
      const nb = Math.max(1, Math.round(mediane(occurrences.map((o) => o.nb))));
      return regulier(occurrences, nb, recurrents.map((m) => m.mois).sort((a, b) => a - b));
    }
  }
  return variable();
}

/** Vrai si l'objectif enregistré est assez différent de la suggestion pour mériter d'être revu. */
export function aRevoir(o: Objectif, s: Objectif | null): boolean {
  if (!s) return false;
  if (o.mode !== s.mode) return true;
  if (o.mode === "regulier" && o.nb_operations !== s.nb_operations) return true;
  if ([...o.mois].sort((a, b) => a - b).join() !== [...s.mois].sort((a, b) => a - b).join()) return true;
  const ecart = Math.abs(o.montant - s.montant);
  return ecart > 10 && ecart > 0.15 * Math.abs(o.montant);
}

/**
 * Point de référence : le mois en cours et la part de ce mois déjà écoulée,
 * d'après la date du dernier import (pas la date du jour).
 */
export function reference(annee: number, derniereDate: string | null, aujourdhui: Date = new Date()): { mois: number; fraction: number } {
  const d = derniereDate ? new Date(`${derniereDate}T12:00:00`) : aujourdhui;
  if (d.getFullYear() < annee) return { mois: 1, fraction: 0 };
  if (d.getFullYear() > annee) return { mois: 13, fraction: 0 }; // année terminée : tout est réel
  const jours = new Date(annee, d.getMonth() + 1, 0).getDate();
  return { mois: d.getMonth() + 1, fraction: d.getDate() / jours };
}

/**
 * Prévision d'un poste pour l'année.
 * reel[i] et nbPasses[i] : montant réel et nombre d'opérations déjà passées au mois i+1.
 * Mois passés : réel. Mois en cours et à venir :
 *   - régulier : réel + opérations encore attendues × montant habituel ;
 *   - variable : réel + objectif × part du mois qui reste.
 */
export function prevoirPoste(
  o: Objectif | null,
  reel: number[],
  nbPasses: number[],
  ref: { mois: number; fraction: number },
): { prevision: number[]; objectif: number[] } {
  const prevision = reel.map((r, i) => {
    const m = i + 1;
    if (m < ref.mois || !o || !o.mois.includes(m)) return r;
    if (o.mode === "regulier") return arrondi(r + Math.max(0, o.nb_operations - (nbPasses[i] ?? 0)) * o.montant);
    const reste = m === ref.mois ? 1 - ref.fraction : 1;
    return arrondi(r + o.montant * reste);
  });
  const objectif = TOUS_LES_MOIS.map((m) => (o ? montantDuMois(o, m) : 0));
  return { prevision, objectif };
}

/** Filtres « comme Excel » de la page Opérations, appliqués dans la base. */

export type Sens = "tous" | "depenses" | "entrees";

export type Filtres = {
  /** dates réelles d'opération, au format AAAA-MM-JJ (vide = pas de limite) */
  du: string;
  au: string;
  /** mois de rattachement (AAAA-MM-01, vide = tous) : sert au lien depuis Prév & Targets */
  mois: string;
  /** texte cherché dans le libellé ou la note */
  texte: string;
  /** comptes retenus ; null = tous */
  comptes: number[] | null;
  /** postes retenus ; null = tous */
  postes: number[] | null;
  /** inclure les opérations à classer (utile seulement si postes n'est pas null) */
  aClasser: boolean;
  /** montants en valeur absolue (vide = pas de limite) */
  montantMin: string;
  montantMax: string;
  sens: Sens;
};

export const FILTRES_VIDES: Filtres = {
  du: "", au: "", mois: "", texte: "", comptes: null, postes: null, aClasser: true,
  montantMin: "", montantMax: "", sens: "tous",
};

export type Colonne = "date" | "libelle" | "compte" | "poste" | "montant";

export function colonnesActives(f: Filtres): Set<Colonne> {
  const s = new Set<Colonne>();
  if (f.du || f.au || f.mois) s.add("date");
  if (f.texte.trim()) s.add("libelle");
  if (f.comptes !== null) s.add("compte");
  if (f.postes !== null) s.add("poste");
  if (f.montantMin.trim() || f.montantMax.trim() || f.sens !== "tous") s.add("montant");
  return s;
}

/** « 12,50 » ou « 12.50 » -> 12.5 ; vide ou invalide -> null */
export function lireMontant(texte: string): number | null {
  const t = texte.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

/** Texte sûr pour un filtre de la base (retire les caractères qui ont un sens spécial). */
function texteSur(t: string): string {
  return t.trim().replace(/[%,()*\\"]/g, " ").replace(/\s+/g, " ").trim();
}

/** Constructeur de requête minimal (celui de Supabase en pratique). */
export interface Requete<T> {
  gte(col: string, v: string | number): T;
  lte(col: string, v: string | number): T;
  lt(col: string, v: number): T;
  gt(col: string, v: number): T;
  in(col: string, v: number[]): T;
  eq(col: string, v: string): T;
  or(expr: string): T;
}

/**
 * operationsDivisees : identifiants des opérations divisées dont une part est
 * dans un des postes retenus (à chercher au préalable dans la table des parts).
 */
export function appliquerFiltres<T extends Requete<T>>(q: T, f: Filtres, operationsDivisees: number[] = []): T {
  let r = q;
  // Les conditions « ou » sont regroupées à la fin en une seule (voir plus bas)
  const ous: string[] = [];
  if (f.du) r = r.gte("date_operation", f.du);
  if (f.au) r = r.lte("date_operation", f.au);
  if (f.mois) r = r.eq("mois_rattachement", f.mois);

  const t = texteSur(f.texte);
  if (t) ous.push(`libelle.ilike.%${t}%,note.ilike.%${t}%`);

  if (f.comptes !== null) r = r.in("compte_id", f.comptes.length ? f.comptes : [-1]);

  if (f.postes !== null) {
    const conditions: string[] = [];
    if (f.postes.length) {
      conditions.push(`poste_id.in.(${f.postes.join(",")})`);
      // opérations divisées : retenues si une de leurs parts est dans un des postes
      if (operationsDivisees.length) conditions.push(`id.in.(${operationsDivisees.join(",")})`);
    }
    if (f.aClasser) conditions.push("a_classer.is.true");
    if (conditions.length) ous.push(conditions.join(","));
    else r = r.in("id", [-1]);
  }

  const min = lireMontant(f.montantMin);
  const max = lireMontant(f.montantMax);
  if (f.sens === "depenses") {
    r = r.lt("montant", 0);
    if (min !== null) r = r.lte("montant", -min);
    if (max !== null) r = r.gte("montant", -max);
  } else if (f.sens === "entrees") {
    r = r.gt("montant", 0);
    if (min !== null) r = r.gte("montant", min);
    if (max !== null) r = r.lte("montant", max);
  } else if (min !== null || max !== null) {
    // dépense ou entrée dont la valeur absolue est dans l'intervalle
    const pos = [min !== null ? `montant.gte.${min}` : "montant.gte.0", max !== null ? `montant.lte.${max}` : null].filter(Boolean);
    const neg = [max !== null ? `montant.gte.${-max}` : null, min !== null ? `montant.lte.${-min}` : "montant.lte.0"].filter(Boolean);
    ous.push(`and(${pos.join(",")}),and(${neg.join(",")})`);
  }

  // Une seule condition « ou » : envoyée telle quelle. Plusieurs : toutes doivent être vraies.
  if (ous.length === 1) r = r.or(ous[0]);
  else if (ous.length > 1) r = r.or(`and(${ous.map((o) => `or(${o})`).join(",")})`);
  return r;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Raccourcis de dates : [libellé, du, au] */
export function raccourcisDates(aujourdhui: Date = new Date()): [string, string, string][] {
  const a = aujourdhui.getFullYear();
  const m = aujourdhui.getMonth();
  return [
    ["Ce mois-ci", iso(new Date(a, m, 1)), iso(new Date(a, m + 1, 0))],
    ["Mois dernier", iso(new Date(a, m - 1, 1)), iso(new Date(a, m, 0))],
    ["Cette année", iso(new Date(a, 0, 1)), iso(new Date(a, 11, 31))],
    ["L'an dernier", iso(new Date(a - 1, 0, 1)), iso(new Date(a - 1, 11, 31))],
  ];
}

/** Bilan par mois : mise en forme des totaux renvoyés par la fonction bilan_par_mois. */

export type LigneBilanBrute = {
  categorie_id: number | null;
  categorie: string | null;
  categorie_rang: number | null;
  poste_id: number | null;
  poste: string | null;
  poste_ordre: number | null;
  m01: number | string; m02: number | string; m03: number | string; m04: number | string;
  m05: number | string; m06: number | string; m07: number | string; m08: number | string;
  m09: number | string; m10: number | string; m11: number | string; m12: number | string;
  total: number | string;
};

/** 12 montants mensuels + total de l'année */
export type Montants = { mois: number[]; total: number };
export type LignePoste = { nom: string; montants: Montants };
export type BlocCategorie = { nom: string; postes: LignePoste[]; sousTotal: Montants };
export type Bilan = {
  /** catégories comptées dans le résultat, dans l'ordre d'affichage */
  categories: BlocCategorie[];
  /** ressources moins dépenses (hors Neutres) */
  resultat: Montants;
  /** catégorie « Neutres » (virements entre comptes), affichée à part */
  neutres: BlocCategorie | null;
};

export const NOM_NEUTRES = "Neutres";
export const NOM_A_CLASSER = "À classer";

const CLES = ["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12"] as const;

// Les sommes se font en centimes pour éviter les erreurs d'arrondi.
const centimes = (v: number | string) => Math.round(Number(v) * 100);
const vide = (): number[] => new Array(13).fill(0); // 12 mois + total, en centimes
const versMontants = (c: number[]): Montants => ({ mois: c.slice(0, 12).map((x) => x / 100), total: c[12] / 100 });
const ajouter = (acc: number[], c: number[]) => c.forEach((x, i) => (acc[i] += x));

export function organiserBilan(lignes: LigneBilanBrute[]): Bilan {
  const blocs: { nom: string; postes: { nom: string; c: number[] }[]; c: number[] }[] = [];
  const parNom = new Map<string, (typeof blocs)[number]>();
  const resultat = vide();

  // Les lignes arrivent déjà triées (rang de catégorie, ordre du poste).
  for (const l of lignes) {
    const nomCat = l.categorie ?? NOM_A_CLASSER;
    let bloc = parNom.get(nomCat);
    if (!bloc) {
      bloc = { nom: nomCat, postes: [], c: vide() };
      parNom.set(nomCat, bloc);
      blocs.push(bloc);
    }
    const c = [...CLES.map((k) => centimes(l[k])), centimes(l.total)];
    bloc.postes.push({ nom: l.poste ?? "Opérations sans poste", c });
    ajouter(bloc.c, c);
    if (nomCat !== NOM_NEUTRES) ajouter(resultat, c);
  }

  const enBloc = (b: (typeof blocs)[number]): BlocCategorie => ({
    nom: b.nom,
    postes: b.postes.map((p) => ({ nom: p.nom, montants: versMontants(p.c) })),
    sousTotal: versMontants(b.c),
  });
  const neutres = parNom.get(NOM_NEUTRES);
  return {
    categories: blocs.filter((b) => b.nom !== NOM_NEUTRES).map(enBloc),
    resultat: versMontants(resultat),
    neutres: neutres ? enBloc(neutres) : null,
  };
}

/**
 * Nombre de mois servant à la moyenne mensuelle :
 * 12 pour une année passée, le nombre de mois entamés pour l'année en cours.
 */
export function moisPourMoyenne(annee: number, aujourdhui: Date = new Date()): number {
  const anneeCourante = aujourdhui.getFullYear();
  if (annee < anneeCourante) return 12;
  if (annee > anneeCourante) return 0;
  return aujourdhui.getMonth() + 1;
}

export function moyenne(total: number, nbMois: number): number {
  return nbMois > 0 ? Math.round((total / nbMois) * 100) / 100 : 0;
}

/** Synthèse : répartition des comptes ouverts en blocs, dans l'ordre d'affichage. */

export type Solde = {
  compte_id: number;
  banque: string;
  nom: string;
  type_compte: string;
  devise: string;
  ouvert: boolean;
  solde: number;
  derniere_operation: string | null;
  /** Famille (par défaut), Enfants ou LetzCelebrate : ces deux derniers sont hors patrimoine */
  groupe?: string;
};

export type Bloc = { titre: string; comptes: Solde[]; total: number; horsPatrimoine: boolean };
export type Synthese = { blocs: Bloc[]; total: number; disponible: number };

const TITRE_RAIFFEISEN = "Raiffeisen";
const TITRE_AUTRES = "Autres comptes courants";
const TITRE_EPARGNE = "Épargne";
const TITRE_RETRAITE = "Retraite";
/** Groupes affichés à part, après la retraite, et exclus du patrimoine de la famille */
const GROUPES_A_PART = ["Enfants", "LetzCelebrate"];

const estFamille = (s: Solde) => !GROUPES_A_PART.includes(s.groupe ?? "Famille");

/** Ordre des banques dans « Autres comptes courants » ; les autres suivent par ordre alphabétique. */
const ORDRE_AUTRES = ["Cash", "Revolut", "Boursorama"];

function bloc(s: Solde): string {
  if (!estFamille(s)) return s.groupe!;
  if (s.type_compte === "Retraite") return TITRE_RETRAITE;
  if (s.type_compte === "Epargne" || s.type_compte === "Titres") return TITRE_EPARGNE;
  if (s.banque === "Raiffeisen" && (s.type_compte === "Courant" || s.type_compte === "Carte Bancaire")) return TITRE_RAIFFEISEN;
  // Tout le reste (y compris un nouveau type de compte) : jamais masqué
  return TITRE_AUTRES;
}

const rangBanque = (b: string) => {
  const i = ORDRE_AUTRES.indexOf(b);
  return i === -1 ? ORDRE_AUTRES.length : i;
};
const fr = (a: string, b: string) => a.localeCompare(b, "fr");

function trier(titre: string, comptes: Solde[]): Solde[] {
  return [...comptes].sort((a, b) => {
    if (titre === TITRE_RAIFFEISEN) {
      // compte courant d'abord, puis les cartes
      const ta = a.type_compte === "Courant" ? 0 : 1;
      const tb = b.type_compte === "Courant" ? 0 : 1;
      if (ta !== tb) return ta - tb;
    }
    if (titre === TITRE_AUTRES) {
      const r = rangBanque(a.banque) - rangBanque(b.banque);
      if (r !== 0) return r;
    }
    return fr(a.banque, b.banque) || fr(a.nom, b.nom);
  });
}

// Sommes en centimes pour éviter les erreurs d'arrondi
const somme = (comptes: Solde[]) => comptes.reduce((t, s) => t + Math.round(s.solde * 100), 0) / 100;

export function construireSynthese(soldes: Solde[]): Synthese {
  const ordre = [TITRE_RAIFFEISEN, TITRE_AUTRES, TITRE_EPARGNE, TITRE_RETRAITE, ...GROUPES_A_PART];
  const blocs = ordre
    .map((titre) => {
      const comptes = trier(titre, soldes.filter((s) => bloc(s) === titre));
      return { titre, comptes, total: somme(comptes), horsPatrimoine: GROUPES_A_PART.includes(titre) };
    })
    .filter((b) => b.comptes.length > 0);
  const total = somme(soldes.filter(estFamille));
  const retraite = blocs.find((b) => b.titre === TITRE_RETRAITE)?.total ?? 0;
  return { blocs, total, disponible: Math.round((total - retraite) * 100) / 100 };
}

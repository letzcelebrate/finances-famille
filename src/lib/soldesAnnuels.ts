/**
 * Soldes annuels (format de l'onglet Excel) : une ligne par type de compte,
 * le solde « au jour », puis pour chaque année la variation du solde
 * (ce que le type de compte a gagné ou perdu dans l'année).
 */

export type CompteSoldes = {
  compte_id: number;
  banque: string;
  nom: string;
  type_compte: string;
  ouvert: boolean;
  /** années et soldes au 31 décembre correspondants (même longueur) ; année en cours = solde à ce jour */
  annees: number[];
  soldes: (number | string)[];
};

/** Lignes affichées, dans l'ordre ; chacune regroupe un ou plusieurs types de compte. */
export const GROUPES: { titre: string; types: string[] }[] = [
  { titre: "Courant", types: ["Courant", "Carte Bancaire", "Cash"] },
  { titre: "Epargne", types: ["Epargne"] },
  { titre: "Retraite", types: ["Retraite"] },
  { titre: "Titres", types: ["Titres"] },
];

export type Ligne = { libelle: string; auJour: number; variations: number[] };
export type Groupe = Ligne & { comptes: Ligne[] };
export type Tableau = { annees: number[]; groupes: Groupe[]; total: Ligne };

const centimes = (v: number | string) => Math.round(Number(v) * 100);

function groupeDe(type: string): number {
  const i = GROUPES.findIndex((g) => g.types.includes(type));
  return i === -1 ? 0 : i; // type inconnu : rangé dans Courant, jamais masqué
}

export function organiserSoldes(comptes: CompteSoldes[]): Tableau {
  const annees = [...new Set(comptes.flatMap((c) => c.annees))].sort((a, b) => a - b);
  // Pour chaque compte : solde au 31/12 de chaque année (en centimes), puis variations
  const lignesComptes = comptes.map((c) => {
    const soldes = annees.map((a) => {
      const i = c.annees.indexOf(a);
      return i === -1 ? null : centimes(c.soldes[i]);
    });
    // un compte sans valeur pour une année garde le solde de l'année d'avant (0 avant sa première opération)
    let dernier = 0;
    const complets = soldes.map((s) => (dernier = s ?? dernier));
    const variations = complets.map((s, i) => s - (i === 0 ? 0 : complets[i - 1]));
    return { c, auJour: complets[complets.length - 1] ?? 0, variations };
  });

  const vers = (libelle: string, auJour: number, variations: number[]): Ligne => ({
    libelle, auJour: auJour / 100, variations: variations.map((v) => v / 100),
  });

  const groupes: Groupe[] = GROUPES.map((g, gi) => {
    const membres = lignesComptes
      .filter((l) => groupeDe(l.c.type_compte) === gi)
      // détail : comptes qui ont eu au moins un solde ou un mouvement
      .filter((l) => l.auJour !== 0 || l.variations.some((v) => v !== 0))
      .sort((a, b) => Number(b.c.ouvert) - Number(a.c.ouvert) || `${a.c.banque} ${a.c.nom}`.localeCompare(`${b.c.banque} ${b.c.nom}`, "fr"));
    const auJour = membres.reduce((t, l) => t + l.auJour, 0);
    const variations = annees.map((_, i) => membres.reduce((t, l) => t + l.variations[i], 0));
    return {
      ...vers(g.titre, auJour, variations),
      comptes: membres.map((l) => vers(`${l.c.banque} — ${l.c.nom}${l.c.ouvert ? "" : " (fermé)"}`, l.auJour, l.variations)),
    };
  });

  const total = vers(
    "Solde",
    groupes.reduce((t, g) => t + Math.round(g.auJour * 100), 0),
    annees.map((_, i) => groupes.reduce((t, g) => t + Math.round(g.variations[i] * 100), 0)),
  );
  return { annees, groupes, total };
}

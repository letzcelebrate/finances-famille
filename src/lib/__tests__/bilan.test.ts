import { describe, expect, it } from "vitest";
import { moisPourMoyenne, moyenne, organiserBilan, type LigneBilanBrute } from "../bilan";

function ligne(categorie: string | null, poste: string | null, mois: Record<number, number>): LigneBilanBrute {
  const l: any = { categorie_id: 1, categorie, categorie_rang: 1, poste_id: 1, poste, poste_ordre: 1 };
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const v = mois[m] ?? 0;
    l[`m${String(m).padStart(2, "0")}`] = String(v);
    total += v;
  }
  l.total = String(Math.round(total * 100) / 100);
  return l;
}

describe("organiserBilan", () => {
  const lignes = [
    ligne("Ressource courante", "Salaire", { 1: 3000, 2: 3000 }),
    ligne("Logement", "Loyer", { 1: -1000, 2: -1000 }),
    ligne("Logement", "Electricité", { 2: -80.1 }),
    ligne("Neutres", "Virement interne", { 3: -500 }),
    ligne(null, null, { 3: -40 }),
  ];
  const b = organiserBilan(lignes);

  it("regroupe les postes par catégorie dans l'ordre reçu", () => {
    expect(b.categories.map((c) => c.nom)).toEqual(["Ressource courante", "Logement", "À classer"]);
    expect(b.categories[1].postes.map((p) => p.nom)).toEqual(["Loyer", "Electricité"]);
    expect(b.categories[2].postes[0].nom).toBe("Opérations sans poste");
  });

  it("calcule les sous-totaux sans erreur d'arrondi", () => {
    expect(b.categories[1].sousTotal.mois[1]).toBe(-1080.1);
    expect(b.categories[1].sousTotal.total).toBe(-2080.1);
  });

  it("met les Neutres à part, hors résultat", () => {
    expect(b.neutres?.sousTotal.total).toBe(-500);
    expect(b.resultat.mois).toEqual([2000, 1919.9, -40, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(b.resultat.total).toBe(3879.9);
  });

  it("fonctionne sans aucune opération", () => {
    const vide = organiserBilan([]);
    expect(vide.categories).toEqual([]);
    expect(vide.neutres).toBeNull();
    expect(vide.resultat.total).toBe(0);
  });
});

describe("moyenne mensuelle", () => {
  const ref = new Date(2026, 10, 15); // 15 novembre 2026
  it("divise par 12 pour une année passée", () => expect(moisPourMoyenne(2025, ref)).toBe(12));
  it("divise par les mois entamés pour l'année en cours", () => expect(moisPourMoyenne(2026, ref)).toBe(11));
  it("calcule la moyenne arrondie au centime", () => {
    expect(moyenne(-1000, 3)).toBe(-333.33);
    expect(moyenne(100, 0)).toBe(0);
  });
});

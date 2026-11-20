import { describe, expect, it } from "vitest";
import { moisPourMoyenne, moyenneMensuelle, organiserBilan, type LigneBilanBrute } from "../bilan";

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
  const m = (mois: number[]) => ({ mois, total: mois.reduce((a, b) => a + b, 0) });

  it("divise par 12 pour une année passée", () => expect(moisPourMoyenne(2025, ref)).toBe(12));
  it("ne compte que les mois terminés pour l'année en cours", () => {
    expect(moisPourMoyenne(2026, ref)).toBe(10);
    expect(moisPourMoyenne(2026, new Date(2026, 0, 20))).toBe(0);
    expect(moisPourMoyenne(2026, new Date(2026, 11, 31))).toBe(11);
  });
  it("exclut le mois en cours du calcul", () => {
    // 10 mois terminés à -100, novembre en cours à -40
    const montants = m([-100, -100, -100, -100, -100, -100, -100, -100, -100, -100, -40, 0]);
    expect(moyenneMensuelle(montants, 10)).toBe(-100);
  });
  it("divise par 12 sur une année complète, arrondi au centime", () => {
    expect(moyenneMensuelle(m([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 12)).toBe(8.33);
    expect(moyenneMensuelle(m([-1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 3)).toBe(-333.33);
  });
  it("renvoie 0 quand aucun mois n'est terminé", () => {
    expect(moyenneMensuelle(m([50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0)).toBe(0);
  });
});

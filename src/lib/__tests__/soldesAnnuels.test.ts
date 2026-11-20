import { describe, expect, it } from "vitest";
import { organiserSoldes, type CompteSoldes } from "../soldesAnnuels";

const compte = (id: number, banque: string, nom: string, type_compte: string, ouvert: boolean, soldes: number[]): CompteSoldes => ({
  compte_id: id, banque, nom, type_compte, ouvert, annees: [2023, 2024, 2025, 2026], soldes,
});

// Comptes et montants fictifs (soldes au 31 décembre 2023, 2024, 2025, et à ce jour en 2026)
const t = organiserSoldes([
  compte(1, "Raiffeisen", "Compte Courant", "Courant", true, [1000, 1500, 1200, 1300.1]),
  compte(2, "Raiffeisen", "Visa Gold MG", "Carte Bancaire", true, [-200, -300, -250, -400]),
  compte(3, "Cash", "Cash", "Cash", true, [50, 60, 70, 80]),
  compte(4, "Raiffeisen", "Epargne R-Top", "Epargne", true, [10000, 90000, 20000, 25000]),
  compte(5, "BGL", "Ancien livret", "Epargne", false, [500, 0, 0, 0]),
  compte(6, "Vitis Life", "Retraite Vitis", "Retraite", true, [0, 0, 3200, 6400]),
  compte(7, "Banque X", "Jamais utilisé", "Titres", false, [0, 0, 0, 0]),
]);
const g = (titre: string) => t.groupes.find((x) => x.libelle === titre)!;

describe("organiserSoldes", () => {
  it("années dans l'ordre, groupes dans l'ordre de l'Excel", () => {
    expect(t.annees).toEqual([2023, 2024, 2025, 2026]);
    expect(t.groupes.map((x) => x.libelle)).toEqual(["Courant", "Epargne", "Retraite", "Titres"]);
  });

  it("Courant regroupe comptes courants, cartes et cash", () => {
    expect(g("Courant").auJour).toBe(980.1);
    // 2023 : solde de départ ; 2024 : +500 −100 +10
    expect(g("Courant").variations).toEqual([850, 410, -240, -39.9]);
  });

  it("variation = solde de fin d'année − solde de l'année d'avant", () => {
    expect(g("Epargne").variations).toEqual([10500, 79500, -70000, 5000]);
    expect(g("Retraite").variations).toEqual([0, 0, 3200, 3200]);
  });

  it("détail : comptes fermés inclus, comptes sans aucun mouvement masqués", () => {
    expect(g("Epargne").comptes.map((c) => c.libelle)).toEqual(["Raiffeisen — Epargne R-Top", "BGL — Ancien livret (fermé)"]);
    expect(g("Titres").comptes).toEqual([]);
  });

  it("ligne Solde : total au jour et variation totale par année", () => {
    expect(t.total.auJour).toBe(32380.1);
    expect(t.total.variations).toEqual([11350, 79910, -67040, 8160.1]);
  });
});

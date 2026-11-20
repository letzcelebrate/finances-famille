import { describe, expect, it } from "vitest";
import { construireSynthese, type Solde } from "../synthese";

let id = 0;
const c = (banque: string, nom: string, type_compte: string, solde: number): Solde => ({
  compte_id: ++id, banque, nom, type_compte, devise: "EUR", ouvert: true, solde, derniere_operation: null,
});

// Comptes fictifs, mélangés exprès
const soldes = [
  c("Vitis Life", "Retraite Vitis", "Retraite", 1000),
  c("Boursorama", "Compte Essentiel (MG)", "Courant", 10),
  c("Raiffeisen", "Visa Gold SA", "Carte Bancaire", -20.1),
  c("Raiffeisen", "Epargne R-Top", "Epargne", 500),
  c("Revolut", "Compte GBP", "Courant", 5),
  c("Cash", "Cash", "Cash", 30),
  c("Raiffeisen", "Visa Gold MG", "Carte Bancaire", -10.2),
  c("Revolut", "Compte Euro", "Courant", 15),
  c("Raiffeisen", "Compte Courant", "Courant", 200),
  c("Epsens", "PEE", "Epargne", 300),
];
const s = construireSynthese(soldes);
const noms = (titre: string) => s.blocs.find((b) => b.titre === titre)!.comptes.map((x) => `${x.banque} ${x.nom}`);

describe("construireSynthese", () => {
  it("range les blocs dans l'ordre demandé", () => {
    expect(s.blocs.map((b) => b.titre)).toEqual(["Raiffeisen", "Autres comptes courants", "Épargne", "Retraite"]);
  });
  it("Raiffeisen : compte courant puis les cartes", () => {
    expect(noms("Raiffeisen")).toEqual(["Raiffeisen Compte Courant", "Raiffeisen Visa Gold MG", "Raiffeisen Visa Gold SA"]);
  });
  it("Autres comptes courants : Cash, Revolut, Boursorama", () => {
    expect(noms("Autres comptes courants")).toEqual([
      "Cash Cash", "Revolut Compte Euro", "Revolut Compte GBP", "Boursorama Compte Essentiel (MG)",
    ]);
  });
  it("l'épargne Raiffeisen reste dans Épargne", () => {
    expect(noms("Épargne")).toEqual(["Epsens PEE", "Raiffeisen Epargne R-Top"]);
  });
  it("calcule les totaux sans erreur d'arrondi", () => {
    expect(s.blocs[0].total).toBe(169.7);
    expect(s.total).toBe(2029.7);
    expect(s.disponible).toBe(1029.7);
  });
  it("un compte d'un type inconnu n'est jamais masqué", () => {
    const r = construireSynthese([c("Nouvelle banque", "Compte X", "Autre", 1)]);
    expect(r.blocs[0].titre).toBe("Autres comptes courants");
  });
});

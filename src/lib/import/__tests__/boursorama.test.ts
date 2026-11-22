import { describe, expect, it } from "vitest";
import { ErreurImport } from "../raiffeisen";
import { estBoursorama, lireCsvBoursorama } from "../boursorama";

const ENTETE =
  '"Date Opération";"Date Valeur";Libellé;"Libellé Suggéré";Catégorie;"Catégorie Parente";' +
  "Solde;Commentaire;\"Numéro Compte\";\"Libellé Compte\";Solde;Pointage";

const CSV =
  ENTETE + "\r\n" +
  '2026-06-25;2026-06-25;"VIR INST GIRAUD MARC";"Vir Inst Giraud Marc";"Virements émis";"Virements émis";"-3 963,00";;00040952052;"Compte Essentiel (MG)";10.91;Non\r\n' +
  '2026-06-22;2026-06-22;"VIR SEPA EPSENS";"Vir Sepa Epsens";"Virements reçus";"Virements reçus";"3 956,64";;00040952052;"Compte Essentiel (MG)";3973.91;Non\r\n';

describe("lecture du CSV Boursorama", () => {
  it("détecte le format Boursorama", () => {
    expect(estBoursorama(ENTETE)).toBe(true);
    expect(estBoursorama("Mouvements du compte;;;;")).toBe(false);
  });

  it("lit le numéro de compte, les montants et les libellés", () => {
    const f = lireCsvBoursorama(CSV);
    expect(f.format).toBe("boursorama");
    expect(f.identifiant).toBe("00040952052");
    expect(f.lignes).toHaveLength(2);
    expect(f.lignes[0]).toMatchObject({
      date_operation: "2026-06-25",
      libelle: "VIR INST GIRAUD MARC",
      montant: -3963,
      devise: "EUR",
      type_mouvement: "Virements émis",
    });
    expect(f.lignes[1].montant).toBe(3956.64);
  });

  it("refuse un fichier contenant plusieurs comptes", () => {
    const multi =
      ENTETE + "\r\n" +
      '2026-06-25;2026-06-25;"A";"A";"X";"X";"-10,00";;00040952052;"MG";10.00;Non\r\n' +
      '2026-06-25;2026-06-25;"B";"B";"X";"X";"10,00";;00099999999;"SA";20.00;Non\r\n';
    expect(() => lireCsvBoursorama(multi)).toThrow(ErreurImport);
  });

  it("signale une date illisible", () => {
    const mauvais = ENTETE + "\r\n" + '32/13/2026;2026-06-25;"X";"X";"Y";"Y";"1,00";;00040952052;"MG";1.00;Non\r\n';
    expect(() => lireCsvBoursorama(mauvais)).toThrow(ErreurImport);
  });
});

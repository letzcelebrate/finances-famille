import { describe, expect, it } from "vitest";
import { lireCsvRaiffeisen, ErreurImport } from "../raiffeisen";
import { empreinte, separerNouvelles } from "../empreinte";
import { preparerClassement } from "../classement";

const CSV = "﻿Mouvements du compte;;;;\r\nIban;LU000000000000000000;;;\r\nSolde;1 234,56;EUR;;\r\n" +
  "Date d'opération;Type de mouvement;Montant;Devise;Communication\r\n" +
  "13/11/2026;BONIFICATION;80,00;EUR;ACME, Référence: 1\r\n" +
  "12/11/2026;DOMICILIATION SEPA;-1.044,50;EUR;\"MAGASIN; SA\", Ref 2\r\n";

describe("lecture du CSV Raiffeisen", () => {
  it("lit l'IBAN, le solde et les lignes", () => {
    const f = lireCsvRaiffeisen(CSV);
    expect(f.identifiant).toBe("LU000000000000000000");
    expect(f.solde_banque).toBe(1234.56);
    expect(f.lignes).toHaveLength(2);
    expect(f.lignes[0]).toMatchObject({ date_operation: "2026-11-13", montant: 80, libelle: "ACME, Référence: 1" });
    expect(f.lignes[1]).toMatchObject({ montant: -1044.5, libelle: "MAGASIN; SA, Ref 2" });
  });
  it("refuse un autre format", () => {
    expect(() => lireCsvRaiffeisen("a;b\n1;2\n3;4\n5;6")).toThrow(ErreurImport);
  });
  it("refuse une date inexistante", () => {
    expect(() => lireCsvRaiffeisen(CSV.replace("13/11/2026", "31/09/2026"))).toThrow(/inexistante/);
  });
});

const CARTE = "\uFEFFMouvements de la carte;;;;;;;;;;;;,,,\nNumero;4940XXXXXXXX0000;;;;;;;;;;;\n" +
  "Début de période;Fin de période;Date de prélèvement;Montant total de la période;Devise;Date d'opération;Référence;Pays contrepartie;Montant en EUR;Montant d'origine;Devise d'origine;Montant commission;Devise commission\n" +
  "25/10/2026;21/11/2026;03/12/2026;-35,50;EUR;11/11/2026;PAYPAL *CLUB-LUXEMBOURG;LUXEMBOURG;-25,00;-25,00;EUR;;\n" +
  "25/10/2026;21/11/2026;03/12/2026;;;09/11/2026;\"SHOP; LONDON\";UNITED KINGDOM;-10,50;-9,00;GBP;;,,,\n";

describe("lecture du CSV carte Raiffeisen", () => {
  it("lit le numéro, la période, les lignes (virgules parasites tolérées)", () => {
    const f = lireCsvRaiffeisen(CARTE);
    expect(f.format).toBe("raiffeisen_carte");
    expect(f.identifiant).toBe("4940XXXXXXXX0000");
    expect(f.periode).toEqual({ debut: "2026-10-25", fin: "2026-11-21", prelevement: "2026-12-03", total: -35.5 });
    expect(f.lignes).toEqual([
      { date_operation: "2026-11-11", libelle: "PAYPAL *CLUB-LUXEMBOURG", montant: -25, devise: "EUR", type_mouvement: "LUXEMBOURG" },
      { date_operation: "2026-11-09", libelle: "SHOP; LONDON", montant: -10.5, devise: "EUR", type_mouvement: "UNITED KINGDOM · -9,00 GBP" },
    ]);
  });
  it("refuse une ligne avec commission (cas non prévu)", () => {
    expect(() => lireCsvRaiffeisen(CARTE.replace("-25,00;EUR;;", "-25,00;EUR;1,20;EUR"))).toThrow(/commission/);
  });
});

describe("empreinte", () => {
  it("est identique à celle calculée en Python lors de la reprise (accents compris)", () => {
    // hashlib.md5("2026-08-14|RÉFÉRENCE|-44.00".encode()).hexdigest()
    expect(empreinte("2026-08-14", "  référence ", -44)).toBe("cd3b30a8cb337aae7fc72351dc93b0f5");
  });
});

describe("repérage des opérations déjà présentes", () => {
  const op = (d: string, l: string, m: number) => ({ date_operation: d, libelle: l, montant: m });
  it("tolère un espace manquant et compte les doublons exacts", () => {
    const base = [op("2026-09-14", "BIP, ref,39", -10), op("2026-09-15", "CAFE", -2)];
    const fichier = [op("2026-09-14", "BIP, ref, 39", -10), op("2026-09-15", "CAFE", -2), op("2026-09-15", "CAFE", -2)];
    const { presentes, nouvelles } = separerNouvelles(fichier, base);
    expect(presentes).toHaveLength(2);
    expect(nouvelles).toEqual([op("2026-09-15", "CAFE", -2)]);
  });
  it("reconnaît une opération dont le libellé a été complété d'une note dans Excel", () => {
    const base = [op("2026-08-28", "La Rusticana-Luxembourg (pizza anniv)", -88.6)];
    const { presentes, nouvelles } = separerNouvelles([op("2026-08-28", "La Rusticana-LUXEMBOURG", -88.6), op("2026-08-28", "La Rusticana-LUXEMBOURG", -88.6)], base);
    expect(presentes).toHaveLength(1);
    expect(nouvelles).toHaveLength(1);
  });
});

describe("classement automatique", () => {
  const h = (libelle: string, poste_id: number, date = "2026-01-01") => ({ libelle, montant: -10, date_operation: date, poste_id });
  it("une règle passe avant l'historique et peut demander confirmation", () => {
    const proposer = preparerClassement([h("COMMUNE HESPERANGE, x", 2)], [{ motif: "hesperange", poste_id: 1, a_confirmer: true }]);
    expect(proposer("Administration communale de Hesperange, LU")).toMatchObject({ poste_id: 1, certitude: "moyenne" });
  });
  it("même tiers et même référence : propose le poste habituel", () => {
    const proposer = preparerClassement([h("CCSS, Référence: 170 2026-08-14", 5), h("CCSS, Référence: 160 2026-08-14", 6)]);
    expect(proposer("CCSS, Référence: 170 2026-10-16, autre").poste_id).toBe(5);
    expect(proposer("CCSS, Référence: 160 2026-10-16, autre").poste_id).toBe(6);
  });
  it("règle sans poste : ne jamais deviner, même si l'historique connaît le tiers", () => {
    const proposer = preparerClassement([h("AMZN Mktp DE*1", 2), h("AMZN Mktp DE*2", 2)], [{ motif: "AMZN", poste_id: null, a_confirmer: true }]);
    expect(proposer("AMZN Mktp DE*NU9OS5F04-LUXEMBOURG")).toMatchObject({ poste_id: null, certitude: "aucune" });
  });
  it("tiers inconnu : à classer", () => {
    expect(preparerClassement([h("CCSS, x", 5)])("ZZZ INCONNU, 1")).toMatchObject({ poste_id: null, certitude: "aucune" });
  });
});

describe("motifPropose", () => {
  it("prend le début du libellé sans les chiffres finaux", async () => {
    const { motifPropose } = await import("../classement");
    expect(motifPropose("INTERETS DEBITEURS: 0,03 EUR 10,7500% 15/06/2026")).toBe("INTERETS DEBITEURS");
    expect(motifPropose("GIRAUD-ALEDO MARC/SANDRINE, 15, RUE HENRI")).toBe("GIRAUD-ALEDO MARC/SANDRINE");
    expect(motifPropose("AMAZON")).toBe("AMAZON");
    expect(motifPropose("123")).toBe("123");
  });
});

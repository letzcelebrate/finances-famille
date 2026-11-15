import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDate, formatMontant } from "../lib/format";

type Solde = {
  compte_id: number;
  banque: string;
  nom: string;
  type_compte: string;
  devise: string;
  ouvert: boolean;
  solde: number;
  derniere_operation: string | null;
};

const GROUPES: { titre: string; types: string[] }[] = [
  { titre: "Comptes courants", types: ["Courant", "Cash"] },
  { titre: "Cartes bancaires", types: ["Carte Bancaire"] },
  { titre: "Épargne", types: ["Epargne", "Titres"] },
  { titre: "Retraite", types: ["Retraite"] },
];

export default function Synthese({ onChoisirCompte }: { onChoisirCompte: (id: number) => void }) {
  const [soldes, setSoldes] = useState<Solde[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("v_soldes_comptes")
      .select("compte_id, banque, nom, type_compte, devise, ouvert, solde, derniere_operation")
      .eq("ouvert", true)
      .order("banque")
      .order("nom")
      .then(({ data, error }) => {
        if (error) setErreur(error.message);
        else setSoldes((data ?? []).map((s) => ({ ...s, solde: Number(s.solde) })));
      });
  }, []);

  if (erreur) return <p className="alerte">Erreur : {erreur}</p>;
  if (!soldes) return <p>Chargement…</p>;

  const total = soldes.reduce((t, s) => t + s.solde, 0);

  return (
    <section>
      <div className="carte total">
        <span>Patrimoine total (comptes ouverts)</span>
        <strong>{formatMontant(total)}</strong>
      </div>
      {GROUPES.map((g) => {
        const lignes = soldes.filter((s) => g.types.includes(s.type_compte));
        if (lignes.length === 0) return null;
        const sousTotal = lignes.reduce((t, s) => t + s.solde, 0);
        return (
          <div key={g.titre} className="carte">
            <div className="groupe-titre">
              <h2>{g.titre}</h2>
              <strong className={sousTotal < 0 ? "negatif" : ""}>{formatMontant(sousTotal)}</strong>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Banque</th>
                  <th>Compte</th>
                  <th className="droite">Solde</th>
                  <th className="masquer-mobile">Dernière opération</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((s) => (
                  <tr key={s.compte_id} className="cliquable" onClick={() => onChoisirCompte(s.compte_id)}>
                    <td>{s.banque}</td>
                    <td>{s.nom}</td>
                    <td className={`droite ${s.solde < 0 ? "negatif" : ""}`}>{formatMontant(s.solde, s.devise)}</td>
                    <td className="masquer-mobile">{formatDate(s.derniere_operation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDate, formatMontant } from "../lib/format";
import { construireSynthese, type Solde } from "../lib/synthese";

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

  const { blocs, total, disponible } = construireSynthese(soldes);

  return (
    <section>
      <div className="carte total">
        <span>Patrimoine total (comptes ouverts)</span>
        <strong>{formatMontant(total)}</strong>
        <span className="sous-total-patrimoine">
          Patrimoine disponible (hors retraite) : <strong>{formatMontant(disponible)}</strong>
        </span>
      </div>
      {blocs.map((g) => {
        const lignes = g.comptes;
        const sousTotal = g.total;
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

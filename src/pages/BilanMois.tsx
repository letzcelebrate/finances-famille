import { Fragment, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { moisPourMoyenne, moyenneMensuelle, organiserBilan, type Bilan, type BlocCategorie, type LigneBilanBrute, type Montants } from "../lib/bilan";

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const nombre = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Cellule({ valeur }: { valeur: number }) {
  if (valeur === 0) return <td className="droite nowrap vide">–</td>;
  return <td className={`droite nowrap ${valeur < 0 ? "negatif" : ""}`}>{nombre.format(valeur)}</td>;
}

function Ligne({ nom, montants, nbMois, classe }: { nom: string; montants: Montants; nbMois: number; classe?: string }) {
  return (
    <tr className={classe}>
      <th scope="row" className="col-poste">{nom}</th>
      {montants.mois.map((v, i) => (
        <Cellule key={i} valeur={v} />
      ))}
      <Cellule valeur={montants.total} />
      <Cellule valeur={moyenneMensuelle(montants, nbMois)} />
    </tr>
  );
}

function Categorie({ bloc, nbMois, details }: { bloc: BlocCategorie; nbMois: number; details: boolean }) {
  return (
    <Fragment>
      {details &&
        bloc.postes.map((p) => <Ligne key={p.nom} nom={p.nom} montants={p.montants} nbMois={nbMois} classe="poste" />)}
      <Ligne nom={details ? `Total ${bloc.nom}` : bloc.nom} montants={bloc.sousTotal} nbMois={nbMois} classe="sous-total" />
    </Fragment>
  );
}

export default function BilanMois() {
  const [annees, setAnnees] = useState<number[] | null>(null);
  const [annee, setAnnee] = useState<number | null>(null);
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [details, setDetails] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("annees_bilan").then(({ data, error }) => {
      if (error) return setErreur(error.message);
      const liste = ((data ?? []) as unknown[]).map(Number);
      setAnnees(liste);
      if (liste.length) setAnnee(liste[0]);
    });
  }, []);

  useEffect(() => {
    if (annee === null) return;
    let annule = false;
    setBilan(null);
    supabase.rpc("bilan_par_mois", { p_annee: annee }).then(({ data, error }) => {
      if (annule) return;
      if (error) setErreur(error.message);
      else setBilan(organiserBilan((data ?? []) as LigneBilanBrute[]));
    });
    return () => {
      annule = true;
    };
  }, [annee]);

  if (erreur) return <p className="alerte">Erreur : {erreur}</p>;
  if (annees === null) return <p>Chargement…</p>;
  if (annee === null) return <p>Aucune opération.</p>;

  const nbMois = moisPourMoyenne(annee);

  return (
    <section>
      <div className="carte barre-bilan">
        <label>
          Année
          <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {annees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="case">
          <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
          Afficher le détail des postes
        </label>
        <span className="sous">
          Mois de rattachement ·{" "}
          {nbMois === 12
            ? "moyenne sur 12 mois"
            : nbMois === 0
              ? "moyenne disponible à la fin du premier mois"
              : `moyenne sur ${nbMois} mois terminé${nbMois > 1 ? "s" : ""} (mois en cours non compté)`}
        </span>
      </div>

      {!bilan ? (
        <p>Chargement…</p>
      ) : (
        <div className="carte tableau-bilan">
          <table>
            <thead>
              <tr>
                <th className="col-poste">Poste</th>
                {MOIS_COURTS.map((m) => (
                  <th key={m} className="droite">
                    {m}
                  </th>
                ))}
                <th className="droite">Total</th>
                <th className="droite">Moyenne / mois</th>
              </tr>
            </thead>
            {bilan.categories.map((c) => (
              <tbody key={c.nom}>
                {details && (
                  <tr className="titre-categorie">
                    <th scope="rowgroup" colSpan={15} className="col-poste">
                      {c.nom}
                    </th>
                  </tr>
                )}
                <Categorie bloc={c} nbMois={nbMois} details={details} />
              </tbody>
            ))}
            <tbody>
              <Ligne nom="Résultat (ressources − dépenses)" montants={bilan.resultat} nbMois={nbMois} classe="resultat" />
            </tbody>
            {bilan.neutres && (
              <tbody>
                <tr className="titre-categorie">
                  <th scope="rowgroup" colSpan={15} className="col-poste">
                    Neutres (virements entre comptes, hors résultat)
                  </th>
                </tr>
                <Categorie bloc={bilan.neutres} nbMois={nbMois} details={details} />
              </tbody>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

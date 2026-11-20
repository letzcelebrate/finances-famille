import { Fragment, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { moisPourMoyenne, moyenneMensuelle, organiserBilan, type Bilan, type BlocCategorie, type LigneBilanBrute, type Montants } from "../lib/bilan";

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const nombre = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Cellule({ valeur }: { valeur: number }) {
  if (valeur === 0) return <td className="droite nowrap vide">–</td>;
  return <td className={`droite nowrap ${valeur < 0 ? "negatif" : ""}`}>{nombre.format(valeur)}</td>;
}

function Ligne({ nom, montants, nbMois, classe, bouton }: {
  nom: string;
  montants: Montants;
  nbMois: number;
  classe?: string;
  bouton?: ReactNode;
}) {
  return (
    <tr className={classe}>
      <th scope="row" className="col-poste">
        {bouton}
        {nom}
      </th>
      {montants.mois.map((v, i) => (
        <Cellule key={i} valeur={v} />
      ))}
      <Cellule valeur={montants.total} />
      <Cellule valeur={moyenneMensuelle(montants, nbMois)} />
    </tr>
  );
}

/** Une catégorie : sa ligne de total, avec un + pour afficher ses postes juste en dessous. */
function Categorie({ bloc, nbMois, ouverte, onBasculer }: {
  bloc: BlocCategorie;
  nbMois: number;
  ouverte: boolean;
  onBasculer: () => void;
}) {
  const bouton = (
    <button type="button" className="plus-moins" aria-expanded={ouverte}
      title={ouverte ? `Masquer le détail de ${bloc.nom}` : `Voir le détail de ${bloc.nom}`} onClick={onBasculer}>
      {ouverte ? "−" : "+"}
    </button>
  );
  return (
    <Fragment>
      <Ligne nom={bloc.nom} montants={bloc.sousTotal} nbMois={nbMois} classe={`categorie ${ouverte ? "ouverte" : ""}`} bouton={bouton} />
      {ouverte &&
        bloc.postes.map((p) => <Ligne key={p.nom} nom={p.nom} montants={p.montants} nbMois={nbMois} classe="poste" />)}
    </Fragment>
  );
}

export default function BilanMois() {
  const [annees, setAnnees] = useState<number[] | null>(null);
  const [annee, setAnnee] = useState<number | null>(null);
  const [bilan, setBilan] = useState<Bilan | null>(null);
  // Catégories dont le détail des postes est affiché (aucune au départ)
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
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
  const toutes = bilan ? [...bilan.categories, ...(bilan.neutres ? [bilan.neutres] : [])].map((c) => c.nom) : [];
  const toutOuvert = toutes.length > 0 && toutes.every((n) => ouvertes.has(n));
  const basculer = (nom: string) =>
    setOuvertes((o) => {
      const s = new Set(o);
      if (s.has(nom)) s.delete(nom);
      else s.add(nom);
      return s;
    });

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
          <input type="checkbox" checked={toutOuvert} onChange={(e) => setOuvertes(new Set(e.target.checked ? toutes : []))} />
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
                <Categorie bloc={c} nbMois={nbMois} ouverte={ouvertes.has(c.nom)} onBasculer={() => basculer(c.nom)} />
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
                <Categorie bloc={bilan.neutres} nbMois={nbMois} ouverte={ouvertes.has(bilan.neutres.nom)}
                  onBasculer={() => basculer(bilan.neutres!.nom)} />
              </tbody>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDate, formatMontant, formatMois } from "../lib/format";

type Compte = { id: number; banque: string; nom: string; ouvert: boolean };
type Operation = {
  id: number;
  date_operation: string;
  libelle: string;
  montant: number;
  devise: string;
  titulaire: string;
  banque: string;
  compte_nom: string;
  poste_nom: string | null;
  categorie_nom: string | null;
};

const PAR_PAGE = 100;

export default function Operations({ compteInitial }: { compteInitial: number | null }) {
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [compte, setCompte] = useState<number | "">(compteInitial ?? "");
  const [mois, setMois] = useState("");
  const [recherche, setRecherche] = useState("");
  const [page, setPage] = useState(0);
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [nombre, setNombre] = useState(0);
  const [totalPeriode, setTotalPeriode] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("comptes")
      .select("id, banque, nom, ouvert")
      .order("ouvert", { ascending: false })
      .order("banque")
      .order("nom")
      .then(({ data }) => setComptes(data ?? []));
  }, []);

  useEffect(() => setPage(0), [compte, mois, recherche]);

  useEffect(() => {
    let annule = false;
    async function charger() {
      setOperations(null);
      let q = supabase
        .from("v_operations")
        .select("id, date_operation, libelle, montant, devise, titulaire, banque, compte_nom, poste_nom, categorie_nom", {
          count: "exact",
        });
      if (compte !== "") q = q.eq("compte_id", compte);
      if (mois) q = q.eq("mois_rattachement", `${mois}-01`);
      if (recherche.trim()) q = q.ilike("libelle", `%${recherche.trim()}%`);
      const { data, count, error } = await q
        .order("date_operation", { ascending: false })
        .order("id", { ascending: false })
        .range(page * PAR_PAGE, page * PAR_PAGE + PAR_PAGE - 1);
      if (annule) return;
      if (error) {
        setErreur(error.message);
        return;
      }
      setErreur(null);
      setOperations((data ?? []).map((o) => ({ ...o, montant: Number(o.montant) })));
      setNombre(count ?? 0);

      // Total de la sélection, seulement quand elle est petite (un mois ou une recherche)
      if ((mois || recherche.trim()) && (count ?? 0) <= 1000) {
        let t = supabase.from("v_operations").select("montant");
        if (compte !== "") t = t.eq("compte_id", compte);
        if (mois) t = t.eq("mois_rattachement", `${mois}-01`);
        if (recherche.trim()) t = t.ilike("libelle", `%${recherche.trim()}%`);
        const { data: lignes } = await t.limit(1000);
        if (!annule) setTotalPeriode((lignes ?? []).reduce((s, l) => s + Number(l.montant), 0));
      } else if (!annule) {
        setTotalPeriode(null);
      }
    }
    charger();
    return () => {
      annule = true;
    };
  }, [compte, mois, recherche, page]);

  const pages = Math.max(1, Math.ceil(nombre / PAR_PAGE));

  return (
    <section>
      <div className="carte filtres">
        <label>
          Compte
          <select value={compte} onChange={(e) => setCompte(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">Tous les comptes</option>
            <optgroup label="Comptes ouverts">
              {comptes.filter((c) => c.ouvert).map((c) => (
                <option key={c.id} value={c.id}>{c.banque} — {c.nom}</option>
              ))}
            </optgroup>
            <optgroup label="Comptes fermés">
              {comptes.filter((c) => !c.ouvert).map((c) => (
                <option key={c.id} value={c.id}>{c.banque} — {c.nom}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Mois
          <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} />
        </label>
        <label>
          Recherche
          <input type="search" placeholder="Libellé…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
      </div>

      <div className="resume">
        <span>
          {nombre.toLocaleString("fr-FR")} opération{nombre > 1 ? "s" : ""}
          {mois && ` — ${formatMois(mois)}`}
        </span>
        {totalPeriode !== null && (
          <strong className={totalPeriode < 0 ? "negatif" : ""}>Total : {formatMontant(totalPeriode)}</strong>
        )}
      </div>

      {erreur && <p className="alerte">Erreur : {erreur}</p>}
      {!operations && !erreur && <p>Chargement…</p>}
      {operations && (
        <div className="carte">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th className="masquer-mobile">Compte</th>
                <th>Poste</th>
                <th className="droite">Montant</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((o) => (
                <tr key={o.id}>
                  <td className="nowrap">{formatDate(o.date_operation)}</td>
                  <td className="libelle">{o.libelle}</td>
                  <td className="masquer-mobile">{o.banque} — {o.compte_nom}</td>
                  <td>
                    {o.poste_nom ?? <em>à classer</em>}
                    {o.categorie_nom && <div className="sous">{o.categorie_nom}</div>}
                  </td>
                  <td className={`droite nowrap ${o.montant < 0 ? "negatif" : "positif"}`}>
                    {formatMontant(o.montant, o.devise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="pagination">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Précédent</button>
              <span>Page {page + 1} / {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Suivant ›</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

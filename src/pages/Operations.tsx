import { Fragment, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDate, formatMontant } from "../lib/format";
import { diviserOperation, modifierOperation, operationsDuTiers, reclasser } from "../lib/import/donnees";
import { EditeurDivision, partsInitiales, partsValides, SelectPoste, usePostes, type GroupesPostes, type Part } from "../components/Classement";
import { appliquerFiltres, colonnesActives, FILTRES_VIDES, raccourcisDates, type Filtres, type Sens } from "../lib/filtresOperations";
import { EnTeteFiltre, FiltreComptes, FiltreDate, FiltreMontant, FiltrePostes, FiltreTexte } from "../components/FiltresColonnes";
import { useEstMobile } from "../lib/mobile";
import { celluleBrute, celluleTexte } from "../lib/csv";

type Compte = { id: number; banque: string; nom: string; ouvert: boolean };
type Ventil = { id: number; poste_id: number; poste_nom: string; montant: number; note: string | null };
type Operation = {
  id: number;
  date_operation: string;
  libelle: string;
  note: string | null;
  montant: number;
  devise: string;
  banque: string;
  compte_nom: string;
  poste_id: number | null;
  poste_nom: string | null;
  categorie_nom: string | null;
  ventilations: Ventil[];
};

const PAR_PAGE = 100;
/** Au-delà, le total de la sélection n'est pas calculé (trop de lignes à additionner). */
const MAX_TOTAL = 5000;

/** « 2026-07-01 » → « juillet 2026 » */
const nomMois = (iso: string) =>
  new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const COLONNES = "id, date_operation, libelle, note, montant, devise, banque, compte_nom, poste_id, poste_nom, categorie_nom, ventilations";

export default function Operations({ filtresInitiaux }: { filtresInitiaux: Filtres | null }) {
  const [comptes, setComptes] = useState<Compte[]>([]);
  const { groupes } = usePostes();
  const [filtres, setFiltres] = useState<Filtres>(filtresInitiaux ?? FILTRES_VIDES);
  const changerFiltres = (f: Partial<Filtres>) => setFiltres((ancien) => ({ ...ancien, ...f }));
  const actives = colonnesActives(filtres);
  const [page, setPage] = useState(0);
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [nombre, setNombre] = useState(0);
  const [totalPeriode, setTotalPeriode] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const estMobile = useEstMobile();
  const [recherche, setRecherche] = useState(filtres.texte);
  const [exportEnCours, setExportEnCours] = useState(false);

  useEffect(() => {
    supabase
      .from("comptes")
      .select("id, banque, nom, ouvert")
      .order("ouvert", { ascending: false })
      .order("banque")
      .order("nom")
      .then(({ data }) => setComptes(data ?? []));
  }, []);

  useEffect(() => setPage(0), [filtres]);

  useEffect(() => {
    let annule = false;
    async function charger() {
      // Opérations divisées dont une part est dans un des postes retenus
      let divisees: number[] = [];
      if (filtres.postes !== null && filtres.postes.length > 0) {
        const { data, error } = await supabase.from("ventilations").select("operation_id").in("poste_id", filtres.postes);
        if (annule) return;
        if (error) return setErreur(error.message);
        divisees = [...new Set((data ?? []).map((v: any) => Number(v.operation_id)))];
      }
      const filtrer = <T,>(q: T): T => appliquerFiltres(q as any, filtres, divisees) as T;

      const { data, count, error } = await filtrer(supabase.from("v_operations").select(COLONNES, { count: "exact" }))
        .order("date_operation", { ascending: false })
        .order("id", { ascending: false })
        .range(page * PAR_PAGE, page * PAR_PAGE + PAR_PAGE - 1);
      if (annule) return;
      if (error) {
        setErreur(error.message);
        return;
      }
      setErreur(null);
      setOperations((data ?? []).map((o: any) => ({ ...o, montant: Number(o.montant) })));
      const n = count ?? 0;
      setNombre(n);

      // Total de la sélection (dès qu'un filtre est posé), par paquets de 1 000 lignes
      if (colonnesActives(filtres).size > 0 && n <= MAX_TOTAL) {
        const paquets = await Promise.all(
          Array.from({ length: Math.ceil(n / 1000) }, (_, i) =>
            filtrer(supabase.from("v_operations").select("montant"))
              .order("id")
              .range(i * 1000, i * 1000 + 999),
          ),
        );
        if (annule) return;
        if (paquets.some((r: any) => r.error)) setTotalPeriode(null);
        else {
          const centimes = paquets.flatMap((r: any) => r.data ?? []).reduce((t: number, l: any) => t + Math.round(Number(l.montant) * 100), 0);
          setTotalPeriode(centimes / 100);
        }
      } else if (!annule) {
        setTotalPeriode(null);
      }
    }
    charger();
    return () => {
      annule = true;
    };
  }, [filtres, page, version]);

  // Recherche rapide (sous les en-têtes) : synchronisée avec le filtre texte, avec un léger délai.
  useEffect(() => setRecherche(filtres.texte), [filtres.texte]);
  useEffect(() => {
    if (recherche === filtres.texte) return;
    const t = setTimeout(() => changerFiltres({ texte: recherche }), 300);
    return () => clearTimeout(t);
  }, [recherche]);

  async function exporter() {
    setExportEnCours(true);
    setErreur(null);
    try {
      let divisees: number[] = [];
      if (filtres.postes !== null && filtres.postes.length > 0) {
        const { data, error } = await supabase.from("ventilations").select("operation_id").in("poste_id", filtres.postes);
        if (error) throw new Error(error.message);
        divisees = [...new Set((data ?? []).map((v: any) => Number(v.operation_id)))];
      }
      const filtrer = <T,>(q: T): T => appliquerFiltres(q as any, filtres, divisees) as T;
      const lignes: any[] = [];
      for (let debut = 0; ; debut += 1000) {
        const { data, error } = await filtrer(
          supabase.from("v_operations").select("date_operation, libelle, note, banque, compte_nom, poste_nom, categorie_nom, montant, devise"),
        ).order("date_operation", { ascending: false }).order("id", { ascending: false }).range(debut, debut + 999);
        if (error) throw new Error(error.message);
        lignes.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const entete = ["Date", "Libellé", "Note", "Compte", "Poste", "Catégorie", "Montant", "Devise"];
      const corps = lignes.map((o) => [
        celluleBrute(o.date_operation),
        ...[o.libelle, o.note ?? "", `${o.banque} — ${o.compte_nom}`, o.poste_nom ?? "", o.categorie_nom ?? ""].map(celluleTexte),
        celluleBrute(Number(o.montant).toFixed(2).replace(".", ",")),
        celluleTexte(o.devise),
      ].join(";"));
      const csv = "﻿" + [entete.join(";"), ...corps].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `operations-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErreur(`L'export a échoué. (${(e as Error).message})`);
    } finally {
      setExportEnCours(false);
    }
  }

  const pages = Math.max(1, Math.ceil(nombre / PAR_PAGE));

  // Filtres rapides sous les en-têtes : valeur courante reflétée dans chaque contrôle.
  const compteRapide = filtres.comptes === null ? "" : filtres.comptes.length === 1 ? String(filtres.comptes[0]) : "multi";
  const posteRapide = filtres.postes === null ? "" : filtres.postes.length === 1 ? String(filtres.postes[0]) : "multi";
  const dateRapide = (raccourcisDates().find(([, d, a]) => d === filtres.du && a === filtres.au) ?? [""])[0];
  const appliquerDateRapide = (nom: string) => {
    const r = raccourcisDates().find(([n]) => n === nom);
    changerFiltres(r ? { du: r[1], au: r[2] } : { du: "", au: "" });
  };

  // Version app (téléphone) : recherche seule, résultats en liste de cartes.
  if (estMobile) {
    const recherche = filtres.texte.trim();
    return (
      <section>
        <div className="carte recherche-mobile">
          <input type="search" inputMode="search" placeholder="Rechercher une opération…"
            value={filtres.texte} onChange={(e) => changerFiltres({ texte: e.target.value })} />
        </div>
        {erreur && <p className="alerte">Erreur : {erreur}</p>}
        {recherche === "" ? (
          <p className="indice-recherche">Tape un mot (commerçant, libellé, note…) pour retrouver une opération.</p>
        ) : !operations ? (
          <p className="indice-recherche">Recherche…</p>
        ) : operations.length === 0 ? (
          <p className="indice-recherche">Aucune opération trouvée.</p>
        ) : (
          <div className="liste-ops-mobile">
            {operations.map((o) => (
              <Fragment key={o.id}>
                <button type="button" className={`op-carte ${ouverte === o.id ? "ouverte" : ""}`}
                  onClick={() => setOuverte(ouverte === o.id ? null : o.id)}>
                  <span className="op-haut">
                    <span className="op-lib">{o.libelle}</span>
                    <span className={`op-montant ${o.montant < 0 ? "negatif" : "positif"}`}>{formatMontant(o.montant, o.devise)}</span>
                  </span>
                  <span className="op-bas sous">
                    {formatDate(o.date_operation)} · {o.ventilations.length > 0 ? "Divisée" : (o.poste_nom ?? "à classer")}
                  </span>
                </button>
                {ouverte === o.id && (
                  <div className="carte">
                    <EditeurOperation op={o} groupes={groupes}
                      onFini={() => { setOuverte(null); setVersion((v) => v + 1); }} />
                  </div>
                )}
              </Fragment>
            ))}
            {nombre > operations.length && (
              <p className="indice-recherche">{nombre.toLocaleString("fr-FR")} résultats — précise ta recherche pour en voir moins.</p>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section>
      <div className="resume">
        <span>
          {nombre.toLocaleString("fr-FR")} opération{nombre > 1 ? "s" : ""}
          {filtres.mois && (
            <>
              {" "}· <span className="sous">rattachées à {nomMois(filtres.mois)}</span>{" "}
              <button className="lien petit" title="Retirer ce filtre" onClick={() => changerFiltres({ mois: "" })}>✕</button>
            </>
          )}
          {actives.size > 0 && (
            <>
              {" "}· <button className="lien petit" onClick={() => setFiltres(FILTRES_VIDES)}>Effacer tous les filtres</button>
            </>
          )}{" "}
          {" "}· <button className="lien petit" onClick={exporter} disabled={exportEnCours || nombre === 0}>
            {exportEnCours ? "Export…" : "⤓ Exporter (CSV)"}
          </button>
          · <span className="sous">clique sur une opération pour la modifier</span>
        </span>
        {totalPeriode !== null && (
          <strong className={totalPeriode < 0 ? "negatif" : ""}>Total : {formatMontant(totalPeriode)}</strong>
        )}
        {totalPeriode === null && actives.size > 0 && nombre > MAX_TOTAL && (
          <span className="sous">Total affiché à partir de {MAX_TOTAL.toLocaleString("fr-FR")} opérations ou moins</span>
        )}
      </div>

      {erreur && <p className="alerte">Erreur : {erreur}</p>}
      {!operations && !erreur && <p>Chargement…</p>}
      {operations && (
        <div className="carte tableau-operations">
          <table>
            <thead>
              <tr>
                <EnTeteFiltre titre="Date" actif={actives.has("date")}>
                  {(fermer) => <FiltreDate filtres={filtres} onChange={changerFiltres} fermer={fermer} />}
                </EnTeteFiltre>
                <EnTeteFiltre titre="Libellé" actif={actives.has("libelle")}>
                  {(fermer) => <FiltreTexte filtres={filtres} onChange={changerFiltres} fermer={fermer} />}
                </EnTeteFiltre>
                <EnTeteFiltre titre="Compte" actif={actives.has("compte")} className="masquer-mobile">
                  {(fermer) => <FiltreComptes filtres={filtres} onChange={changerFiltres} fermer={fermer} comptes={comptes} />}
                </EnTeteFiltre>
                <EnTeteFiltre titre="Poste" actif={actives.has("poste")} aDroite>
                  {(fermer) => <FiltrePostes filtres={filtres} onChange={changerFiltres} fermer={fermer} groupes={groupes} />}
                </EnTeteFiltre>
                <EnTeteFiltre titre="Montant" actif={actives.has("montant")} className="droite" aDroite>
                  {(fermer) => <FiltreMontant filtres={filtres} onChange={changerFiltres} fermer={fermer} />}
                </EnTeteFiltre>
              </tr>
              <tr className="filtre-rapide">
                <th>
                  <select value={dateRapide} aria-label="Filtre date rapide" onChange={(e) => appliquerDateRapide(e.target.value)}>
                    <option value="">Toutes dates</option>
                    {raccourcisDates().map(([nom]) => <option key={nom} value={nom}>{nom}</option>)}
                  </select>
                </th>
                <th>
                  <input type="search" value={recherche} placeholder="Rechercher…" onChange={(e) => setRecherche(e.target.value)} />
                </th>
                <th className="masquer-mobile">
                  <select value={compteRapide} aria-label="Filtre compte rapide"
                    onChange={(e) => changerFiltres({ comptes: e.target.value === "" ? null : [Number(e.target.value)] })}>
                    <option value="">Tous comptes</option>
                    {filtres.comptes && filtres.comptes.length > 1 && <option value="multi" disabled>(plusieurs)</option>}
                    {comptes.filter((c) => c.ouvert).map((c) => <option key={c.id} value={c.id}>{c.banque} — {c.nom}</option>)}
                  </select>
                </th>
                <th>
                  <select value={posteRapide} aria-label="Filtre poste rapide"
                    onChange={(e) => changerFiltres(e.target.value === "" ? { postes: null, aClasser: true } : { postes: [Number(e.target.value)], aClasser: false })}>
                    <option value="">Tous postes</option>
                    {filtres.postes && filtres.postes.length > 1 && <option value="multi" disabled>(plusieurs)</option>}
                    {groupes.map(([cat, ps]) => (
                      <optgroup key={cat} label={cat}>
                        {ps.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </th>
                <th className="droite">
                  <select value={filtres.sens} aria-label="Filtre montant rapide" onChange={(e) => changerFiltres({ sens: e.target.value as Sens })}>
                    <option value="tous">Tout</option>
                    <option value="depenses">Dépenses</option>
                    <option value="entrees">Entrées</option>
                  </select>
                </th>
              </tr>
            </thead>
            <tbody>
              {operations.map((o) => (
                <Fragment key={o.id}>
                  <tr className={`cliquable ${ouverte === o.id ? "ouverte" : ""}`} onClick={() => setOuverte(ouverte === o.id ? null : o.id)}>
                    <td className="nowrap">{formatDate(o.date_operation)}</td>
                    <td className="libelle">
                      {o.libelle}
                      {o.note && <div className="note-affichee">📝 {o.note}</div>}
                    </td>
                    <td className="masquer-mobile">{o.banque} — {o.compte_nom}</td>
                    <td>
                      {o.ventilations.length > 0 ? (
                        <>
                          <span className="sous">Divisée :</span>
                          {o.ventilations.map((v) => (
                            <div key={v.id} className="part-affichee">{v.poste_nom} <span className="sous">{formatMontant(v.montant)}</span></div>
                          ))}
                        </>
                      ) : (
                        <>
                          {o.poste_nom ?? <em className="negatif">à classer</em>}
                          {o.categorie_nom && <div className="sous">{o.categorie_nom}</div>}
                        </>
                      )}
                    </td>
                    <td className={`droite nowrap ${o.montant < 0 ? "negatif" : "positif"}`}>
                      {formatMontant(o.montant, o.devise)}
                    </td>
                  </tr>
                  {ouverte === o.id && (
                    <tr className="edition">
                      <td colSpan={5}>
                        <EditeurOperation op={o} groupes={groupes}
                          onFini={() => {
                            setOuverte(null);
                            setVersion((v) => v + 1);
                          }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
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

function EditeurOperation({ op, groupes, onFini }: { op: Operation; groupes: GroupesPostes; onFini: () => void }) {
  const [posteId, setPosteId] = useState<number | null>(op.poste_id);
  const [note, setNote] = useState(op.note ?? "");
  const [parts, setParts] = useState<Part[] | null>(
    op.ventilations.length > 0
      ? op.ventilations.map((v) => ({ poste_id: v.poste_id, montant: Math.abs(Number(v.montant)).toFixed(2).replace(".", ","), note: v.note ?? "" }))
      : null,
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // correction de tout un tiers
  const [tiers, setTiers] = useState<{ motif: string; ids: number[] | null } | null>(null);

  const division = parts ? partsValides(parts, op.montant) : null;
  const valide = parts ? division !== null : true;

  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    try {
      if (parts) await diviserOperation(op.id, division!, note);
      else await modifierOperation(op.id, posteId, note);
      onFini();
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  }

  async function chercherTiers(motif: string) {
    setTiers({ motif, ids: null });
    try {
      const ops = await operationsDuTiers(motif);
      setTiers({ motif, ids: ops.filter((o) => o.poste_id !== posteId).map((o) => o.id) });
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function appliquerTiers() {
    if (!tiers?.ids || posteId === null) return;
    setEnvoi(true);
    try {
      await reclasser(tiers.ids, posteId);
      if (note !== (op.note ?? "")) await modifierOperation(op.id, posteId, note);
      onFini();
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  }

  return (
    <div className="editeur" onClick={(e) => e.stopPropagation()}>
      <label>
        Note
        <input placeholder="Ex. fête d'anniversaire de Max" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {parts ? (
        <div>
          <div className="sous">Division de {formatMontant(op.montant)} :</div>
          <EditeurDivision parts={parts} montant={op.montant} groupes={groupes} onChange={setParts} />
          <button className="lien petit" onClick={() => setParts(null)}>annuler la division</button>
        </div>
      ) : (
        <label>
          Poste
          <div className="ligne-poste">
            <SelectPoste valeur={posteId} groupes={groupes} manquant={posteId === null} onChange={setPosteId} />
            <button className="lien petit" onClick={() => setParts(partsInitiales(posteId, op.montant))}>diviser en plusieurs postes</button>
          </div>
        </label>
      )}

      {!parts && posteId !== null && posteId !== op.poste_id && (
        <div className="tiers">
          {!tiers ? (
            <button className="lien petit" onClick={() => chercherTiers(op.libelle.split(/[,(]/)[0].trim())}>
              Appliquer aussi ce poste aux autres opérations de ce tiers…
            </button>
          ) : (
            <>
              <label>
                Libellé commençant par
                <input value={tiers.motif} onChange={(e) => setTiers({ motif: e.target.value, ids: null })} />
              </label>
              <button className="lien petit" onClick={() => chercherTiers(tiers.motif)}>rechercher</button>
              {tiers.ids === null ? <span className="sous"> …</span> : (
                <p>
                  {tiers.ids.length} opération(s) non divisée(s) seront reclassées dans ce poste.{" "}
                  <button className="principal" disabled={envoi || tiers.ids.length === 0} onClick={appliquerTiers}>
                    Confirmer pour les {tiers.ids.length}
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {erreur && <p className="alerte">{erreur}</p>}
      <p className="actions">
        <button className="principal" disabled={envoi || !valide} onClick={enregistrer}>Enregistrer</button>
        <button className="lien" onClick={onFini}>Fermer</button>
      </p>
    </div>
  );
}

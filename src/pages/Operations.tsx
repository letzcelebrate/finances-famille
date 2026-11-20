import { Fragment, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDate, formatMontant } from "../lib/format";
import { diviserOperation, modifierOperation, operationsDuTiers, reclasser } from "../lib/import/donnees";
import { EditeurDivision, partsInitiales, partsValides, SelectPoste, usePostes, type GroupesPostes, type Part } from "../components/Classement";
import { appliquerFiltres, colonnesActives, FILTRES_VIDES, type Filtres } from "../lib/filtresOperations";
import { EnTeteFiltre, FiltreComptes, FiltreDate, FiltreMontant, FiltrePostes, FiltreTexte } from "../components/FiltresColonnes";

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
const COLONNES = "id, date_operation, libelle, note, montant, devise, banque, compte_nom, poste_id, poste_nom, categorie_nom, ventilations";

export default function Operations({ compteInitial }: { compteInitial: number | null }) {
  const [comptes, setComptes] = useState<Compte[]>([]);
  const { groupes } = usePostes();
  const [filtres, setFiltres] = useState<Filtres>(
    compteInitial !== null ? { ...FILTRES_VIDES, comptes: [compteInitial] } : FILTRES_VIDES,
  );
  const changerFiltres = (f: Partial<Filtres>) => setFiltres((ancien) => ({ ...ancien, ...f }));
  const actives = colonnesActives(filtres);
  const [page, setPage] = useState(0);
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [nombre, setNombre] = useState(0);
  const [totalPeriode, setTotalPeriode] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

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

  const pages = Math.max(1, Math.ceil(nombre / PAR_PAGE));

  return (
    <section>
      <div className="resume">
        <span>
          {nombre.toLocaleString("fr-FR")} opération{nombre > 1 ? "s" : ""}
          {actives.size > 0 && (
            <>
              {" "}· <button className="lien petit" onClick={() => setFiltres(FILTRES_VIDES)}>Effacer tous les filtres</button>
            </>
          )}{" "}
          · <span className="sous">clique sur une opération pour la modifier · filtre avec les ▾ des titres</span>
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

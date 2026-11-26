import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { useEstMobile } from "./lib/mobile";
import Connexion from "./pages/Connexion";
import Synthese from "./pages/Synthese";
import Operations from "./pages/Operations";
import { FILTRES_VIDES, type Filtres } from "./lib/filtresOperations";
import Import from "./pages/Import";
import BilanMois from "./pages/BilanMois";
import Previsionnel from "./pages/Previsionnel";
import SoldesAnnuels from "./pages/SoldesAnnuels";

type Onglet = "synthese" | "operations" | "bilan-mois" | "previsionnel" | "soldes" | "import";

const svg = (enfants: ReactNode) => (
  <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {enfants}
  </svg>
);

const ICONES: Record<Onglet, ReactNode> = {
  synthese: svg(<><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 3v9h9a9 9 0 0 0-9-9z" /></>),
  previsionnel: svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></>),
  soldes: svg(<><line x1="5" y1="20" x2="5" y2="12" /><line x1="12" y1="20" x2="12" y2="5" /><line x1="19" y1="20" x2="19" y2="9" /></>),
  "bilan-mois": svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></>),
  operations: svg(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3.5" y1="6" x2="3.51" y2="6" /><line x1="3.5" y1="12" x2="3.51" y2="12" /><line x1="3.5" y1="18" x2="3.51" y2="18" /></>),
  import: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 8 12 3 17 8" /><line x1="12" y1="3" x2="12" y2="15" /></>),
};

const ONGLETS: { id: Onglet; libelle: string; court: string }[] = [
  { id: "synthese", libelle: "Synthèse", court: "Synthèse" },
  { id: "previsionnel", libelle: "Prév & Targets", court: "Prév" },
  { id: "soldes", libelle: "Soldes annuels", court: "Soldes" },
  { id: "bilan-mois", libelle: "Bilan par mois", court: "Bilan" },
  { id: "operations", libelle: "Opérations", court: "Opér." },
  { id: "import", libelle: "Importer", court: "Import" },
];

// Onglets conservés sur l'app mobile (version simplifiée).
const ONGLETS_MOBILE: Onglet[] = ["synthese", "previsionnel", "operations", "import"];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [chargement, setChargement] = useState(true);
  const [membre, setMembre] = useState<boolean | null>(null);
  const [onglet, setOnglet] = useState<Onglet>("synthese");
  // filtres à appliquer en arrivant sur Opérations (depuis la Synthèse ou Prév & Targets)
  const [filtresOps, setFiltresOps] = useState<Filtres | null>(null);
  const voirOperations = (f: Filtres) => {
    setFiltresOps(f);
    setOnglet("operations");
  };
  const estMobile = useEstMobile();
  const onglets = estMobile ? ONGLETS.filter((o) => ONGLETS_MOBILE.includes(o.id)) : ONGLETS;

  // Sur mobile, les onglets masqués (Soldes, Bilan) renvoient à la Synthèse.
  useEffect(() => {
    if (estMobile && !ONGLETS_MOBILE.includes(onglet)) setOnglet("synthese");
  }, [estMobile, onglet]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChargement(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setMembre(null);
      return;
    }
    supabase.rpc("est_membre").then(({ data, error }) => setMembre(!error && data === true));
  }, [session]);

  if (chargement) return <div className="centre">Chargement…</div>;
  if (!session) return <Connexion />;

  return (
    <div className={onglet === "bilan-mois" || onglet === "previsionnel" || onglet === "soldes" ? "app large" : "app"}>
      <header className="entete">
        <h1>Finances Famille</h1>
        <nav className="onglets" aria-label="Navigation">
          {onglets.map((o) => (
            <button key={o.id} className={onglet === o.id ? "actif" : ""} aria-current={onglet === o.id ? "page" : undefined}
              data-court={o.court} onClick={() => { setFiltresOps(null); setOnglet(o.id); }}>
              {ICONES[o.id]}
              <span className="lbl">{o.libelle}</span>
            </button>
          ))}
        </nav>
        <button className="lien" onClick={() => supabase.auth.signOut()}>
          Se déconnecter
        </button>
      </header>
      <main>
        {membre === false && (
          <p className="alerte">Ce compte n'est pas autorisé à voir les données de la famille.</p>
        )}
        {membre && onglet === "synthese" && (
          <Synthese
            onChoisirCompte={(id) => voirOperations({ ...FILTRES_VIDES, comptes: [id] })}
          />
        )}
        {membre && onglet === "operations" && <Operations filtresInitiaux={filtresOps} />}
        {membre && onglet === "bilan-mois" && <BilanMois />}
        {membre && onglet === "previsionnel" && <Previsionnel onVoirOperations={voirOperations} />}
        {membre && onglet === "soldes" && <SoldesAnnuels />}
        {membre && onglet === "import" && <Import />}
      </main>
    </div>
  );
}

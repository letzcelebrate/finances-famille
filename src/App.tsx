import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import Connexion from "./pages/Connexion";
import Synthese from "./pages/Synthese";
import Operations from "./pages/Operations";

type Onglet = "synthese" | "operations";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [chargement, setChargement] = useState(true);
  const [membre, setMembre] = useState<boolean | null>(null);
  const [onglet, setOnglet] = useState<Onglet>("synthese");
  const [compteChoisi, setCompteChoisi] = useState<number | null>(null);

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
    <div className="app">
      <header className="entete">
        <h1>Finances Famille</h1>
        <nav className="onglets">
          <button className={onglet === "synthese" ? "actif" : ""} onClick={() => setOnglet("synthese")}>
            Synthèse
          </button>
          <button className={onglet === "operations" ? "actif" : ""} onClick={() => setOnglet("operations")}>
            Opérations
          </button>
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
            onChoisirCompte={(id) => {
              setCompteChoisi(id);
              setOnglet("operations");
            }}
          />
        )}
        {membre && onglet === "operations" && <Operations compteInitial={compteChoisi} />}
      </main>
    </div>
  );
}

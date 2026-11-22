import { useEffect, useState, type InputHTMLAttributes } from "react";

/** AAAA-MM-JJ -> JJ/MM/AAAA (vide si invalide). */
export function isoVersFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** JJ/MM/AAAA -> AAAA-MM-JJ, ou null si la date n'existe pas. */
export function frVersIso(fr: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fr);
  if (!m) return null;
  const [, j, mo, a] = m;
  const d = new Date(Date.UTC(Number(a), Number(mo) - 1, Number(j)));
  if (d.getUTCFullYear() !== Number(a) || d.getUTCMonth() !== Number(mo) - 1 || d.getUTCDate() !== Number(j)) return null;
  return `${a}-${mo}-${j}`;
}

type Props = {
  /** valeur au format AAAA-MM-JJ (ou "" si vide) */
  value: string;
  /** appelé avec la date AAAA-MM-JJ (ou "" tant que la saisie est incomplète / vide) */
  onChange: (iso: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;

/** Champ de date en JJ/MM/AAAA, indépendant de la langue du navigateur. */
export function ChampDate({ value, onChange, placeholder = "JJ/MM/AAAA", ...rest }: Props) {
  const [texte, setTexte] = useState(() => isoVersFr(value));

  // Resynchronise si la valeur change de l'extérieur (ex. réinitialisation du formulaire).
  useEffect(() => {
    setTexte((actuel) => (frVersIso(actuel) === (value || null) ? actuel : isoVersFr(value)));
  }, [value]);

  function saisir(brut: string) {
    const chiffres = brut.replace(/\D/g, "").slice(0, 8);
    let f = chiffres;
    if (chiffres.length > 4) f = `${chiffres.slice(0, 2)}/${chiffres.slice(2, 4)}/${chiffres.slice(4)}`;
    else if (chiffres.length > 2) f = `${chiffres.slice(0, 2)}/${chiffres.slice(2)}`;
    setTexte(f);
    onChange(chiffres.length === 0 ? "" : frVersIso(f) ?? "");
  }

  return (
    <input {...rest} type="text" inputMode="numeric" placeholder={placeholder} maxLength={10} value={texte}
      onChange={(e) => saisir(e.target.value)} />
  );
}

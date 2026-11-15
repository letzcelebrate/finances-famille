import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const cle = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !cle) {
  throw new Error("Configuration Supabase manquante (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).");
}

export const supabase = createClient(url, cle);

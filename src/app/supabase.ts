import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

function buildBootstrapError(): string | null {
  const missing: string[] = [];
  if (!url) missing.push("VITE_SUPABASE_URL");
  if (!anon) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!missing.length) return null;
  return [
    `Configuracao ausente no frontend: ${missing.join(", ")}.`,
    "Defina as variaveis Vite do Supabase para liberar login e sessao da Roove.",
  ].join(" ");
}

let supabaseClient: SupabaseClient | null = null;
let supabaseBootstrapError: string | null = buildBootstrapError();

if (!supabaseBootstrapError) {
  try {
    supabaseClient = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (error: unknown) {
    const detail =
      error instanceof Error && error.message
        ? error.message
        : "Falha ao inicializar o cliente do Supabase.";
    supabaseBootstrapError = `${detail} Revise VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.`;
  }
}

export const supabase = supabaseClient;

export function getSupabaseBootstrapError(): string | null {
  return supabaseBootstrapError;
}

import { createClient } from "@supabase/supabase-js";

// Cliente con permisos totales (bypassa RLS). SOLO se usa dentro de Route
// Handlers (código de servidor) — jamás debe importarse desde un componente
// "use client", o la service role key terminaría en el bundle del navegador.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const AUTH_BACKEND =
  import.meta.env.VITE_AUTH_BACKEND === "postgres" ? "postgres" : "supabase";

export function isPostgresAuthEnabled() {
  return AUTH_BACKEND === "postgres";
}

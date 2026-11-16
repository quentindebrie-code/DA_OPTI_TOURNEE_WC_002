// ═══════════════════════════════════════════════════════════════════════════
// Configuration de l'application web
//
// Ces deux valeurs sont PUBLIQUES par conception : elles finissent dans le
// navigateur de chaque utilisateur. Ne mettez JAMAIS ici la clé secrète
// (sb_secret_… / service_role) : la protection des données repose sur
// Supabase Auth + les politiques RLS de « supabase_web_auth.sql ».
//
// Supabase → Project Settings → API Keys :
//   - SUPABASE_URL             : https://VOTRE-PROJET.supabase.co
//   - SUPABASE_PUBLISHABLE_KEY : sb_publishable_…  (ou l'ancienne clé « anon »)
//
// Laissez-les vides pour lancer le MODE DÉMO (données fictives stockées dans
// ce navigateur uniquement, sans connexion).
// ═══════════════════════════════════════════════════════════════════════════

export const SUPABASE_URL = "https://owpsojjsfwmfkqymfdiu.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rFM8kmsiR42eGmMlcRm9Wg_QYKEeODe";

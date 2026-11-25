// Session Supabase : connexion par lien magique, réservée à l'adresse autorisée.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALLOWED_EMAIL } from "../config.js";

// Le lien du mail d'invitation (et de confirmation) revient avec les jetons dans le fragment
// de l'adresse (#access_token=…&refresh_token=…&type=invite). supabase-js, réglé en PKCE pour
// les liens magiques, refuse ce format : on récupère ces jetons nous-mêmes avant de créer le
// client, et on les retire de l'adresse pour qu'ils ne restent ni à l'écran ni dans l'historique.
const hash = new URLSearchParams(location.hash.slice(1));
const urlTokens = hash.get("access_token") && hash.get("refresh_token")
  ? { access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"), type: hash.get("type") }
  : null;
if (urlTokens) history.replaceState(null, "", location.pathname + location.search);

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});

/** Ouvre la session à partir des jetons d'un lien d'invitation, s'il y en avait. */
export async function consumeUrlTokens() {
  if (!urlTokens) return null;
  const { data, error } = await supabase.auth.setSession(urlTokens);
  if (error) throw new Error("Lien d'invitation invalide ou expiré.");
  return data.session;
}

/**
 * Adresse de base de la page, calculée depuis l'adresse courante : dossier de la page, sans
 * fichier, requête ni ancre. Fonctionne à la racine d'un domaine (https://cockpit.roseausi.fr/)
 * comme sous un sous-chemin (https://….github.io/cockpit-roseausi-web/) ou en local.
 */
export const appBaseUrl = () => new URL("./", location.href).href;

export const isAllowed = (email) => (email || "").trim().toLowerCase() === ALLOWED_EMAIL;

export async function sendMagicLink(email) {
  const e = (email || "").trim().toLowerCase();
  if (!isAllowed(e)) throw new Error("Cette adresse n'est pas autorisée à utiliser le cockpit.");
  const { error } = await supabase.auth.signInWithOtp({
    email: e,
    // Pas de création de compte depuis la page : seul le compte créé dans Supabase peut se connecter.
    options: { shouldCreateUser: false, emailRedirectTo: appBaseUrl() },
  });
  if (error) throw new Error(otpMessage(error));
}

// Traduction des erreurs d'envoi de lien, d'après le code renvoyé par Supabase Auth.
function otpMessage(error) {
  const code = error.code || "";
  const msg = error.message || "";
  // Supabase traite un compte invité mais jamais confirmé comme une nouvelle inscription :
  // avec les inscriptions désactivées, il répond « signup_disabled » même si le compte existe.
  if (code === "signup_disabled" || /signups not allowed/i.test(msg)) {
    return "Ton compte existe mais n'est pas encore confirmé. Clique sur le lien du mail d'invitation Supabase "
      + "(avec cette page lancée sur http://localhost:8080), ou renvoie une invitation depuis Authentication › Users.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || /rate limit|security purposes|seconds/i.test(msg)) {
    return "Trop de demandes de lien, attends quelques minutes avant de réessayer.";
  }
  if (code === "otp_disabled" || code === "email_provider_disabled") return "La connexion par mail est désactivée dans Supabase.";
  if (code === "user_not_found") return "Aucun compte pour cette adresse dans Supabase.";
  return "Envoi du lien impossible : " + msg + (code ? ` (${code})` : "");
}

export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Écouteurs de session, prévenus aussi quand la déconnexion est forcée côté page.
const authListeners = new Set();

/**
 * Déconnexion qui aboutit toujours. supabase-js abandonne la déconnexion quand la session
 * enregistrée ne peut plus être rafraîchie (session révoquée ou expirée côté serveur) : il
 * renvoie une erreur sans rien effacer, et la page reste bloquée sur « Session expirée ».
 * Dans ce cas on efface nous-mêmes la session du navigateur et on prévient la page.
 */
export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (!error) return;
  } catch { /* on passe à l'effacement local */ }
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* idem */ }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
  } catch { /* stockage indisponible */ }
  authListeners.forEach((cb) => cb(null));
}

export const onAuth = (cb) => {
  authListeners.add(cb);
  return supabase.auth.onAuthStateChange((_evt, session) => cb(session));
};

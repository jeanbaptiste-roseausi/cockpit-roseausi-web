// Appels aux Edge Functions avec le jeton de la session en cours.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { currentSession, signOut } from "./session.js";

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function call(fn, path = "", { method = "GET", body } = {}) {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "no_session", "Connexion requise.");
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Réseau indisponible, vérifie ta connexion.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401) await signOut();
    throw new ApiError(res.status, err.code ?? "http", err.message ?? `Erreur ${res.status}`, err.details);
  }
  return data;
}

// Fiche Contacts. Les futures fiches (TO DO, agent) ajouteront leur propre bloc ici.
export const contactsApi = {
  list: () => call("contacts"),
  schema: () => call("contacts", "/schema"),
  get: (id) => call("contacts", `/${id}`),
  update: (id, changes) => call("contacts", `/${id}`, { method: "PATCH", body: { changes } }),
};

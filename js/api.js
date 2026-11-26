// Appels aux Edge Functions avec le jeton de la session en cours.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { currentSession, signOut } from "./session.js";

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

// Recette du lot M : « ?simuler=notion-indisponible » dans l'adresse fait refuser tout appel à Notion
// par les fonctions (pour cet onglet) ; « ?simuler=non » arrête. Rien d'autre ne change.
const SIM_KEY = "cockpit.simulation";
try {
  const q = new URLSearchParams(location.search).get("simuler");
  if (q === "notion-indisponible") sessionStorage.setItem(SIM_KEY, q);
  if (q === "non") sessionStorage.removeItem(SIM_KEY);
} catch { /* stockage indisponible : pas de simulation */ }
export const simulation = () => { try { return sessionStorage.getItem(SIM_KEY); } catch { return null; } };

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
        ...(simulation() ? { "x-cockpit-simulation": simulation() } : {}),
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

// Une entrée par fiche. L'agent de fiche ajoutera la sienne ici.
export const contactsApi = {
  list: () => call("contacts"),
  schema: () => call("contacts", "/schema"),
  get: (id) => call("contacts", `/${id}`),
  update: (id, changes) => call("contacts", `/${id}`, { method: "PATCH", body: { changes } }),
};

export const todoApi = {
  list: ({ scope, contact } = {}) => call("todo", contact ? `?contact=${encodeURIComponent(contact)}` : scope ? `?scope=${encodeURIComponent(scope)}` : ""),
  schema: () => call("todo", "/schema"),
  get: (id) => call("todo", `/${id}`),
  update: (id, changes) => call("todo", `/${id}`, { method: "PATCH", body: { changes } }),
  create: (values) => call("todo", "", { method: "POST", body: { values } }),
};

export const projetsApi = {
  list: () => call("projets"),
  get: (id) => call("projets", `/${id}`),
  update: (id, changes) => call("projets", `/${id}`, { method: "PATCH", body: { changes } }),
};

// Lot 2 : pistes (base Pistes/Opportunités) et réseau (parcours et mises en lien, base Contacts).
export const pistesApi = {
  list: () => call("pistes"),
  ofContact: (id) => call("pistes", `?contact=${encodeURIComponent(id)}`),
  ofProjet: (id) => call("pistes", `?projet=${encodeURIComponent(id)}`),
  get: (id) => call("pistes", `/${id}`),
  update: (id, changes) => call("pistes", `/${id}`, { method: "PATCH", body: { changes } }),
};

export const reseauApi = {
  list: () => call("reseau"),
  update: (id, changes) => call("reseau", `/${id}`, { method: "PATCH", body: { changes } }),
  relier: (recommandeur, recommande) => call("reseau", "/lien", { method: "POST", body: { recommandeur, recommande } }),
  creer: (values) => call("reseau", "/contact", { method: "POST", body: values }),
};

// Miroir de Notion (lot M) : relecture des pages modifiées dans Notion, à la demande (Actualiser).
export const miroirApi = {
  sync: () => call("miroir", "/sync", { method: "POST", body: { mode: "incrementale", attendre: true } }),
  etat: () => call("miroir", "/etat"),
};

/** Index léger des projets (id, nom, état), partagé par les vues, chargé une fois. */
let projetsIdx = null;
export function projetsIndex() {
  if (!projetsIdx) projetsIdx = todoApi.schema().then((r) => r.projets || []).catch((e) => { projetsIdx = null; throw e; });
  return projetsIdx;
}

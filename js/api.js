// Appels aux Edge Functions avec le jeton de la session en cours.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { currentSession, signOut } from "./session.js";

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

// Le paramètre ?simuler (panne de Notion simulée, recette du lot M) a été retiré le 26/11/2026 :
// une panne ne se simule plus que dans les tests locaux (tests/page.test.mjs).
try { sessionStorage.removeItem("cockpit.simulation"); } catch { /* stockage indisponible */ }

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

// Une entrée par fiche. L'agent de fiche ajoutera la sienne ici.
export const contactsApi = {
  list: () => call("contacts"),
  schema: () => call("contacts", "/schema"),
  get: (id) => call("contacts", `/${id}`),
  aCreer: () => call("contacts", "/a-creer"),
  doublons: (nom) => call("contacts", `/doublons?nom=${encodeURIComponent(nom)}`),
  create: (values, { piste = null, confirmerDoublon = false } = {}) => call("contacts", "", { method: "POST", body: { values, ...(piste ? { piste } : {}), confirmerDoublon } }),
  update: (id, changes, avant) => call("contacts", `/${id}`, { method: "PATCH", body: { changes, ...(avant ? { avant } : {}) } }),
};

export const todoApi = {
  list: ({ scope, contact } = {}) => call("todo", contact ? `?contact=${encodeURIComponent(contact)}` : scope ? `?scope=${encodeURIComponent(scope)}` : ""),
  schema: () => call("todo", "/schema"),
  get: (id) => call("todo", `/${id}`),
  update: (id, changes, avant) => call("todo", `/${id}`, { method: "PATCH", body: { changes, ...(avant ? { avant } : {}) } }),
  create: (values) => call("todo", "", { method: "POST", body: { values } }),
};

export const projetsApi = {
  list: () => call("projets"),
  get: (id) => call("projets", `/${id}`),
  update: (id, changes, avant) => call("projets", `/${id}`, { method: "PATCH", body: { changes, ...(avant ? { avant } : {}) } }),
};

// Lot 2 : pistes (base Pistes/Opportunités) et réseau (parcours et mises en lien, base Contacts).
export const pistesApi = {
  list: () => call("pistes"),
  ofContact: (id) => call("pistes", `?contact=${encodeURIComponent(id)}`),
  ofProjet: (id) => call("pistes", `?projet=${encodeURIComponent(id)}`),
  get: (id) => call("pistes", `/${id}`),
  update: (id, changes, avant) => call("pistes", `/${id}`, { method: "PATCH", body: { changes, ...(avant ? { avant } : {}) } }),
  schema: () => call("pistes", "/schema"),
  // Création (26/11/2026) : pistes proches d'abord, puis création confirmée.
  doublons: (nom, contacts = []) => call("pistes", `/doublons?nom=${encodeURIComponent(nom)}&contacts=${encodeURIComponent(contacts.join(","))}`),
  create: (values, { confirmerDoublon = false, parcours = true } = {}) => call("pistes", "", { method: "POST", body: { values, confirmerDoublon, parcours } }),
};

export const reseauApi = {
  list: () => call("reseau"),
  update: (id, changes) => call("reseau", `/${id}`, { method: "PATCH", body: { changes } }),
  relier: (recommandeur, recommande) => call("reseau", "/lien", { method: "POST", body: { recommandeur, recommande } }),
  creer: (values) => call("reseau", "/contact", { method: "POST", body: values }),
};

// Lot 3 : fil Agent des fiches Contact et Tâche (type : "contact" ou "tache").
export const agentApi = {
  fil: (type, id) => call("agent", `/${type}/${id}`),
  envoyer: (type, id, typeMessage, texte) => call("agent", `/${type}/${id}`, { method: "POST", body: { type: typeMessage, texte } }),
  annuler: (n) => call("agent", `/action/${n}/annuler`, { method: "POST", body: {} }),
  appliquer: (n) => call("agent", `/action/${n}/appliquer`, { method: "POST", body: {} }),
  // Lot 3 bis : agent global (un fil pour tous les écrans) et gestes groupés.
  filGlobal: () => call("agent", "/ecran"),
  envoyerGlobal: (typeMessage, texte, ecran) => call("agent", "/ecran", { method: "POST", body: { type: typeMessage, texte, ecran } }),
  groupe: (n, geste, body = {}) => call("agent", `/groupe/${n}/${geste}`, { method: "POST", body }),
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

// Lot 5a : Ma journée et Vue d'ensemble (lecture seule, miroir), Journal de bord.
export const journeeApi = {
  get: () => call("journee"),
  ensemble: () => call("journee", "/ensemble"),
};

export const journalApi = {
  list: (depuis) => call("journal", depuis ? `?depuis=${encodeURIComponent(depuis)}` : ""),
  get: (id) => call("journal", `/${id}`),
  rattacher: (id, changes) => call("journal", `/${id}`, { method: "PATCH", body: { changes } }),
  action: (id, values) => call("journal", `/${id}/action`, { method: "POST", body: { values } }),
  // Compte rendu (corps de la page Notion, lu à la demande) et bloc replié (transcript, sous-page).
  contenu: (id, frais = false) => call("journal", `/${id}/contenu${frais ? "?frais=1" : ""}`),
  bloc: (id, bloc) => call("journal", `/${id}/contenu/${bloc}`),
  initiatives: () => call("journal", "/initiatives"),
};

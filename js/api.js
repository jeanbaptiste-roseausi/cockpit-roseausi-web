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

/**
 * Appel avec étapes en direct (27/11/2026) : la fonction agent renvoie une ligne JSON par étape, puis la réponse.
 * onEtape reçoit chaque étape ; la promesse rend la réponse habituelle. Une fonction qui répond encore en JSON
 * (ancienne version, demande de livrable, erreur de validation) est lue comme avant.
 */
export async function callFlux(fn, path, body, onEtape) {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "no_session", "Connexion requise.");
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Réseau indisponible, vérifie ta connexion.");
  }
  if (!(res.headers.get("content-type") || "").includes("ndjson") || !res.body) {
    let data = null;
    try { data = await res.json(); } catch { /* réponse vide */ }
    if (!res.ok) {
      const err = data?.error ?? {};
      if (res.status === 401) await signOut();
      throw new ApiError(res.status, err.code ?? "http", err.message ?? `Erreur ${res.status}`, err.details);
    }
    return data;
  }
  const lecteur = res.body.getReader(), dec = new TextDecoder();
  let reste = "", fin = null, erreur = null;
  const ligne = (l) => {
    if (!l.trim()) return;
    let o; try { o = JSON.parse(l); } catch { return; }
    if (o.etape) { try { onEtape?.(o.etape); } catch { /* affichage seulement */ } }
    else if (o.fin) fin = o.fin;
    else if (o.erreur) erreur = o.erreur;
  };
  try {
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      reste += dec.decode(value, { stream: true });
      const l = reste.split("\n"); reste = l.pop();
      l.forEach(ligne);
    }
    ligne(reste + dec.decode());
  } catch {
    throw new ApiError(0, "network", "La connexion a été coupée pendant l'échange. Réessaie dans un instant.");
  }
  if (erreur) throw new ApiError(erreur.status ?? 500, erreur.code ?? "http", erreur.message ?? "L'agent n'a pas pu répondre.");
  if (!fin) throw new ApiError(0, "network", "La connexion a été coupée pendant l'échange. Réessaie dans un instant.");
  return fin;
}

// Une entrée par fiche. L'agent de fiche ajoutera la sienne ici.
export const contactsApi = {
  list: () => call("contacts"),
  schema: () => call("contacts", "/schema"),
  get: (id) => call("contacts", `/${id}`),
  aCreer: () => call("contacts", "/a-creer"),
  doublons: (nom) => call("contacts", `/doublons?nom=${encodeURIComponent(nom)}`),
  // Fiche alignée sur l'artefact (26/11/2026) : échanges du contact, Mémoire (corps de la page Notion).
  echanges: (id) => call("contacts", `/${id}/echanges`),
  memoire: (id, frais = false) => call("contacts", `/${id}/memoire${frais ? "?frais=1" : ""}`),
  memoireBloc: (id, bloc) => call("contacts", `/${id}/memoire/${bloc}`),
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
  // Retire une mise en lien et remet les étapes d'avant (Annuler du message, Jean-Baptiste seul).
  retirerLien: (recommandeur, recommande, etapes) => call("reseau", "/lien", { method: "POST", body: { recommandeur, recommande, retirer: true, etapes } }),
  creer: (values) => call("reseau", "/contact", { method: "POST", body: values }),
};

// Lot 3 : fil Agent des fiches Contact et Tâche (type : "contact" ou "tache").
export const agentApi = {
  fil: (type, id) => call("agent", `/${type}/${id}`),
  envoyer: (type, id, typeMessage, texte, onEtape) => callFlux("agent", `/${type}/${id}`, { type: typeMessage, texte }, onEtape),
  annuler: (n) => call("agent", `/action/${n}/annuler`, { method: "POST", body: {} }),
  appliquer: (n) => call("agent", `/action/${n}/appliquer`, { method: "POST", body: {} }),
  // Agent d'écran (lot 3 bis ; un fil par écran depuis le 26/11/2026, soir) et gestes groupés.
  filEcran: (vue) => call("agent", `/ecran/${vue}`),
  envoyerEcran: (vue, typeMessage, texte, ecran, onEtape) => callFlux("agent", `/ecran/${vue}`, { type: typeMessage, texte, ecran }, onEtape),
  groupe: (n, geste, body = {}) => call("agent", `/groupe/${n}/${geste}`, { method: "POST", body }),
  // Mémoire dans la fiche (27/11/2026) : Clore et Agent neuf (fiche), Nouveau fil (écran), Arrêter (les deux).
  clore: (type, id, neuf = false, onEtape) => callFlux("agent", `/${type}/${id}/${neuf ? "neuf" : "clore"}`, {}, onEtape),
  nouveauFil: (vue) => call("agent", `/ecran/${vue}/nouveau`, { method: "POST", body: {} }),
  arreter: (type, id) => call("agent", `/${type}/${id}/arreter`, { method: "POST", body: {} }),
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

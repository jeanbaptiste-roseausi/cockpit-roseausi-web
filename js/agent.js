// Panneau Agent (lots 3 et 3 bis).
//
// Lot 3 : fil Agent des fiches Contact et Tâche, dans le panneau de droite de la fiche, sous Mes notes.
// Lot 3 bis : agent d'écran, disponible sur chaque écran (Ma journée, Vue d'ensemble, Pistes, Contacts, Réseau,
// Journal, Projets, Actions). La fiche projet a son agent de fiche (27/11/2026) : il lit les échanges du projet et
// sa page Contexte, et tient les champs Agent.
// Fils séparés (26/11/2026, soir) : chaque fiche (contact, tâche, projet, piste, échange du Journal) et chaque écran
// a son propre fil, comme dans l'artefact (une session par fiche et par page). Un message d'écran part avec la
// description de l'écran ouvert (ce qu'il affiche, filtres compris), que la fonction relit dans le miroir.
// Gestes groupés : l'agent propose une liste de changements, fiche par fiche ; rien n'est écrit avant que
// Jean-Baptiste coche et clique Appliquer. Après application, « Tout annuler » et « Annuler » par ligne.
//
// Deux modes d'affichage, au choix et mémorisés (stockage du navigateur) : ancré à droite (comme au lot 3), ou
// fenêtre flottante déplaçable et redimensionnable. Sur téléphone, la fenêtre devient un panneau plein écran
// qu'on ferme en le tirant vers le bas. Le fil reste le même d'un mode à l'autre (état gardé ici, par fil).
// L'agent écrit par la fonction serveur « agent » ; la page ne voit jamais la clé de l'API.
import { agentApi } from "./api.js";
import { $, esc, ic, fd, toast, setAgentHook } from "./ui.js";

const TYPES = {
  question: { l: "Question", ic: "info", ph: "Pose ta question. L'agent répond sans rien modifier." },
  remarque: { l: "Remarque", ic: "note", ph: "Une précision ou un changement. L'agent le range et te montre ce qui a changé." },
  livrable: { l: "Livrable", ic: "book", ph: "Décris le livrable voulu. La demande est enregistrée, traitée au lot 4." },
};
const SUGG = {
  tache: ["Où en est cette tâche ?", "Replanifie-la à vendredi", "Qu'est-ce qui bloque et que faut-il faire ensuite ?"],
  contact: ["Résume notre relation et ce qui est en cours", "Quelles sont mes prochaines actions avec ce contact ?", "Note une mise en lien"],
  projet: ["Où en est ce projet ?", "Quels engagements des tiers sont en retard ?", "Quelles sont mes prochaines actions sur ce projet ?"],
  piste: ["Où en est cette piste ?", "Quelle est la prochaine action à faire ?", "Qui sont les bons interlocuteurs ?"],
  echange: ["Résume cet échange en cinq lignes", "Quelles actions en découlent pour moi ?", "Qu'est-ce qui a été décidé ?"],
  journee: ["Qu'est-ce qui est le plus urgent aujourd'hui ?", "Décale à lundi mes tâches de vendredi"],
  ensemble: ["Résume la semaine en trois points", "Quels projets demandent mon attention ?"],
  pistes: ["Quelles pistes actives n'ont aucune action ?", "Crée une relance pour chaque piste sans action"],
  contacts: ["Qui dois-je recontacter ce mois-ci ?", "Quels contacts n'ont pas de prochaine action ?"],
  reseau: ["Qui dois-je recontacter ce mois-ci ?", "Quelles mises en lien sont en attente ?"],
  journal: ["Quels échanges n'ont pas encore de suites ?", "Résume les échanges de la semaine"],
  projets: ["Quels projets sont en difficulté et pourquoi ?", "Quels jalons arrivent dans les quinze jours ?"],
  todo: ["Qu'est-ce qui est en retard ?", "Décale à lundi mes tâches de vendredi"],
  autre: ["Résume ce que montre cet écran", "Qu'est-ce qui demande mon attention ici ?"],
};
const BASE = { todo: "todo", contacts: "contacts", pistes: "pistes", projets: "projets", journal: "journal" };
const ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const PAQUET = 10;

// ---------------------------------------------------------------------------------------------
// Préférences mémorisées : mode (ancre | flottant), panneau ouvert, géométrie de la fenêtre flottante.
const PREF_CLE = "cockpit.agent";
const PREF = { mode: "ancre", ouvert: false, fen: null };
try { Object.assign(PREF, JSON.parse(localStorage.getItem(PREF_CLE) || "{}")); } catch { /* stockage indisponible */ }
if (!["ancre", "flottant"].includes(PREF.mode)) PREF.mode = "ancre";
const garder = () => { try { localStorage.setItem(PREF_CLE, JSON.stringify(PREF)); } catch { /* */ } };
const tel = () => window.matchMedia("(max-width: 900px)").matches;
// Sur téléphone le panneau plein écran ne se rouvre jamais tout seul : son ouverture n'est pas mémorisée.
let ouvertTel = false;
const ouvert = () => (tel() ? ouvertTel : !!PREF.ouvert);

// ---------------------------------------------------------------------------------------------
// État par fil : clé = identifiant de la fiche, ou « ecran:<vue> » pour le fil d'un écran.
const F = new Map();
const st = (k) => F.get(k) ?? F.set(k, { fil: null, info: null, busy: false, err: "", draft: "", type: "question", prog: "" }).get(k);
const DECOCHE = new Map(); // geste groupé → lignes décochées

const drawerOuvert = () => document.body.classList.contains("dr-open") && $("#drawer")?.classList.contains("on");

const TYPE_FICHE = { contacts: "contact", todo: "tache", projets: "projet", pistes: "piste", journal: "echange" };
const ECRANS = ["journee", "ensemble", "pistes", "contacts", "reseau", "journal", "projets", "todo"];

/** Fil à afficher : celui de la fiche ouverte (contact, tâche, projet, piste, échange), sinon celui de l'écran. */
function cible() {
  const [, v = "journee", id] = (location.hash || "").split("/");
  const fiche = drawerOuvert() && id && id !== "new" && ID.test(id) && BASE[v] ? { base: BASE[v], id } : null;
  if (fiche && TYPE_FICHE[v]) return { type: TYPE_FICHE[v], id, key: id.replace(/-/g, "").toLowerCase(), fiche };
  const view = ECRANS.includes(v) ? v : "journee";
  return { type: "ecran", key: `ecran:${view}`, view, fiche: null };
}

/** Où va le fil : dans le panneau de la fiche (ancré, fiche ouverte), dans le panneau #agp, ou nulle part. */
function placement(c) {
  const side = sideHost();
  if (drawerOuvert() && side && PREF.mode === "ancre") return "side";
  return ouvert() ? "agp" : null;
}
const sideHost = () => { const el = document.querySelector("#dr-side [data-agent-host]"); return el?.isConnected ? el : null; };

// ---------------------------------------------------------------------------------------------
// Description de l'écran ouvert, envoyée avec chaque message du fil de l'écran. Le serveur relit les fiches dans
// le miroir : la page ne donne que des identifiants, les filtres affichés et le titre.
function ecranCourant(c) {
  const titre = ($(".top h1")?.textContent || c.view || "").trim();
  const root = c.fiche ? $("#dr-body") : $("#view");
  const elements = [], vus = new Set();
  const add = (base, id) => {
    if (!id || !ID.test(id)) return;
    const k = id.replace(/-/g, "").toLowerCase();
    if (vus.has(k)) return;
    vus.add(k); elements.push({ base, id });
  };
  if (c.fiche) add(c.fiche.base, c.fiche.id);
  if (root) {
    for (const el of root.querySelectorAll('a[href^="#/"], [data-jck], [data-jech], [data-drag], [data-pidrag], [data-contact], [data-rzrow], [data-id]')) {
      if (elements.length >= 80) break;
      if (!el.getClientRects().length) continue;
      const m = (el.getAttribute("href") || "").match(/^#\/(todo|contacts|pistes|projets|journal)\/([0-9a-f-]{32,36})$/i);
      if (m) add(BASE[m[1]], m[2]);
      else if (el.dataset.jck || el.dataset.jech || el.dataset.drag) add("todo", el.dataset.jck || el.dataset.jech || el.dataset.drag);
      else if (el.dataset.pidrag) add("pistes", el.dataset.pidrag);
      else if (el.dataset.contact || el.dataset.rzrow) add("contacts", el.dataset.contact || el.dataset.rzrow);
      else if (el.dataset.id && c.view === "reseau") add("contacts", el.dataset.id);
    }
  }
  const filtres = [], fv = new Set();
  const f = (t) => { t = String(t || "").replace(/\s+/g, " ").trim().slice(0, 120); if (t && !fv.has(t) && filtres.length < 20) { fv.add(t); filtres.push(t); } };
  if (c.fiche) f(`Fiche ouverte : ${($("#dr-kind")?.textContent || "").trim()} « ${($("#dr-body h1, #dr-body h2")?.textContent || "").trim().slice(0, 80)} »`);
  else if (root) {
    for (const el of root.querySelectorAll('button.on, button[aria-pressed="true"], [role="tab"][aria-selected="true"], select, input[type="search"], input[type="text"]')) {
      if (!el.getClientRects().length || el.closest("a[href], .card, li[data-id]")) continue;
      if (el.tagName === "SELECT") {
        const lab = el.getAttribute("aria-label") || el.labels?.[0]?.textContent || el.title || "Choix";
        f(`${lab.trim()} : ${el.selectedOptions?.[0]?.textContent?.trim() || "—"}`);
      } else if (el.tagName === "INPUT") {
        if (el.value.trim()) f(`${(el.getAttribute("aria-label") || el.placeholder || "Recherche").trim()} : « ${el.value.trim()} »`);
      } else f(el.getAttribute("aria-label") || el.title || el.textContent);
    }
  }
  return { id: c.view || "journee", titre, filtres, elements, fiche: c.fiche };
}

// ---------------------------------------------------------------------------------------------
// Rendu du fil

const usd = (x) => `${Number(x || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const usdFin = (x) => `${Number(x || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 4 })} $`;
const nb = (n) => Number(n || 0).toLocaleString("fr-FR");
const jetons = (e) => e.jetons_entree + e.jetons_sortie + e.jetons_cache_lecture + e.jetons_cache_ecriture;
const heure = (iso) => { const d = new Date(iso); return `${fd(iso)} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`; };

/** Texte de l'agent : paragraphes et listes simples, tout échappé. */
function texte(t) {
  const blocs = String(t || "").split(/\n{2,}/);
  return blocs.map((b) => {
    const l = b.split("\n");
    if (l.every((x) => /^\s*[-•]\s+/.test(x))) return `<ul>${l.map((x) => `<li>${esc(x.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${l.map(esc).join("<br>")}</p>`;
  }).join("");
}

const val = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) ? "vide" : Array.isArray(v) ? `${v.length} lien${v.length > 1 ? "s" : ""}` : /^\d{4}-\d\d-\d\d$/.test(String(v)) ? fd(String(v)) : /^\d{4}-\d\d-\d\dT/.test(String(v)) ? fd(String(v).slice(0, 10)) : String(v).length > 80 ? String(v).slice(0, 80) + "…" : String(v);
const lien = (a) => a.cible_id ? `<a href="#/${["todo", "projets", "pistes"].includes(a.cible_base) ? a.cible_base : "contacts"}/${esc(a.cible_id)}">${esc(a.cible_nom || "la fiche")}</a>` : esc(a.cible_nom || "");
const diff = (a) => `<span class="ag-diff"><del>${esc(val(a.ancienne))}</del> ${ic("arrow", "ic-sm")} <ins>${esc(val(a.nouvelle))}</ins></span>`;

function actionHTML(a) {
  let quoi;
  if (a.genre === "modifier") {
    const rel = Array.isArray(a.ancienne) || Array.isArray(a.nouvelle);
    quoi = `<b>${esc(a.propriete)}</b> de ${lien(a)}${rel ? ` : liens modifiés (${val(a.ancienne)} → ${val(a.nouvelle)})` : diff(a)}`;
  } else if (a.genre === "creer_tache") quoi = `Tâche créée : ${lien(a)}`;
  else if (a.genre === "creer_contact") quoi = `Contact créé : ${lien(a)}`;
  else if (a.genre === "ajouter_contexte") quoi = `Ajouté à la ${esc(a.propriete || "page Contexte")} de ${lien(a)} : <span class="ag-diff"><ins>${esc(val(a.nouvelle))}</ins></span>`;
  else if (a.genre === "relier") quoi = `Mise en lien : ${esc(a.nouvelle?.recommandeurNom || "un contact")} a recommandé ${lien(a)}`;
  else quoi = `Proposé : <b>${esc(a.propriete)}</b> de ${lien(a)}${diff(a)}`;
  const btn = a.statut === "faite" && ["modifier", "creer_tache", "creer_contact", "relier"].includes(a.genre)
    ? `<button class="btn sm" data-ag-annuler="${a.id}" data-genre="${a.genre}">${ic("reset", "ic-sm")}Annuler</button>`
    : a.statut === "proposee" ? `<button class="btn sm pri" data-ag-appliquer="${a.id}">${ic("check", "ic-sm")}Appliquer</button>`
    : a.statut === "annulee" ? `<span class="chip">Annulée</span>` : a.statut === "appliquee" ? `<span class="chip c-good">Appliquée</span>`
    : a.statut === "refusee" ? `<span class="chip c-crit">Refusée</span>` : "";
  return `<li class="ag-act s-${a.statut}"><div class="ag-act-t"><span>${quoi}</span>${a.statut === "refusee" && a.erreur ? `<small>${esc(a.erreur)}</small>` : ""}${a.decision && a.statut !== "refusee" ? `<small>Décision : ${esc(a.decision)}</small>` : ""}</div>${btn}</li>`;
}

/** Une ligne d'un geste groupé : case à cocher tant qu'elle est prévue, puis son état et Annuler. */
function ligneHTML(g, l) {
  const nv = l.nouvelle || {};
  const quoi = l.genre === "creer_tache"
    ? (l.cible_id ? `Nouvelle tâche ${lien(l)}` : `Nouvelle tâche « ${esc(l.cible_nom || nv["Nom"] || "")} »`) + (nv["Échéance"] ? ` <span class="ag-diff"><ins>${esc(val(nv["Échéance"]))}</ins></span>` : "")
    : `${lien(l)} · <b>${esc(l.propriete)}</b>${diff(l)}`;
  const off = DECOCHE.get(g.id)?.has(l.id);
  const etat = l.statut === "prevue"
    ? `<input type="checkbox" class="ag-ck" data-grp-ligne="${g.id}:${l.id}" ${off ? "" : "checked"} aria-label="Appliquer cette ligne">`
    : "";
  const fin = l.statut === "faite" ? `<button class="btn sm" data-ag-annuler="${l.id}" data-genre="${l.genre}">${ic("reset", "ic-sm")}Annuler</button>`
    : l.statut === "annulee" ? `<span class="chip">Annulée</span>` : l.statut === "ecartee" ? `<span class="chip">Écartée</span>`
    : l.statut === "refusee" ? `<span class="chip c-crit">Refusée</span>` : "";
  return `<li class="ag-gl s-${l.statut}">${etat}<div class="ag-act-t"><span>${quoi}</span>${l.statut === "refusee" && l.erreur ? `<small>${esc(l.erreur)}</small>` : ""}</div>${fin}</li>`;
}

function groupeHTML(g, s) {
  const prevues = g.lignes.filter((l) => l.statut === "prevue");
  const faites = g.lignes.filter((l) => l.statut === "faite");
  const fiches = new Set(g.lignes.map((l) => l.cible_id || `n${l.id}`)).size;
  const cochees = prevues.filter((l) => !DECOCHE.get(g.id)?.has(l.id)).length;
  const compte = { faite: 0, refusee: 0, annulee: 0, ecartee: 0 };
  for (const l of g.lignes) if (l.statut in compte) compte[l.statut]++;
  const bilan = prevues.length ? "" : [compte.faite && `${compte.faite} appliquée${compte.faite > 1 ? "s" : ""}`, compte.refusee && `${compte.refusee} refusée${compte.refusee > 1 ? "s" : ""}`, compte.annulee && `${compte.annulee} annulée${compte.annulee > 1 ? "s" : ""}`, compte.ecartee && `${compte.ecartee} écartée${compte.ecartee > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const busy = s.busy || !!s.prog;
  return `<div class="ag-grp" data-grp="${g.id}">
    <div class="ag-grp-h">${ic("layers", "ic-sm")}<b>${esc(g.titre)}</b><span class="chip">${fiches} fiche${fiches > 1 ? "s" : ""}</span></div>
    ${g.decision ? `<small class="muted">Décision : ${esc(g.decision)}</small>` : ""}
    ${prevues.length ? `<p class="small ag-grp-aide">Rien n'est écrit tant que tu n'as pas cliqué Appliquer. Décoche les lignes à laisser de côté.</p>` : ""}
    <ul class="ag-gls">${g.lignes.map((l) => ligneHTML(g, l)).join("")}</ul>
    ${bilan ? `<p class="small muted">${esc(bilan)}</p>` : ""}
    <div class="ag-grp-f">
      ${prevues.length ? `<button class="btn sm pri" data-grp-appliquer="${g.id}" ${busy || !cochees ? "disabled" : ""}>${ic("check", "ic-sm")}Appliquer ${cochees} changement${cochees > 1 ? "s" : ""}</button>
        <button class="btn sm ghost" data-grp-tout="${g.id}" ${busy ? "disabled" : ""}>${cochees === prevues.length ? "Tout décocher" : "Tout cocher"}</button>
        <button class="btn sm ghost" data-grp-ecarter="${g.id}" ${busy ? "disabled" : ""}>Écarter</button>` : ""}
      ${faites.length > 1 ? `<button class="btn sm" data-grp-annuler="${g.id}" ${busy ? "disabled" : ""}>${ic("reset", "ic-sm")}Tout annuler</button>` : ""}
    </div></div>`;
}

function messageHTML(e, s) {
  if (e.auteur === "jb") {
    return `<div class="ag-m me"><span class="it">${esc(TYPES[e.type_message]?.l ?? "")}${e.ecran ? ` · ${esc(e.ecran)}` : ""}</span><span class="ag-txt">${esc(e.texte)}</span>${e.type_message === "livrable" ? `<span class="ag-lot4">${ic("book", "ic-sm")}Enregistrée, traitée au lot 4</span>` : ""}<span class="ag-when">${esc(heure(e.cree_le))}</span></div>`;
  }
  if (e.auteur === "note") return `<p class="ag-note ${e.statut ? "n-" + esc(e.statut) : ""}">${esc(e.texte)}</p>`;
  const acts = e.actions?.length ? `<ul class="ag-acts">${e.actions.map(actionHTML).join("")}</ul>` : "";
  const grps = (e.groupes || []).map((g) => groupeHTML(g, s)).join("");
  const cost = e.modele ? `<span class="ag-when">${esc(heure(e.cree_le))} · ${nb(jetons(e))} jetons · ${usdFin(e.cout_usd)}</span>` : `<span class="ag-when">${esc(heure(e.cree_le))}</span>`;
  return `<div class="ag-m bot ${e.statut === "erreur" ? "err" : ""} ${grps ? "wide" : ""}">${texte(e.texte)}${acts}${grps}${cost}</div>`;
}

const suggestions = (c) => c.type !== "ecran" ? SUGG[c.type] || SUGG.autre : SUGG[c.view] || SUGG.autre;

function filHTML(c, s, ou) {
  const i = s.info;
  const flot = PREF.mode === "flottant";
  const modeBtn = ou === "side"
    ? `<button class="btn sm ghost ag-mode" type="button" data-ag-mode="flottant" title="Afficher le fil dans une fenêtre flottante">${ic("float", "ic-sm")}Fenêtre</button>`
    : "";
  const cumul = i ? `<span class="chip ag-cumul" title="Jetons et coût estimé ce mois, tous fils confondus. Plafond réglé côté serveur.">Ce mois ${nb(i.cumul.jetons)} jetons · ${usd(i.cumul.cout_usd)} sur ${usd(i.plafondUsd)}</span>` : "";
  const sansCle = i && !i.cle ? `<div class="banner info ag-cle">${ic("info", "ic-sm")}<span>L'agent attend sa clé API Anthropic. Tu peux déjà écrire : tes messages sont gardés et les demandes de livrable sont enregistrées.</span></div>` : "";
  const plafond = i && i.cle && i.cumul.cout_usd >= i.plafondUsd ? `<div class="banner ag-cle">${ic("alert", "ic-sm")}<span>Plafond du mois atteint : l'agent ne répond plus jusqu'au mois prochain.</span></div>` : "";
  const intro = c.type === "ecran"
    ? `<p class="ag-intro">L'agent de cet écran, avec son propre fil. Il voit ce que l'écran affiche, avec ses filtres, et répond aux questions qui traversent plusieurs fiches. Pour un changement sur plusieurs fiches, il te montre d'abord la liste complète, fiche par fiche, et rien n'est écrit avant que tu cliques Appliquer. Il ne touche jamais à Mes notes ni aux statuts, et ne supprime rien.</p>`
    : c.type === "piste"
    ? `<p class="ag-intro">L'agent de cette piste, avec son propre fil. Il lit la piste, ses contacts, ses tâches et ses échanges du Journal. Il range tes remarques (Prio, Taille, date de signature, tâche reliée à la piste, contact, mise en lien) et te montre chaque modification avec un bouton Annuler. L'étape et l'issue de la piste, il te les propose. Il ne touche jamais à Mes notes.</p>`
    : c.type === "echange"
    ? `<p class="ag-intro">L'agent de cet échange, avec son propre fil. Il lit l'échange et son compte rendu, ses contacts, sa piste et son projet. Il peut créer les actions qui en découlent (reliées à l'échange), une par une ou en un geste groupé que tu appliques. Il ne touche jamais à Mes notes ni aux statuts, et ne supprime rien.</p>`
    : c.type === "projet"
    ? `<p class="ag-intro">L'agent du projet lit ses échanges du Journal de bord et sa page Contexte. Il tient les champs marqués Agent (Météo, Motif météo, Retards des tiers, Synthèse agent) et peut ajouter un point à la page Contexte. En Question, il te propose la mise à jour ; réponds oui pour qu'il la fasse. Chaque modification s'affiche ici avec un bouton Annuler et est notée au Journal de l'agent du projet. Il ne touche jamais à Mes notes ni à l'état du projet.</p>`
    : `<p class="ag-intro">Un seul interlocuteur pour cette fiche. Il répond à tes questions et range tes remarques (champs, replanification, tâche, contact, mise en lien). Chaque modification s'affiche ici avec l'ancienne et la nouvelle valeur, et un bouton Annuler. Il ne touche jamais à Mes notes ni aux statuts, il te les propose.</p>`;
  const list = s.fil === null ? `<p class="small muted">Chargement du fil…</p>`
    : s.fil === "erreur" ? `<div class="banner">${ic("alert", "ic-sm")}<span>Fil indisponible pour l'instant. <button class="lnk" data-ag-relire="1">Réessayer</button></span></div>`
    : s.fil.length ? s.fil.map((e) => messageHTML(e, s)).join("")
    : `${intro}<div class="ag-sugg">${suggestions(c).map((t, n) => `<button class="chip" type="button" data-ag-sugg="${n}">${esc(t)}</button>`).join("")}</div>`;
  const live = s.busy ? `<div class="ag-m bot live" aria-live="polite"><p class="muted">${s.type === "livrable" ? "Enregistrement…" : "L'agent réfléchit…"}</p></div>` : "";
  const prog = s.prog ? `<p class="ag-note ag-prog" aria-live="polite">${esc(s.prog)}</p>` : "";
  void flot;
  return `<div class="ag" data-ag-fil="${esc(c.key)}">
    <div class="ag-top">${cumul}${modeBtn}</div>${sansCle}${plafond}
    <div class="ag-list" id="ag-list">${list}${live}${prog}</div>
    ${s.err ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(s.err)}</span></div>` : ""}
    <form class="ag-form on" data-ag-form="1">
      <div class="ag-int" role="group" aria-label="Type de message">${Object.entries(TYPES).map(([k, x]) => `<button type="button" class="chip" data-ag-type="${k}" aria-pressed="${s.type === k}">${ic(x.ic, "ic-sm")}${x.l}</button>`).join("")}</div>
      <label class="sr" for="ag-in">Ton message à l'agent</label>
      <textarea id="ag-in" rows="3" maxlength="4000" placeholder="${esc(TYPES[s.type].ph)}" ${s.busy ? "disabled" : ""}>${esc(s.draft)}</textarea>
      <div class="ag-foot"><span class="small muted ag-kbd">Ctrl + Entrée pour envoyer</span><button class="btn sm pri" type="submit" ${s.busy ? "disabled" : ""}>Envoyer</button></div>
    </form></div>`;
}

/** Panneau de la fiche quand le fil est dans la fenêtre flottante. */
function renvoiHTML() {
  return `<div class="ag-soon ag-ailleurs">${ic("float")}<div><p><b>Le fil Agent est dans la fenêtre flottante.</b> Il reste le même dans les deux modes.</p>
    <div class="ag-ailleurs-b"><button class="btn sm pri" type="button" data-ag-ouvrir="1">${ic("agent", "ic-sm")}${tel() ? "Ouvrir le fil" : "Montrer la fenêtre"}</button>
    <button class="btn sm" type="button" data-ag-mode="ancre">${ic("dock", "ic-sm")}Ancrer ici</button></div></div></div>`;
}

// ---------------------------------------------------------------------------------------------
// Peinture : choisit l'emplacement, puis écrit le fil sans perdre la saisie en cours.

function peindreDans(el, c, ou, keepFocus) {
  const s = st(c.key);
  const ta = $("#ag-in", el);
  const foc = keepFocus || (ta && document.activeElement === ta);
  const sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
  const l0 = $("#ag-list", el);
  const enBas = !l0 || l0.scrollTop + l0.clientHeight >= l0.scrollHeight - 40;
  const top = l0?.scrollTop ?? 0;
  el.innerHTML = filHTML(c, s, ou);
  const l = $("#ag-list", el); if (l) l.scrollTop = enBas ? l.scrollHeight : top;
  const t2 = $("#ag-in", el);
  if (t2 && foc && !t2.disabled) { t2.focus({ preventScroll: true }); if (sel) try { t2.setSelectionRange(...sel); } catch { /* */ } }
}

let geomFaite = false;
function paint(keepFocus = false) {
  const c = cible();
  const ou = placement(c);
  const side = sideHost();
  const agp = $("#agp");
  // En-tête du panneau de la fiche : agent de la fiche (toutes les fiches ont leur fil depuis le 26/11, soir).
  const h = document.querySelector("#dr-side #ag-h");
  if (h) h.textContent = c.type === "ecran" ? "Agent" : "Agent de la fiche";
  if (side) {
    if (ou === "side") { peindreDans(side, c, ou, keepFocus); charger(c); }
    else if (PREF.mode === "flottant") side.innerHTML = renvoiHTML();
    else side.innerHTML = "";
  }
  const montrer = ou === "agp";
  const etaitCache = agp.hidden;
  agp.hidden = !montrer;
  document.body.classList.toggle("agp-on", montrer);
  document.body.classList.toggle("agp-ancre", montrer && PREF.mode === "ancre" && !tel() && !drawerOuvert());
  agp.classList.toggle("flottant", PREF.mode === "flottant" && !tel());
  agp.classList.toggle("plein", tel());
  agp.classList.toggle("ancre", PREF.mode === "ancre" && !tel());
  if (montrer) {
    $("#agp-t").textContent = c.type === "ecran" ? "Agent" : "Agent de la fiche";
    $("#agp-ctx").textContent = c.fiche ? ($("#dr-body h1, #dr-body h2")?.textContent || "").trim().slice(0, 60) : ($(".top h1")?.textContent || "").trim();
    const mb = $("[data-agp-mode]");
    mb.hidden = tel();
    mb.innerHTML = ic(PREF.mode === "flottant" ? "dock" : "float");
    const lab = PREF.mode === "flottant" ? "Ancrer le panneau à droite" : "Passer en fenêtre flottante";
    mb.setAttribute("aria-label", lab); mb.title = lab;
    peindreDans($("#agp-b"), c, ou, keepFocus);
    charger(c);
    if (etaitCache || !geomFaite) placer();
  }
  for (const b of document.querySelectorAll("[data-act='agent']")) b.setAttribute("aria-pressed", String(montrer || ou === "side"));
  // La fiche se pose sur la zone de contenu (drFit) : un panneau ancré qui apparaît ou disparaît la change.
  window.dispatchEvent(new Event("cockpit:agent-place"));
}

async function charger(c, force = false) {
  const s = st(c.key);
  if (s.fil !== null && s.fil !== "erreur" && !force) return;
  if (s.charge) return;
  s.charge = true;
  try { const r = c.type === "ecran" ? await agentApi.filEcran(c.view) : await agentApi.fil(c.type, c.id); s.fil = r.fil; s.info = r; s.err = ""; }
  catch (e) { if (s.fil === null) s.fil = "erreur"; s.err = e.status ? e.message : ""; }
  s.charge = false;
  if (cible().key === c.key) paint();
}

/** Monté par renderSide (ui.js) à chaque redessin du panneau de droite de la fiche. */
function monter() { paint(); }

/** La fiche ou la liste a changé côté Notion (action de l'agent, annulation, geste groupé) : la vue la relit. */
const ficheModifiee = () => window.dispatchEvent(new CustomEvent("cockpit:fiche-modifiee"));

// ---------------------------------------------------------------------------------------------
// Gestes

async function envoyer() {
  const c = cible();
  const s = st(c.key);
  const t = ($("#ag-in")?.value ?? s.draft).trim();
  if (!t || s.busy) return;
  s.busy = true; s.err = ""; s.draft = t; paint(true);
  try {
    const r = c.type === "ecran" ? await agentApi.envoyerEcran(c.view, s.type, t, ecranCourant(c)) : await agentApi.envoyer(c.type, c.id, s.type, t);
    s.fil = r.fil; s.info = r; s.draft = "";
    if (r.ecrit) ficheModifiee();
  } catch (e) { s.err = e.message || "L'agent n'a pas pu répondre."; }
  s.busy = false;
  if (cible().key === c.key) paint(true);
}

async function geste(kind, id, genre) {
  const c = cible();
  if (kind === "annuler" && (genre === "creer_tache" || genre === "creer_contact")
    && !confirm(`Annuler cette création ? ${genre === "creer_tache" ? "La tâche" : "Le contact"} part dans la corbeille Notion (récupérable 30 jours).`)) return;
  const s = st(c.key);
  try {
    const r = kind === "annuler" ? await agentApi.annuler(id) : await agentApi.appliquer(id);
    s.fil = r.fil; s.info = r; s.err = "";
    toast(kind === "annuler" ? "Ancienne valeur remise dans Notion" : "Statut changé dans Notion");
    ficheModifiee();
  } catch (e) { toast(e.message, "err"); }
  if (cible().key === c.key) paint();
}

const groupeDe = (s, gid) => (Array.isArray(s.fil) ? s.fil : []).flatMap((e) => e.groupes || []).find((g) => g.id === gid);
const paquets = (a) => { const out = []; for (let i = 0; i < a.length; i += PAQUET) out.push(a.slice(i, i + PAQUET)); return out; };

/** Appliquer les lignes cochées, par paquets de 10 ; les lignes décochées sont écartées. */
async function appliquerGroupe(gid, toutEcarter = false) {
  const c = cible(), s = st(c.key);
  const g = groupeDe(s, gid); if (!g || s.prog) return;
  const prevues = g.lignes.filter((l) => l.statut === "prevue");
  const off = toutEcarter ? new Set(prevues.map((l) => l.id)) : DECOCHE.get(gid) ?? new Set();
  const on = prevues.filter((l) => !off.has(l.id)).map((l) => l.id), ecarter = prevues.filter((l) => off.has(l.id)).map((l) => l.id);
  if (toutEcarter && !confirm("Écarter ce geste groupé ? Rien ne sera écrit.")) return;
  let faites = 0, refus = 0;
  try {
    if (!on.length) {
      const r = await agentApi.groupe(gid, "appliquer", { lignes: [], ecarter });
      s.fil = r.fil; s.info = r;
    }
    for (const [n, p] of paquets(on).entries()) {
      s.prog = `Application dans Notion, ${Math.min(n * PAQUET, on.length)} sur ${on.length}…`; paint();
      const r = await agentApi.groupe(gid, "appliquer", { lignes: p, ecarter: n === 0 ? ecarter : [] });
      s.fil = r.fil; s.info = r;
      faites += r.resultats.filter((x) => x.statut === "faite").length; refus += r.resultats.filter((x) => x.statut === "refusee").length;
    }
    if (on.length) toast(`${faites} changement${faites > 1 ? "s" : ""} écrit${faites > 1 ? "s" : ""} dans Notion${refus ? `, ${refus} refusé${refus > 1 ? "s" : ""}` : ""}`, refus ? "err" : "");
    else toast("Geste groupé écarté, rien n'a été écrit");
  } catch (e) { toast(e.message, "err"); }
  s.prog = ""; DECOCHE.delete(gid);
  if (faites) ficheModifiee();
  if (cible().key === c.key) paint();
}

/** Tout annuler : les lignes appliquées reprennent leur ancienne valeur (créations à la corbeille). */
async function annulerGroupe(gid) {
  const c = cible(), s = st(c.key);
  const g = groupeDe(s, gid); if (!g || s.prog) return;
  const faites = g.lignes.filter((l) => l.statut === "faite");
  const crea = faites.filter((l) => l.genre === "creer_tache").length;
  if (!confirm(`Tout annuler ? ${faites.length} changement${faites.length > 1 ? "s" : ""} reprennent leur ancienne valeur dans Notion${crea ? `, et ${crea} tâche${crea > 1 ? "s" : ""} créée${crea > 1 ? "s" : ""} part${crea > 1 ? "ent" : ""} dans la corbeille (récupérable 30 jours)` : ""}.`)) return;
  let ok = 0; const err = [];
  try {
    for (const [n, p] of paquets(faites.map((l) => l.id)).entries()) {
      s.prog = `Annulation dans Notion, ${n * PAQUET} sur ${faites.length}…`; paint();
      const r = await agentApi.groupe(gid, "annuler", { lignes: p });
      s.fil = r.fil; s.info = r;
      ok += r.resultats.filter((x) => x.statut === "annulee").length;
      err.push(...r.resultats.filter((x) => x.erreur).map((x) => x.erreur));
    }
    toast(err.length ? `${ok} annulé${ok > 1 ? "s" : ""}, ${err.length} non annulé${err.length > 1 ? "s" : ""} : ${err[0]}` : `${ok} changement${ok > 1 ? "s" : ""} annulé${ok > 1 ? "s" : ""} dans Notion`, err.length ? "err" : "");
  } catch (e) { toast(e.message, "err"); }
  s.prog = "";
  ficheModifiee();
  if (cible().key === c.key) paint();
}

// ---------------------------------------------------------------------------------------------
// Panneau : ouvrir, fermer, changer de mode, déplacer, redimensionner, fermer d'un geste sur téléphone.

export function basculerAgent(force) {
  const c = cible();
  if (placement(c) === "side" && force === undefined) {
    // Fiche ouverte, fil ancré dans son panneau : on y mène (téléphone : sous la fiche).
    allerAuFil(); return;
  }
  const v = force ?? !ouvert();
  if (tel()) ouvertTel = v; else { PREF.ouvert = v; garder(); }
  paint(v);
  if (v) setTimeout(() => $("#agp #ag-in")?.focus({ preventScroll: true }), 30);
}

/** Bouton « Agent » de l'en-tête d'une fiche sur téléphone : vers le fil, où qu'il soit. */
export function allerAuFil() {
  if (PREF.mode === "flottant" || !sideHost()) { basculerAgent(true); return true; }
  const main = $("#dr-main"), side = $("#dr-side");
  if (main && side) main.scrollTo({ top: side.offsetTop - main.offsetTop, behavior: "smooth" });
  return true;
}

function changerMode(m) {
  PREF.mode = m; if (m === "flottant") { PREF.ouvert = true; if (tel()) ouvertTel = true; }
  garder(); geomFaite = false; paint();
}

const borne = (v, a, b) => Math.max(a, Math.min(b, v));
/** Fenêtre flottante : position et taille mémorisées, gardées dans l'écran. */
function placer() {
  const agp = $("#agp");
  geomFaite = true;
  if (!agp.classList.contains("flottant")) { agp.style.left = agp.style.top = agp.style.width = agp.style.height = ""; return; }
  const W = window.innerWidth, H = window.innerHeight;
  const f = PREF.fen || {};
  const w = borne(f.w || 440, 320, Math.max(320, W - 24)), h = borne(f.h || Math.min(640, H - 120), 300, Math.max(300, H - 24));
  const x = borne(f.x ?? W - w - 28, 8, Math.max(8, W - w - 8)), y = borne(f.y ?? H - h - 28, 8, Math.max(8, H - h - 8));
  Object.assign(agp.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
}
function noterGeom() {
  const agp = $("#agp");
  if (!agp.classList.contains("flottant") || agp.hidden) return;
  const r = agp.getBoundingClientRect();
  PREF.fen = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  garder();
}

function bindPanneau() {
  const agp = $("#agp"), h = $(".agp-h", agp);
  let drag = null;
  h.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || e.button > 0) return;
    const r = agp.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, dy: 0, tel: agp.classList.contains("plein") };
    if (!drag.tel && !agp.classList.contains("flottant")) { drag = null; return; }
    h.setPointerCapture(e.pointerId);
    agp.classList.add("drag");
  });
  h.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.tel) { drag.dy = Math.max(0, e.clientY - drag.y); agp.style.transform = `translateY(${drag.dy}px)`; return; }
    const W = window.innerWidth, H = window.innerHeight, r = agp.getBoundingClientRect();
    agp.style.left = borne(drag.l + e.clientX - drag.x, 8 - r.width + 80, W - 80) + "px";
    agp.style.top = borne(drag.t + e.clientY - drag.y, 8, H - 48) + "px";
  });
  const fin = () => {
    if (!drag) return;
    agp.classList.remove("drag");
    if (drag.tel) { agp.style.transform = ""; if (drag.dy > 90) basculerAgent(false); }
    else noterGeom();
    drag = null;
  };
  h.addEventListener("pointerup", fin); h.addEventListener("pointercancel", fin);
  // Redimensionnement (poignée native en bas à droite) : taille mémorisée.
  let t = null;
  new ResizeObserver(() => { if (agp.classList.contains("flottant") && !agp.classList.contains("drag")) { clearTimeout(t); t = setTimeout(noterGeom, 250); } }).observe(agp);
  agp.addEventListener("click", (e) => {
    if (e.target.closest("[data-agp-close]")) basculerAgent(false);
    else if (e.target.closest("[data-agp-mode]")) changerMode(PREF.mode === "flottant" ? "ancre" : "flottant");
  });
  agp.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.target.closest("textarea")) { e.stopPropagation(); basculerAgent(false); } });
}

// ---------------------------------------------------------------------------------------------
// Événements du fil, où qu'il soit (panneau de la fiche ou panneau #agp).

function bindFil(root) {
  root.addEventListener("click", (e) => {
    if (!e.target.closest(".ag, .ag-ailleurs")) return;
    const c = cible(), s = st(c.key);
    const md = e.target.closest("[data-ag-mode]");
    if (md) { changerMode(md.dataset.agMode); return; }
    if (e.target.closest("[data-ag-ouvrir]")) { basculerAgent(true); return; }
    const ty = e.target.closest("[data-ag-type]");
    if (ty) { s.draft = $("#ag-in")?.value ?? s.draft; s.type = ty.dataset.agType; paint(true); return; }
    const sg = e.target.closest("[data-ag-sugg]");
    if (sg) { s.type = "question"; s.draft = suggestions(c)[Number(sg.dataset.agSugg)]; paint(true); return; }
    const an = e.target.closest("[data-ag-annuler]");
    if (an) { geste("annuler", an.dataset.agAnnuler, an.dataset.genre); return; }
    const ap = e.target.closest("[data-ag-appliquer]");
    if (ap) { geste("appliquer", ap.dataset.agAppliquer); return; }
    const ga = e.target.closest("[data-grp-appliquer]");
    if (ga) { appliquerGroupe(Number(ga.dataset.grpAppliquer)); return; }
    const ge = e.target.closest("[data-grp-ecarter]");
    if (ge) { appliquerGroupe(Number(ge.dataset.grpEcarter), true); return; }
    const gu = e.target.closest("[data-grp-annuler]");
    if (gu) { annulerGroupe(Number(gu.dataset.grpAnnuler)); return; }
    const gt = e.target.closest("[data-grp-tout]");
    if (gt) {
      const gid = Number(gt.dataset.grpTout), g = groupeDe(s, gid);
      const prevues = (g?.lignes || []).filter((l) => l.statut === "prevue").map((l) => l.id);
      const off = DECOCHE.get(gid) ?? new Set();
      DECOCHE.set(gid, off.size ? new Set() : new Set(prevues));
      paint(); return;
    }
    if (e.target.closest("[data-ag-relire]")) { s.fil = null; paint(); charger(c, true); }
  });
  root.addEventListener("change", (e) => {
    const ck = e.target.closest("[data-grp-ligne]");
    if (!ck) return;
    const [gid, lid] = ck.dataset.grpLigne.split(":").map(Number);
    const off = DECOCHE.get(gid) ?? new Set();
    if (ck.checked) off.delete(lid); else off.add(lid);
    DECOCHE.set(gid, off);
    paint();
  });
  root.addEventListener("input", (e) => { if (e.target.id === "ag-in") st(cible().key).draft = e.target.value; });
  root.addEventListener("submit", (e) => { if (e.target.closest("[data-ag-form]")) { e.preventDefault(); envoyer(); } });
  root.addEventListener("keydown", (e) => { if (e.target.id === "ag-in" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); envoyer(); } });
}

/** Branché par app.js sur le panneau de droite de la fiche ; le panneau #agp est branché ici. */
export function bindAgent(side) { bindFil(side); }

bindFil($("#agp-b"));
bindPanneau();
setAgentHook(monter);
// Changement d'écran ou de fiche : après la navigation de app.js (même événement, écouteur suivant).
window.addEventListener("hashchange", () => { if (tel()) ouvertTel = false; setTimeout(() => paint(), 0); });
let large = !tel();
window.addEventListener("resize", () => {
  const l = !tel();
  if (l !== large) { large = l; geomFaite = false; paint(); }
  else if (!$("#agp").hidden && $("#agp").classList.contains("flottant")) placer();
});
// L'écran a été redessiné (shell) : le bouton Agent de l'en-tête reprend son état.
window.addEventListener("cockpit:vue", () => paint());

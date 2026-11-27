// Panneau Agent (lots 3 et 3 bis).
//
// Lot 3 : fil Agent des fiches Contact et Tâche, dans le panneau de droite de la fiche, sous Mes notes.
// Lot 3 bis : agent d'écran, disponible sur chaque écran (Ma journée, Vue d'ensemble, Pistes, Contacts, Réseau,
// Journal, Projets, Actions). La fiche projet a son agent de fiche (27/11/2026) : il lit les échanges du projet et
// sa page Contexte, et tient les champs Agent.
// Fils séparés (26/11/2026, soir) : chaque fiche (contact, tâche, projet, piste, échange du Journal) et chaque écran
// a son propre fil, comme dans l'artefact (une session par fiche et par page). Un message d'écran part avec la
// description de l'écran ouvert (ce qu'il affiche, filtres compris), que la fonction relit dans le miroir.
// Saisie directe (26/11/2026) : l'agent écrit directement, statuts et plusieurs fiches compris, avec une ligne et
// un Annuler par fiche et par champ. Gestes groupés seulement si Jean-Baptiste veut voir la liste avant.
//
// Mémoire dans la fiche (27/11/2026, artefact 8f56) : l'agent lit et écrit le corps de la fiche Notion (sections de sa
// mémoire, Journal de l'agent). Boutons du fil : Clore et Agent neuf sur une fiche, Nouveau fil sur un écran, quand le
// fil a des messages ; Arrêter pendant un échange (la boucle d'outils s'arrête au tour suivant, ce qui est écrit reste).
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
// masque (27/11/2026) : agent de la fiche masqué sur ordinateur, la fiche prend toute la largeur.
const PREF = { mode: "ancre", ouvert: false, fen: null, masque: false };
try { Object.assign(PREF, JSON.parse(localStorage.getItem(PREF_CLE) || "{}")); } catch { /* stockage indisponible */ }
if (!["ancre", "flottant"].includes(PREF.mode)) PREF.mode = "ancre";
const garder = () => { try { localStorage.setItem(PREF_CLE, JSON.stringify(PREF)); } catch { /* */ } };
const tel = () => window.matchMedia("(max-width: 900px)").matches;
// Fiche étroite sur téléphone : la bascule Fiche / Agent de l'en-tête est affichée (panneau sous la fiche).
const etroite = () => { const sg = document.querySelector("#dr-seg"); return tel() && !!sg && getComputedStyle(sg).display !== "none"; };
// Sur téléphone le panneau plein écran ne se rouvre jamais tout seul : son ouverture n'est pas mémorisée.
let ouvertTel = false;
const ouvert = () => (tel() ? ouvertTel : !!PREF.ouvert);

// ---------------------------------------------------------------------------------------------
// État par fil : clé = identifiant de la fiche, ou « ecran:<vue> » pour le fil d'un écran.
const F = new Map();
const st = (k) => F.get(k) ?? F.set(k, { fil: null, info: null, busy: false, err: "", draft: "", type: "question", prog: "", attente: "", arret: false, enCours: null, etapes: [] }).get(k);
// Étapes en direct (27/11/2026) : gardées par réponse de l'agent, repliées sous « N étapes » (le temps de la session).
const ETAPES = new Map();
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

/** Fiche ouverte sur ordinateur, avec son agent : le bouton Agent de la fiche le masque ou l'affiche. */
const ficheBureau = () => drawerOuvert() && !!sideHost() && !tel();

/** Où va le fil : dans le panneau de la fiche (ancré, fiche ouverte), dans le panneau #agp, ou nulle part. */
function placement(c) {
  const side = sideHost();
  // Ordinateur, fiche ouverte (27/11/2026) : masqué, ancré dans la colonne de la fiche, ou en fenêtre flottante
  // au-dessus de la fiche (la colonne disparaît alors, la fiche prend toute la largeur).
  if (ficheBureau()) return PREF.masque ? null : PREF.mode === "ancre" ? "side" : "agp";
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

const ESTID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const val = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) ? "vide" : Array.isArray(v) ? (v.every((x) => ESTID.test(String(x))) ? `${v.length} lien${v.length > 1 ? "s" : ""}` : v.join(", ")) : v === true ? "oui" : v === false ? "non" : /^\d{4}-\d\d-\d\d$/.test(String(v)) ? fd(String(v)) : /^\d{4}-\d\d-\d\dT/.test(String(v)) ? fd(String(v).slice(0, 10)) : String(v).length > 80 ? String(v).slice(0, 80) + "…" : String(v);
const lien = (a) => a.cible_id ? `<a href="#/${["todo", "projets", "pistes", "journal"].includes(a.cible_base) ? a.cible_base : "contacts"}/${esc(a.cible_id)}">${esc(a.cible_nom || "la fiche")}</a>` : esc(a.cible_nom || "");
const diff = (a) => `<span class="ag-diff"><del>${esc(val(a.ancienne))}</del> ${ic("arrow", "ic-sm")} <ins>${esc(val(a.nouvelle))}</ins></span>`;

function actionHTML(a) {
  let quoi;
  if (a.genre === "modifier") {
    const rel = [a.ancienne, a.nouvelle].some((v) => Array.isArray(v) && v.length && v.every((x) => ESTID.test(String(x))));
    quoi = `<b>${esc(a.propriete)}</b> de ${lien(a)}${rel ? ` : liens modifiés (${val(a.ancienne)} → ${val(a.nouvelle)})` : diff(a)}`;
  } else if (a.genre === "creer_tache") quoi = `Tâche créée : ${lien(a)}`;
  else if (a.genre === "creer_contact") quoi = `Contact créé : ${lien(a)}`;
  else if (a.genre === "corps") {
    const n = a.nouvelle || {};
    quoi = `${n.op === "remplacer" ? "Réécrit" : "Ajouté"} dans <b>${esc(a.propriete || "le corps")}</b> de ${lien(a)} : <span class="ag-diff">${n.op === "remplacer" ? `<del>${esc(val(n.avant))}</del> ${ic("arrow", "ic-sm")} ` : ""}<ins>${esc(val(n.texte))}</ins></span>`;
  }
  else if (a.genre === "ajouter_contexte") quoi = `Ajouté à la ${esc(a.propriete || "page Contexte")} de ${lien(a)} : <span class="ag-diff"><ins>${esc(val(a.nouvelle))}</ins></span>`;
  else if (a.genre === "relier") {
    const e = a.nouvelle?.etapes || {};
    const et = (x, nom) => x ? `<br><small>${esc(nom)}</small><span class="ag-diff"><del>${esc(val(x.avant))}</del> ${ic("arrow", "ic-sm")} <ins>${esc(val(x.apres))}</ins></span>` : "";
    quoi = `Mise en lien : ${esc(a.nouvelle?.recommandeurNom || "un contact")} a recommandé ${lien(a)}${et(e.recommande, a.nouvelle?.recommandeNom || a.cible_nom || "Recommandé")}${et(e.recommandeur, a.nouvelle?.recommandeurNom || "Recommandeur")}`;
  }
  else quoi = `Proposé : <b>${esc(a.propriete)}</b> de ${lien(a)}${diff(a)}`;
  const btn = a.statut === "faite" && ["modifier", "creer_tache", "creer_contact", "relier", "corps"].includes(a.genre)
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
  return `<div class="ag-m bot ${e.statut === "erreur" ? "err" : ""} ${e.statut === "arrete" ? "arrete" : ""} ${grps ? "wide" : ""}">${etapesRepliees(ETAPES.get(e.id))}${texte(e.texte)}${acts}${grps}${cost}</div>`;
}

/** Étapes : en direct pendant l'échange (la dernière en cours clignote), repliées après la réponse. */
const etapeLi = (e, cur) => `<li class="${e.ecrit ? "ok" : ""}${e.fin && e.ok === false ? " ko" : ""}${cur ? " cur" : ""}"><i aria-hidden="true"></i><span>${esc(e.t || "Étape de l'agent")}</span></li>`;
const etapesRepliees = (l) => l?.length ? `<details class="ag-steps"><summary>${l.length} étape${l.length > 1 ? "s" : ""}</summary><ol>${l.map((e) => etapeLi(e)).join("")}</ol></details>` : "";
function liveHTML(s) {
  const l = s.etapes || [];
  const enCours = l.length && !l[l.length - 1].fin ? l.length - 1 : -1;
  const msg = s.arret ? "Arrêt demandé, l'agent s'arrête au tour suivant…" : s.attente && s.attente !== "enreg" ? s.attente : s.type === "livrable" && s.attente === "enreg" ? "Enregistrement…" : "L'agent réfléchit…";
  return `${l.length ? `<ol class="ag-live-steps">${l.map((e, k) => etapeLi(e, k === enCours)).join("")}</ol>` : ""}<p class="ag-think"><span class="ag-dots" aria-hidden="true"><i></i><i></i><i></i></span>${esc(msg)}</p>`;
}
/** Le message de Jean-Baptiste, affiché dès l'envoi, avant la réponse du serveur. */
const enCoursHTML = (s) => s.enCours ? messageHTML({ auteur: "jb", type_message: s.enCours.type, texte: s.enCours.texte, ecran: s.enCours.ecran, cree_le: s.enCours.cree_le }, s) : "";

const suggestions = (c) => c.type !== "ecran" ? SUGG[c.type] || SUGG.autre : SUGG[c.view] || SUGG.autre;

function filHTML(c, s, ou) {
  const i = s.info;
  const flot = PREF.mode === "flottant";
  // Ordinateur : les boutons Fenêtre et Masquer sont dans l'en-tête du panneau (ui.js) ; téléphone inchangé.
  const modeBtn = ou === "side" && tel()
    ? `<button class="btn sm ghost ag-mode" type="button" data-ag-mode="flottant" title="Afficher le fil dans une fenêtre flottante">${ic("float", "ic-sm")}Fenêtre</button>`
    : "";
  const cumul = i ? `<span class="chip ag-cumul" title="Jetons et coût estimé ce mois, tous fils confondus. Plafond réglé côté serveur.">Ce mois ${nb(i.cumul.jetons)} jetons · ${usd(i.cumul.cout_usd)} sur ${usd(i.plafondUsd)}</span>` : "";
  const sansCle = i && !i.cle ? `<div class="banner info ag-cle">${ic("info", "ic-sm")}<span>L'agent attend sa clé API Anthropic. Tu peux déjà écrire : tes messages sont gardés et les demandes de livrable sont enregistrées.</span></div>` : "";
  const plafond = i && i.cle && i.cumul.cout_usd >= i.plafondUsd ? `<div class="banner ag-cle">${ic("alert", "ic-sm")}<span>Plafond du mois atteint : l'agent ne répond plus jusqu'au mois prochain.</span></div>` : "";
  const intro = c.type === "ecran"
    ? `<p class="ag-intro">L'agent de cet écran, avec son propre fil. Il voit ce que l'écran affiche, avec ses filtres, et répond aux questions qui traversent plusieurs fiches. Il écrit directement autant de fiches que ta demande en touche, statuts compris, avec une ligne et un bouton Annuler par fiche et par champ. Si tu veux voir la liste avant, demande-le, il te la montre et rien n'est écrit avant Appliquer. Il ne touche jamais à Mes notes et ne supprime rien.</p>`
    : c.type === "piste"
    ? `<p class="ag-intro">L'agent de cette piste, avec son propre fil. Il lit la piste, ses contacts, ses tâches et ses échanges du Journal. Il range tes remarques (étape, issue, Prio, Taille, date de signature, tâche reliée à la piste, contact, mise en lien) et te montre chaque modification avec un bouton Annuler. Sa mémoire est la Synthèse agent et le Journal de l'agent en fin de page. Il n'écrit pas ailleurs dans le corps de la page, ni dans Mes notes.</p>`
    : c.type === "echange"
    ? `<p class="ag-intro">L'agent de cet échange, avec son propre fil. Il lit l'échange et son compte rendu, ses contacts, sa piste et son projet. Il peut créer les actions qui en découlent (reliées à l'échange), rattacher l'échange à un projet, une piste ou un contact, et écrire ses champs. Chaque modification s'affiche avec un bouton Annuler. Il ne touche jamais à Mes notes et ne supprime rien.</p>`
    : c.type === "projet"
    ? `<p class="ag-intro">L'agent du projet lit ses échanges du Journal de bord et sa page Contexte. Il écrit les champs du projet (état, météo, prochain jalon et sa date, retards des tiers, synthèse) et peut ajouter un point à la page Contexte. En Question, il te propose la mise à jour ; réponds oui pour qu'il la fasse. Chaque modification s'affiche ici avec un bouton Annuler et est notée au Journal de l'agent du projet. Il n'écrit pas ailleurs dans le corps de la page, ni dans Mes notes.</p>`
    : `<p class="ag-intro">Un seul interlocuteur pour cette fiche. Il répond à tes questions et range tes remarques (champs, statut, replanification, tâche, contact, mise en lien). Sa mémoire est la fiche Notion elle-même, ${c.type === "contact" ? "sections Relation, Liens, Engagements en cours, Fil des échanges" : "sections État actuel, Décisions, Livrables"} et Journal de l'agent. Chaque modification s'affiche ici avec un bouton Annuler. Clore met la fiche à jour, Agent neuf repart d'un fil vide. Il ne touche jamais à Mes notes et ne supprime rien.</p>`;
  const list = s.fil === null ? `<p class="small muted">Chargement du fil…</p>`
    : s.fil === "erreur" ? `<div class="banner">${ic("alert", "ic-sm")}<span>Fil indisponible pour l'instant. <button class="lnk" data-ag-relire="1">Réessayer</button></span></div>`
    : s.fil.length || s.enCours ? s.fil.map((e) => messageHTML(e, s)).join("")
    : `${intro}<div class="ag-sugg">${suggestions(c).map((t, n) => `<button class="chip" type="button" data-ag-sugg="${n}">${esc(t)}</button>`).join("")}</div>`;
  const live = s.busy ? `${enCoursHTML(s)}<div class="ag-m bot live" data-ag-live aria-live="polite">${liveHTML(s)}</div>` : "";
  // Clore, Agent neuf (fiche) ou Nouveau fil (écran) : quand le fil a des messages et n'est pas occupé.
  const aDesMessages = Array.isArray(s.fil) && s.fil.some((e) => e.auteur !== "note");
  const outils = aDesMessages && !s.busy && !s.prog ? (c.type === "ecran"
    ? `<span class="ag-tools"><button class="btn sm ghost" type="button" data-ag-nouveau="1" title="Repart d'un fil vide">${ic("reset", "ic-sm")}Nouveau fil</button></span>`
    : `<span class="ag-tools"><button class="btn sm ghost" type="button" data-ag-clore="clore" title="Met à jour la mémoire de la fiche, la synthèse et la dernière session">${ic("check", "ic-sm")}Clore</button><button class="btn sm ghost" type="button" data-ag-clore="neuf" title="Consolide la fiche puis repart avec un agent neuf">${ic("reset", "ic-sm")}Agent neuf</button></span>`) : "";
  const prog = s.prog ? `<p class="ag-note ag-prog" aria-live="polite">${esc(s.prog)}</p>` : "";
  void flot;
  return `<div class="ag" data-ag-fil="${esc(c.key)}">
    <div class="ag-top">${outils}${cumul}${modeBtn}</div>${sansCle}${plafond}
    <div class="ag-list" id="ag-list">${list}${live}${prog}</div>
    ${s.err ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(s.err)}</span></div>` : ""}
    <form class="ag-form on" data-ag-form="1">
      <div class="ag-int" role="group" aria-label="Type de message">${Object.entries(TYPES).map(([k, x]) => `<button type="button" class="chip" data-ag-type="${k}" aria-pressed="${s.type === k}">${ic(x.ic, "ic-sm")}${x.l}</button>`).join("")}</div>
      <label class="sr" for="ag-in">Ton message à l'agent</label>
      <textarea id="ag-in" rows="${tel() ? 1 : 3}" maxlength="4000" placeholder="${esc(tel() ? `${TYPES[s.type].l} pour l'agent` : TYPES[s.type].ph)}" ${s.busy ? "disabled" : ""}>${esc(s.draft)}</textarea>
      <div class="ag-foot">${tel() ? "" : `<span class="small muted ag-kbd">Ctrl + Entrée pour envoyer</span>`}${s.busy && s.attente !== "enreg" ? `<button class="btn sm" type="button" data-ag-arreter="1" ${s.arret ? "disabled" : ""}>${ic("close", "ic-sm")}Arrêter</button>` : `<button class="btn sm pri" type="submit" ${s.busy ? "disabled" : ""}>Envoyer</button>`}</div>
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

function peindreDans(el, c, ou, keepFocus, avant = "") {
  const s = st(c.key);
  const ta = $("#ag-in", el);
  const foc = keepFocus || (ta && document.activeElement === ta);
  const sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
  const l0 = $("#ag-list", el);
  const enBas = !l0 || l0.scrollTop + l0.clientHeight >= l0.scrollHeight - 40;
  const top = l0?.scrollTop ?? 0;
  el.innerHTML = avant + filHTML(c, s, ou);
  const l = $("#ag-list", el); if (l) l.scrollTop = enBas ? l.scrollHeight : top;
  const t2 = $("#ag-in", el);
  if (t2) grandir(t2);
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
    else if (PREF.mode === "flottant" && tel()) side.innerHTML = renvoiHTML();
    else side.innerHTML = "";
  }
  // Ordinateur : agent masqué (la fiche prend toute la largeur) ou flottant (aucune colonne réservée).
  const d = $("#drawer"), fb = ficheBureau();
  d.classList.toggle("ag-off", fb && PREF.masque);
  d.classList.toggle("ag-float", fb && !PREF.masque && PREF.mode === "flottant");
  const da = $("#dr-ag");
  if (da) {
    da.hidden = !fb;
    da.setAttribute("aria-pressed", String(fb && !PREF.masque));
    const t = PREF.masque ? "Afficher l'agent de la fiche" : "Masquer l'agent de la fiche"; da.title = t; da.setAttribute("aria-label", t);
  }
  for (const b of document.querySelectorAll("#dr-side [data-ag-win='mode']")) {
    const l = PREF.mode === "flottant" ? "Ancrer l'agent à droite" : "Détacher l'agent en fenêtre flottante";
    b.innerHTML = ic(PREF.mode === "flottant" ? "dock" : "float", "ic-sm"); b.title = l; b.setAttribute("aria-label", l);
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
    // Fiche en fenêtre flottante : la carte Agent de production de la fiche suit le fil.
    const prod = c.fiche && fb ? $("#dr-side .ag-prod")?.outerHTML ?? "" : "";
    peindreDans($("#agp-b"), c, ou, keepFocus, prod);
    charger(c);
    if (etaitCache || !geomFaite) placer();
  }
  for (const b of document.querySelectorAll("[data-act='agent']")) b.setAttribute("aria-pressed", String(montrer || ou === "side"));
  // La fiche se pose sur la zone de contenu (drFit) : un panneau ancré qui apparaît ou disparaît la change.
  window.dispatchEvent(new Event("cockpit:agent-place"));
}

async function charger(c, force = false, garderErreur = false) {
  const s = st(c.key);
  if (s.fil !== null && s.fil !== "erreur" && !force) return;
  if (s.charge) return;
  s.charge = true;
  try { const r = c.type === "ecran" ? await agentApi.filEcran(c.view) : await agentApi.fil(c.type, c.id); s.fil = r.fil; s.info = r; if (!garderErreur) s.err = ""; }
  catch (e) { if (s.fil === null) s.fil = "erreur"; if (!garderErreur) s.err = e.status ? e.message : ""; }
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
  // Comme un chat (27/11/2026) : la saisie se vide et le message s'affiche tout de suite, suivi des étapes de
  // l'agent au fur et à mesure. Si l'échange échoue, le texte revient dans la saisie.
  const type = s.type, ecran = c.type === "ecran" ? ecranCourant(c) : null;
  s.busy = true; s.arret = false; s.attente = type === "livrable" ? "enreg" : ""; s.err = ""; s.draft = "";
  s.enCours = { texte: t, type, ecran: ecran?.titre && c.type === "ecran" ? ecran.titre : null, cree_le: new Date().toISOString() };
  s.etapes = [];
  if (Array.isArray(s.fil) === false) s.fil = [];
  for (const ta of document.querySelectorAll("#ag-in")) ta.value = "";
  paint(true);
  const onEtape = etapeRecue(c, s);
  let echec = false;
  try {
    const r = c.type === "ecran" ? await agentApi.envoyerEcran(c.view, type, t, ecran, onEtape) : await agentApi.envoyer(c.type, c.id, type, t, onEtape);
    s.fil = r.fil; s.info = r;
    if (r.reponse?.id && s.etapes.length) ETAPES.set(r.reponse.id, s.etapes.slice());
    if (r.reponse?.statut === "erreur") echec = true;
    if (r.ecrit) ficheModifiee();
  } catch (e) { s.err = e.message || "L'agent n'a pas pu répondre."; echec = true; }
  // Échec : le texte revient dans la saisie (s'il n'a pas déjà été remplacé), avec son type.
  if (echec && !s.draft) { s.draft = t; s.type = type; }
  s.busy = false; s.arret = false; s.attente = ""; s.enCours = null; s.etapes = [];
  if (cible().key === c.key) paint(true);
  // Le serveur a pu garder la demande avant l'échec : le fil est relu pour l'afficher tel qu'il est.
  if (echec) charger(c, true, true);
}

/** Une étape reçue du serveur : seule la bulle en direct est redessinée, la saisie n'est pas touchée. */
function etapeRecue(c, s) {
  return (e) => {
    const k = s.etapes.findIndex((x) => x.n === e.n);
    if (k >= 0) s.etapes[k] = { ...s.etapes[k], ...e, t: e.t || s.etapes[k].t };
    else s.etapes.push(e);
    if (cible().key !== c.key) return;
    for (const el of document.querySelectorAll("[data-ag-live]")) {
      const l = el.closest(".ag-list");
      const enBas = !l || l.scrollTop + l.clientHeight >= l.scrollHeight - 60;
      el.innerHTML = liveHTML(s);
      if (l && enBas) l.scrollTop = l.scrollHeight;
    }
  };
}

/** Clore ou Agent neuf (fiche) : l'agent consolide la fiche, puis le fil dit que la fiche est à jour (ou repart vide). */
async function cloreFil(neuf) {
  const c = cible(), s = st(c.key);
  if (s.busy || c.type === "ecran") return;
  s.busy = true; s.arret = false; s.err = ""; s.attente = neuf ? "Consolidation de la fiche avant de passer le relais à un agent neuf…" : "Clôture de la session, l'agent met la fiche à jour…"; s.etapes = []; paint();
  try {
    const r = await agentApi.clore(c.type, c.id, neuf, etapeRecue(c, s));
    s.fil = r.fil; s.info = r;
    if (r.reponse?.id && s.etapes.length) ETAPES.set(r.reponse.id, s.etapes.slice());
    if (r.ecrit) ficheModifiee();
  } catch (e) { s.err = e.message || "La clôture n'a pas abouti."; }
  s.busy = false; s.arret = false; s.attente = ""; s.etapes = [];
  if (cible().key === c.key) paint();
}

/** Écran : Nouveau fil, sans consolidation. */
async function nouveauFil() {
  const c = cible(), s = st(c.key);
  if (s.busy || c.type !== "ecran") return;
  try { const r = await agentApi.nouveauFil(c.view); s.fil = r.fil; s.info = r; s.err = ""; } catch (e) { toast(e.message, "err"); }
  if (cible().key === c.key) paint();
}

/** Arrêter : l'échange en cours s'arrête au tour suivant ; ce qui est déjà écrit reste, avec ses Annuler. */
async function arreter() {
  const c = cible(), s = st(c.key);
  if (!s.busy || s.arret) return;
  s.arret = true; paint();
  try { await agentApi.arreter(c.type === "ecran" ? "ecran" : c.type, c.type === "ecran" ? c.view : c.id); }
  catch (e) { s.arret = false; toast(e.message, "err"); paint(); }
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
  // Ordinateur, fiche ouverte : afficher ou masquer l'agent de la fiche, choix gardé (27/11/2026).
  if (ficheBureau()) {
    const montrer = force ?? PREF.masque;
    PREF.masque = !montrer; garder(); paint(montrer);
    if (montrer) setTimeout(() => { const t = $(PREF.mode === "flottant" ? "#agp #ag-in" : "#dr-side #ag-in"); t?.focus({ preventScroll: true }); const l = t?.closest(".ag")?.querySelector(".ag-list"); if (l) l.scrollTop = l.scrollHeight; }, 30);
    return;
  }
  if (placement(c) === "side" && force === undefined && tel() && $("#drawer").classList.contains("side-on")) { vueAgent(false); return; }
  if (placement(c) === "side" && force === undefined) {
    // Fiche ouverte, fil ancré dans son panneau : on y mène (téléphone : sous la fiche).
    allerAuFil(); return;
  }
  const v = force ?? !ouvert();
  if (tel()) ouvertTel = v; else { PREF.ouvert = v; garder(); }
  paint(v && !tel());
  // Sur téléphone, pas de mise au point d'office : le clavier cacherait la conversation qu'on vient d'ouvrir.
  if (v && !tel()) setTimeout(() => $("#agp #ag-in")?.focus({ preventScroll: true }), 30);
}

/** Bouton « Agent » de l'en-tête d'une fiche sur téléphone : vers le fil, où qu'il soit. */
export function allerAuFil() {
  if (ficheBureau() && PREF.masque) { basculerAgent(true); return true; }
  if (PREF.mode === "flottant" || !sideHost()) { basculerAgent(true); return true; }
  // Téléphone (27/11/2026, artefact 8f56) : la fiche laisse toute la place au fil, Mes notes est masqué.
  if (etroite()) { vueAgent(true); return true; }
  const main = $("#dr-main"), side = $("#dr-side");
  if (main && side) main.scrollTo({ top: side.offsetTop - main.offsetTop, behavior: "smooth" });
  return true;
}

/** Téléphone : bascule de la fiche entre son contenu et le fil Agent plein cadre (bouton Fiche / Agent de l'en-tête). */
export function vueAgent(on) {
  const d = $("#drawer");
  d.classList.toggle("side-on", !!on && etroite());
  for (const b of document.querySelectorAll("#dr-seg button")) b.setAttribute("aria-pressed", String((b.dataset.act === "drside") === d.classList.contains("side-on")));
  if (on) { const l = $("#dr-side .ag-list"); if (l) l.scrollTop = l.scrollHeight; }
}

// ---------------------------------------------------------------------------------------------
// Téléphone (27/11/2026, artefact 8f56) : la saisie tient sur une ligne et grandit avec le texte jusqu'à environ
// cinq lignes, puis défile. Clavier ouvert, la barre d'onglets s'efface et la fiche ou le panneau Agent occupe la
// zone visible (visualViewport), la saisie juste au-dessus du clavier. Entrée fait un retour à la ligne.
const MAX_LIGNES = 5;
function grandir(t) {
  if (!tel()) { t.style.height = ""; return; }
  const cs = getComputedStyle(t);
  const lh = parseFloat(cs.lineHeight) || 23;
  const bord = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const max = Math.round(lh * MAX_LIGNES + bord);
  t.style.height = "auto";
  const h = Math.min(t.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), max);
  t.style.height = h + "px";
  t.style.overflowY = t.scrollHeight + 2 > max ? "auto" : "hidden";
}
const estSaisie = (t) => t?.id === "ag-in" && !!t.closest?.(".ag-form");
function zoneVisible() {
  const r = document.documentElement.style, vv = window.visualViewport;
  const tb = document.querySelector("#tabbar");
  if (tb && !document.body.classList.contains("ag-typing")) r.setProperty("--tb-h", (tb.offsetHeight || 0) + "px");
  if (!vv) return;
  r.setProperty("--vv-h", Math.round(vv.height) + "px");
  r.setProperty("--vv-t", Math.round(vv.offsetTop) + "px");
}
document.addEventListener("focusin", (e) => {
  if (!tel() || !estSaisie(e.target)) return;
  zoneVisible();
  document.body.classList.add("ag-typing");
  if (e.target.closest("#dr-side") && etroite() && !$("#drawer").classList.contains("side-on")) vueAgent(true);
  grandir(e.target);
  const l = e.target.closest(".ag")?.querySelector(".ag-list");
  if (l) setTimeout(() => { l.scrollTop = l.scrollHeight; }, 250);
});
document.addEventListener("focusout", (e) => {
  if (!estSaisie(e.target)) return;
  setTimeout(() => { if (!estSaisie(document.activeElement)) { document.body.classList.remove("ag-typing"); zoneVisible(); } }, 200);
});
if (window.visualViewport) { visualViewport.addEventListener("resize", zoneVisible); visualViewport.addEventListener("scroll", zoneVisible); }

function changerMode(m) {
  PREF.mode = m; if (m === "flottant") { PREF.ouvert = true; if (tel()) ouvertTel = true; }
  if (ficheBureau()) PREF.masque = false;
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
    const cl = e.target.closest("[data-ag-clore]");
    if (cl) { cloreFil(cl.dataset.agClore === "neuf"); return; }
    if (e.target.closest("[data-ag-nouveau]")) { nouveauFil(); return; }
    if (e.target.closest("[data-ag-arreter]")) { arreter(); return; }
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
  root.addEventListener("input", (e) => { if (e.target.id === "ag-in") { st(cible().key).draft = e.target.value; grandir(e.target); } });
  root.addEventListener("submit", (e) => { if (e.target.closest("[data-ag-form]")) { e.preventDefault(); envoyer(); } });
  root.addEventListener("keydown", (e) => { if (e.target.id === "ag-in" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); envoyer(); } });
}

/** Branché par app.js sur le panneau de droite de la fiche ; le panneau #agp est branché ici. */
export function bindAgent(side) { bindFil(side); }

bindFil($("#agp-b"));
bindPanneau();
// En-tête du panneau de la fiche (ordinateur) : Fenêtre ou Ancrer, Masquer ; bouton Agent de l'en-tête de la fiche.
document.addEventListener("click", (e) => {
  const w = e.target.closest?.("[data-ag-win]");
  if (w) { if (w.dataset.agWin === "mode") changerMode(PREF.mode === "flottant" ? "ancre" : "flottant"); else basculerAgent(false); return; }
  if (e.target.closest?.("#dr-ag")) basculerAgent();
});
setAgentHook(monter);
// Changement d'écran ou de fiche : après la navigation de app.js (même événement, écouteur suivant).
// Téléphone : une autre fiche (ou la fermeture) repart sur le contenu de la fiche, pas sur le fil.
let ficheVue = (location.hash || "").split("/")[2] || "";
window.addEventListener("hashchange", () => {
  if (tel()) ouvertTel = false;
  const f = (location.hash || "").split("/")[2] || "";
  if (f !== ficheVue) { ficheVue = f; $("#drawer").classList.remove("side-on"); }
  setTimeout(() => paint(), 0);
});
let large = !tel();
window.addEventListener("resize", () => {
  const l = !tel();
  zoneVisible();
  if (l !== large) { large = l; geomFaite = false; if (l) { $("#drawer").classList.remove("side-on"); document.body.classList.remove("ag-typing"); } paint(); }
  else if (!$("#agp").hidden && $("#agp").classList.contains("flottant")) placer();
});
// L'écran a été redessiné (shell) : le bouton Agent de l'en-tête reprend son état.
window.addEventListener("cockpit:vue", () => { zoneVisible(); paint(); });

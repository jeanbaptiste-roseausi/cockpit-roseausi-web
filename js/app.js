// Point d'entrée : connexion, navigation par adresse, fiche plein écran, recherche globale.
// Adresses : #/contacts, #/contacts/<id>, #/todo, #/todo/<id>, #/todo/new, #/todo/new/<id du contact>,
// #/contacts/new, #/contacts/new/piste/<id de la piste> (création d'un contact, 26/11/2026),
// #/todo/new/projet/<id du projet>, #/todo/new/piste/<id de la piste> (lot 2, suite), #/projets, #/projets/<id>, #/pistes, #/pistes/<id> (lot 2), #/reseau (lot 2),
// #/journee (accueil), #/ensemble, #/journal, #/journal/<id> (lot 5a), #/a-traiter, #/reglages (lot 5b ; retour de Google
// en ?google=<issue>#/reglages).
import { onAuth, sendMagicLink, signOut, isAllowed, currentSession, consumeUrlTokens, connexionParLien } from "./session.js";
import { enAppli, formulaireLien } from "./appli.js";
import { contactsView, bindContactEvents, bindDrawerEvents, bindNewContactEvents } from "./contacts.js";
import { todoView, bindTodoEvents, bindTodoDrawerEvents } from "./todo.js";
import { projetsView, bindProjetsEvents, bindProjetsDrawerEvents } from "./projets.js";
import { pistesView, bindPistesEvents, bindPistesDrawerEvents } from "./pistes.js";
import { reseauView, bindReseauEvents } from "./reseau.js";
import { journeeView, ensembleView, bindJourneeEvents } from "./journee.js";
import { journalView, bindJournalEvents, bindJournalDrawerEvents } from "./journal.js";
import { aTraiterView, reglagesView, bindGoogleEvents, lireIssueGoogle } from "./google.js";
import { mountSearch } from "./search.js";
import { $, esc, ic, tickSync, toast, bindNotes } from "./ui.js";
import { miroirApi, todoApi, pistesApi } from "./api.js";
import { bindAgent, basculerAgent, allerAuFil, vueAgent } from "./agent.js";

// Vues disponibles. Menu aligné sur l'artefact « Pilotage RoseauSI », version 1795691780-62c5
// (poc/pilotage-2026-11-26.html) : Ma journée, Vue d'ensemble, Pistes, Contacts, Journal, Projets, Actions.
// L'artefact n'a plus d'entrée Réseau ni Mails (son entrée Contacts regroupe contacts et réseau) : ici Réseau
// reste une vue à part, juste après Contacts.
// Lot 5b : À traiter (file unique, mails sans réponse compris, pas encore maquettée dans l'artefact) après Ma
// journée, et Réglages (liaison Google) en dernier. L'entrée grisée « Mails » est retirée : les mails sont dans
// À traiter, Ma journée, le Journal et la fiche Contact.
const VIEWS = [journeeView, aTraiterView, ensembleView, pistesView, contactsView, reseauView, journalView, projetsView, todoView, reglagesView];
// Téléphone : quatre onglets en bas (maquette, MOB_TABS) et « Plus » pour les autres vues.
const MOB_TABS = ["journee", "todo", "pistes", "contacts"];
const SOON = [];

// Pastilles du menu, mêmes règles que l'artefact (fonction badges) :
//   Actions, rouge : tâches ouvertes dont l'échéance est passée (avant aujourd'hui, Paris) ;
//   Pistes : relances dues. L'artefact les compte d'après la date libre « Date prochaine action » ; le cockpit
//   applique la règle décidée le 26/11 (prochaine tâche TO DO liée échue), la même que le Pilotage.
const BADGE = { todo: { n: null, crit: true }, pistes: { n: null, crit: false } };
const badge = (v) => BADGE[v.id] ? `<span class="nbadge${BADGE[v.id].crit ? " crit" : ""}" data-badge="${v.id}" ${BADGE[v.id].n ? "" : "hidden"}>${BADGE[v.id].n || ""}</span>` : "";
let badgesAt = 0;
async function refreshBadges(force = false) {
  if (!session || (!force && Date.now() - badgesAt < 60_000)) return;
  badgesAt = Date.now();
  const today = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const [t, p] = await Promise.allSettled([todoApi.list(), pistesApi.list()]);
  if (t.status === "fulfilled") BADGE.todo.n = (t.value.tasks || []).filter((x) => x.etat !== "Terminé" && x.etat !== "Annulé" && x.echeance && x.echeance.slice(0, 10) < today).length;
  if (p.status === "fulfilled") BADGE.pistes.n = p.value.synthese?.relancesDues?.length ?? null;
  for (const [id, b] of Object.entries(BADGE)) {
    document.querySelectorAll(`[data-badge="${id}"]`).forEach((el) => {
      el.hidden = !b.n; el.textContent = b.n || "";
      el.title = id === "todo" ? `${b.n} action${b.n > 1 ? "s" : ""} en retard` : `${b.n} relance${b.n > 1 ? "s" : ""} due${b.n > 1 ? "s" : ""}`;
    });
  }
}

// Heure de la dernière lecture de chaque vue (relecture au retour sur la vue ou sur l'onglet du navigateur).
const seenAt = {};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !current || !session) return;
  if (Date.now() - (seenAt[current.id] ?? 0) > 2 * 60_000) { seenAt[current.id] = Date.now(); current.reload?.(); refreshBadges(true); }
});

let session = null;
let current = null;
let pendingMsg = ""; // message à garder sur l'écran de connexion (lien expiré…)

function shell() {
  const nav = (v, on) => `<li><button class="${on ? "on" : ""}" data-nav="${v.id}">${ic(v.icon)}<span class="nl">${esc(v.label)}</span>${badge(v)}</button></li>`;
  const soon = (v) => `<li><button disabled title="Prochain jalon">${ic(v.icon)}<span class="nl">${esc(v.label)}</span><span class="soon">bientôt</span></button></li>`;
  $("#app").innerHTML = `
    <aside id="side">
      <div class="brand"><div class="wm">RoseauSI</div><div class="brand-sub">Cockpit de pilotage</div><span class="poc-tag">Lot 5b</span></div>
      <ul class="nav">${VIEWS.map((v) => nav(v, v === current)).join("")}${SOON.map(soon).join("")}</ul>
      <div class="side-foot"><span>Connecté : <b>${esc(session?.user?.email)}</b></span>
        <div class="side-row"><button class="side-btn" data-act="reload">${ic("refresh", "ic-sm")}Actualiser</button><button class="side-btn" data-act="logout">${ic("logout", "ic-sm")}Déconnexion</button></div></div>
    </aside>
    <div class="main-col">
      <div class="top"><span class="mbrand">RoseauSI</span><h1>${esc(current.label)}</h1>
        <div class="search" id="search"></div>
        <button class="btn sm agbtn" data-act="agent" aria-pressed="false" title="Panneau Agent">${ic("agent", "ic-sm")}<span class="nl">Agent</span></button>
        <button class="iconbtn mob-only" data-act="opensearch" aria-label="Rechercher">${ic("search")}</button>
        <button class="iconbtn mob-only" data-act="reload" aria-label="Actualiser">${ic("refresh")}</button>
        <button class="iconbtn mob-only" data-act="logout" aria-label="Déconnexion">${ic("logout")}</button></div>
      <main id="view"></main>
    </div>
    <nav id="tabbar" aria-label="Navigation">${MOB_TABS.map((id) => VIEWS.find((v) => v.id === id)).map((v) => `<button class="${v === current ? "on" : ""}" data-nav="${v.id}">${ic(v.icon)}${esc(v.short || v.label)}${badge(v)}</button>`).join("")}<button class="${MOB_TABS.includes(current.id) ? "" : "on"}" data-act="more" aria-expanded="false" aria-controls="morelist">${ic("list")}Plus</button></nav>
    <div id="morelist" class="morelist" hidden>${VIEWS.filter((v) => !MOB_TABS.includes(v.id)).map((v) => `<button class="${v === current ? "on" : ""}" data-nav="${v.id}">${ic(v.icon)}<span class="nl">${esc(v.label)}</span>${badge(v)}</button>`).join("")}${SOON.map((v) => `<button disabled>${ic(v.icon)}<span class="nl">${esc(v.label)}</span><span class="soon">bientôt</span></button>`).join("")}</div>`;
}

function loginScreen(msg = "", sent = false) {
  $("#drawer").classList.remove("on"); document.body.classList.remove("dr-open");
  $("#app").innerHTML = `
    <div class="login"><div class="login-card">
      <div class="wm">RoseauSI</div><p class="muted" style="margin:6px 0 18px">Cockpit de pilotage</p>
      ${sent ? `<div class="banner info">${ic("mail", "ic-sm")}<span>${enAppli()
        ? "Lien envoyé. Dans le mail, <b>appui long</b> sur le lien, <b>Copier le lien</b> (sans l'ouvrir), puis colle-le ci-dessous."
        : "Lien envoyé. Ouvre le mail <b>dans ce navigateur</b> et clique sur le lien pour te connecter."}</span></div>` : `
      <form class="form" id="login">
        <div class="fld"><label for="em">Adresse mail</label><input id="em" type="email" required autocomplete="email" placeholder="prenom@roseausi.fr"></div>
        <button class="btn pri" type="submit">${ic("mail", "ic-sm")}Recevoir un lien de connexion</button>
      </form>`}
      ${formulaireLien()}
      ${msg ? `<div class="banner" style="margin-top:12px">${ic("alert", "ic-sm")}<span>${esc(msg)}</span></div>` : ""}
    </div></div>`;
  $("#login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    pendingMsg = "";
    try { await sendMagicLink($("#em").value); loginScreen("", true); }
    catch (err) { loginScreen(err.message); }
  });
  // Appli installée : lien du mail collé (voir connexionParLien).
  $("#login-lien")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try { const s = await connexionParLien($("#lien").value); if (s) applySession(s); }
    catch (err) { loginScreen(err.message, sent); }
  });
}

// Pile des fiches ouvertes à la suite (bouton Retour de l'en-tête), remise à zéro à la fermeture.
let ficheStack = [];

function route() {
  if (!session) return;
  const [, view = "journee", id, extra, extra2] = (location.hash || "#/journee").split("/");
  const v = VIEWS.find((x) => x.id === view) ?? VIEWS[0];
  if (v !== current) {
    current?.close?.(); current = v; shell(); v.mount($("#view"), $("#dr-body")); mountSearch($("#search"));
    // Retour sur une vue déjà lue : relue en arrière-plan si elle date de plus d'une minute (correctif du 26/11).
    if (seenAt[v.id] && Date.now() - seenAt[v.id] > 60_000) v.reload?.();
    seenAt[v.id] = Date.now();
    refreshBadges();
  }
  if (id) {
    const h = location.hash;
    if (ficheStack.length > 1 && ficheStack[ficheStack.length - 2] === h) ficheStack.pop();
    else if (ficheStack[ficheStack.length - 1] !== h) ficheStack.push(h);
    $("#dr-back").hidden = ficheStack.length < 2;
    if (id === "new" && v.openNew) openDrawer(() => v.openNew(extra, extra2));
    else openDrawer(() => v.open(id));
  } else closeDrawer(false);
  // Lot 3 bis : le panneau Agent suit l'écran ouvert.
  window.dispatchEvent(new CustomEvent("cockpit:vue"));
}

/** Pose la fiche sur la zone de contenu : le menu de gauche reste visible sur ordinateur. */
function drFit() {
  const d = $("#drawer");
  let l = 0, r = 0, t = 0, b = 0;
  if (window.matchMedia("(max-width: 900px)").matches) b = $("#tabbar")?.offsetHeight || 0;
  else {
    const m = document.querySelector(".main-col");
    if (m) { const rc = m.getBoundingClientRect(); l = Math.round(rc.left); r = Math.max(0, Math.round(document.documentElement.clientWidth - rc.right)); }
    t = 16; b = 16;
  }
  for (const [k, v] of Object.entries({ l, r, t, b })) d.style.setProperty(`--dr-${k}`, v + "px");
}
window.addEventListener("resize", drFit);
// Lot 3 bis : le panneau Agent ancré change la largeur de la zone de contenu.
window.addEventListener("cockpit:agent-place", () => { if ($("#drawer").classList.contains("on")) drFit(); });

function openDrawer(load) {
  const wasOpen = $("#drawer").classList.contains("on");
  drFit();
  document.body.classList.add("dr-open");
  $("#drawer").classList.add("on");
  $("#dr-body").scrollTop = 0; $("#dr-main").scrollTop = 0; $("#dr-side").scrollTop = 0;
  load();
  if (!wasOpen) setTimeout(() => $("#drawer").focus({ preventScroll: true }), 50);
}
function closeDrawer(updateHash = true) {
  ficheStack = [];
  document.body.classList.remove("dr-open");
  $("#drawer").classList.remove("on");
  current?.close?.();
  if (updateHash && location.hash.split("/").length > 2) location.hash = `#/${current.id}`;
}

async function applySession(s) {
  if (s && !isAllowed(s.user?.email)) { await signOut(); loginScreen("Cette adresse n'est pas autorisée à utiliser le cockpit."); return; }
  const changed = (s?.user?.id ?? null) !== (session?.user?.id ?? null);
  session = s;
  if (!s) { current = null; loginScreen(pendingMsg); return; }
  if (changed || !current) { current = null; route(); }
}

// Actualiser : relecture incrémentale du miroir (pages modifiées dans Notion), puis la vue est relue.
let syncing = false;
async function actualiser() {
  if (syncing) return;
  syncing = true;
  toast("Relecture des changements dans Notion…");
  try {
    const r = await miroirApi.sync();
    const err = (r.resultats ?? []).find((x) => x.erreur);
    if (err) toast("Notion ne répond pas : affichage depuis la dernière synchronisation.", "err");
  } catch (e) {
    toast(e.status === 504 || e.code === "notion_unreachable" ? "Notion ne répond pas : affichage depuis la dernière synchronisation." : e.message, "err");
  } finally {
    syncing = false;
  }
  if (current) seenAt[current.id] = Date.now();
  current?.reload?.();
  refreshBadges(true);
}
setInterval(() => tickSync(), 30_000);

// Événements globaux
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) { $("#morelist")?.setAttribute("hidden", ""); location.hash = `#/${nav.dataset.nav}`; return; }
  if (e.target.closest("[data-act='more']")) { const m = $("#morelist"); m.hidden = !m.hidden; e.target.closest("[data-act='more']").setAttribute("aria-expanded", String(!m.hidden)); return; }
  if (!e.target.closest("#morelist")) $("#morelist")?.setAttribute("hidden", "");
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "logout") signOut();
  if (act === "reload") actualiser();
  if (act === "close") closeDrawer();
  if (act === "back") history.back();
  if (act === "agent") basculerAgent();
  // Fiche étroite (téléphone) : le panneau Mes notes et agent est sous la fiche, un geste y mène. Lot 3 bis :
  // on fait défiler la zone de la fiche elle-même (scrollIntoView faisait aussi défiler la fiche fixe dans son
  // cadre, d'où l'en-tête perdu et la bande blanche), ou on ouvre la fenêtre de l'agent si elle est détachée.
  if (act === "drside") allerAuFil();
  if (act === "drfiche") { vueAgent(false); $("#dr-main").scrollTo({ top: 0, behavior: "smooth" }); $("#dr-body").scrollTo({ top: 0, behavior: "smooth" }); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#drawer").classList.contains("on")) closeDrawer(); });
window.addEventListener("hashchange", route);
bindContactEvents($("#app"));
bindDrawerEvents($("#dr-body"));
bindNewContactEvents($("#dr-body"));
bindTodoEvents($("#app"));
bindTodoDrawerEvents($("#dr-body"));
bindProjetsEvents($("#app"));
bindProjetsDrawerEvents($("#dr-body"));
bindPistesEvents($("#app"));
bindPistesDrawerEvents($("#dr-body"));
bindReseauEvents($("#app"));
bindJourneeEvents($("#app"));
bindJournalEvents($("#app"));
bindJournalDrawerEvents($("#dr-body"));
bindGoogleEvents($("#app"));
bindNotes($("#dr-side"));
bindAgent($("#dr-side"));
// Lot 3 : l'agent (ou une annulation) a écrit dans Notion : la fiche ouverte et la liste sont relues.
window.addEventListener("cockpit:fiche-modifiee", () => {
  const [, , id] = (location.hash || "").split("/");
  if (id && id !== "new" && current?.open) current.open(id);
  current?.reload?.();
});

// Erreur renvoyée par Supabase dans l'adresse (lien expiré, déjà utilisé…).
const urlErr = new URLSearchParams(location.hash.slice(1));
const qErr = new URLSearchParams(location.search);
const err = urlErr.get("error_description") || qErr.get("error_description");
if (err) {
  const code = urlErr.get("error_code") || qErr.get("error_code") || "";
  history.replaceState(null, "", location.pathname);
  pendingMsg = code === "otp_expired"
    ? "Ce lien a expiré ou a déjà servi. Demande un nouveau lien (ou une nouvelle invitation si ton compte n'est pas encore confirmé)."
    : "Lien de connexion invalide, demande-en un nouveau.";
  loginScreen(pendingMsg);
}

// Lot 5b : issue du retour de Google (relié, refus, autre compte…), lue une fois puis retirée de l'adresse.
lireIssueGoogle();

onAuth((s) => { applySession(s); });
// Lien d'invitation (jetons dans l'adresse) d'abord, sinon session déjà enregistrée.
consumeUrlTokens()
  .then((s) => s ?? currentSession())
  .then((s) => { if (!err || s) applySession(s); })
  .catch((e) => { pendingMsg = e.message; loginScreen(pendingMsg); });

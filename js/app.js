// Point d'entrée : connexion, navigation par adresse, fiche plein écran, recherche globale.
// Adresses : #/contacts, #/contacts/<id>, #/todo, #/todo/<id>, #/todo/new, #/todo/new/<id du contact>,
// #/contacts/new, #/contacts/new/piste/<id de la piste> (création d'un contact, 26/11/2026),
// #/todo/new/projet/<id du projet>, #/todo/new/piste/<id de la piste> (lot 2, suite), #/projets, #/projets/<id>, #/pistes, #/pistes/<id> (lot 2), #/reseau (lot 2).
import { onAuth, sendMagicLink, signOut, isAllowed, currentSession, consumeUrlTokens } from "./session.js";
import { contactsView, bindContactEvents, bindDrawerEvents, bindNewContactEvents } from "./contacts.js";
import { todoView, bindTodoEvents, bindTodoDrawerEvents } from "./todo.js";
import { projetsView, bindProjetsEvents, bindProjetsDrawerEvents } from "./projets.js";
import { pistesView, bindPistesEvents, bindPistesDrawerEvents } from "./pistes.js";
import { reseauView, bindReseauEvents } from "./reseau.js";
import { mountSearch } from "./search.js";
import { $, esc, ic, tickSync, toast, bindNotes } from "./ui.js";
import { miroirApi } from "./api.js";
import { bindAgent } from "./agent.js";

// Vues disponibles, dans l'ordre des onglets. L'agent de fiche et les mails viendront s'ajouter ici.
const VIEWS = [contactsView, todoView, projetsView, pistesView, reseauView];
const SOON = [{ id: "mails", label: "Mails", icon: "mail" }];

let session = null;
let current = null;
let pendingMsg = ""; // message à garder sur l'écran de connexion (lien expiré…)

function shell() {
  const nav = (v, on) => `<li><button class="${on ? "on" : ""}" data-nav="${v.id}">${ic(v.icon)}<span class="nl">${esc(v.label)}</span></button></li>`;
  const soon = (v) => `<li><button disabled title="Prochain jalon">${ic(v.icon)}<span class="nl">${esc(v.label)}</span><span class="soon">bientôt</span></button></li>`;
  $("#app").innerHTML = `
    <aside id="side">
      <div class="brand"><div class="wm">RoseauSI</div><div class="brand-sub">Cockpit de pilotage</div><span class="poc-tag">Lot 2</span></div>
      <ul class="nav">${VIEWS.map((v) => nav(v, v === current)).join("")}${SOON.map(soon).join("")}</ul>
      <div class="side-foot"><span>Connecté : <b>${esc(session?.user?.email)}</b></span>
        <div class="side-row"><button class="side-btn" data-act="reload">${ic("refresh", "ic-sm")}Actualiser</button><button class="side-btn" data-act="logout">${ic("logout", "ic-sm")}Déconnexion</button></div></div>
    </aside>
    <div class="main-col">
      <div class="top"><span class="mbrand">RoseauSI</span><h1>${esc(current.label)}</h1>
        <div class="search" id="search"></div>
        <button class="iconbtn mob-only" data-act="opensearch" aria-label="Rechercher">${ic("search")}</button>
        <button class="iconbtn mob-only" data-act="reload" aria-label="Actualiser">${ic("refresh")}</button>
        <button class="iconbtn mob-only" data-act="logout" aria-label="Déconnexion">${ic("logout")}</button></div>
      <main id="view"></main>
    </div>
    <nav id="tabbar" aria-label="Navigation">${VIEWS.map((v) => `<button class="${v === current ? "on" : ""}" data-nav="${v.id}">${ic(v.icon)}${esc(v.short || v.label)}</button>`).join("")}</nav>`;
}

function loginScreen(msg = "", sent = false) {
  $("#drawer").classList.remove("on"); document.body.classList.remove("dr-open");
  $("#app").innerHTML = `
    <div class="login"><div class="login-card">
      <div class="wm">RoseauSI</div><p class="muted" style="margin:6px 0 18px">Cockpit de pilotage</p>
      ${sent ? `<div class="banner info">${ic("mail", "ic-sm")}<span>Lien envoyé. Ouvre le mail <b>dans ce navigateur</b> et clique sur le lien pour te connecter.</span></div>` : `
      <form class="form" id="login">
        <div class="fld"><label for="em">Adresse mail</label><input id="em" type="email" required autocomplete="email" placeholder="prenom@roseausi.fr"></div>
        <button class="btn pri" type="submit">${ic("mail", "ic-sm")}Recevoir un lien de connexion</button>
      </form>`}
      ${msg ? `<div class="banner" style="margin-top:12px">${ic("alert", "ic-sm")}<span>${esc(msg)}</span></div>` : ""}
    </div></div>`;
  $("#login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    pendingMsg = "";
    try { await sendMagicLink($("#em").value); loginScreen("", true); }
    catch (err) { loginScreen(err.message); }
  });
}

// Pile des fiches ouvertes à la suite (bouton Retour de l'en-tête), remise à zéro à la fermeture.
let ficheStack = [];

function route() {
  if (!session) return;
  const [, view = "contacts", id, extra, extra2] = (location.hash || "#/contacts").split("/");
  const v = VIEWS.find((x) => x.id === view) ?? VIEWS[0];
  if (v !== current) { current?.close?.(); current = v; shell(); v.mount($("#view"), $("#dr-body")); mountSearch($("#search")); }
  if (id) {
    const h = location.hash;
    if (ficheStack.length > 1 && ficheStack[ficheStack.length - 2] === h) ficheStack.pop();
    else if (ficheStack[ficheStack.length - 1] !== h) ficheStack.push(h);
    $("#dr-back").hidden = ficheStack.length < 2;
    if (id === "new" && v.openNew) openDrawer(() => v.openNew(extra, extra2));
    else openDrawer(() => v.open(id));
  } else closeDrawer(false);
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
  current?.reload?.();
}
setInterval(() => tickSync(), 30_000);

// Événements globaux
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) { location.hash = `#/${nav.dataset.nav}`; return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "logout") signOut();
  if (act === "reload") actualiser();
  if (act === "close") closeDrawer();
  if (act === "back") history.back();
  // Fiche étroite (téléphone) : le panneau Mes notes et agent est sous la fiche, un geste y mène.
  if (act === "drside") $("#dr-side").scrollIntoView({ behavior: "smooth", block: "start" });
  if (act === "drfiche") { $("#dr-main").scrollTo({ top: 0, behavior: "smooth" }); $("#dr-body").scrollTo({ top: 0, behavior: "smooth" }); }
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

onAuth((s) => { applySession(s); });
// Lien d'invitation (jetons dans l'adresse) d'abord, sinon session déjà enregistrée.
consumeUrlTokens()
  .then((s) => s ?? currentSession())
  .then((s) => { if (!err || s) applySession(s); })
  .catch((e) => { pendingMsg = e.message; loginScreen(pendingMsg); });

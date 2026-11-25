// Point d'entrée : connexion, navigation par adresse (#/contacts, #/contacts/<id>), tiroir de fiche.
import { onAuth, sendMagicLink, signOut, isAllowed, currentSession, consumeUrlTokens } from "./session.js";
import { contactsView, bindContactEvents, bindDrawerEvents } from "./contacts.js";
import { $, esc, ic, toast } from "./ui.js";

// Vues disponibles. TO DO et agent de fiche viendront s'ajouter ici.
const VIEWS = [contactsView];
const SOON = [{ id: "todo", label: "TO DO", icon: "todo" }, { id: "mails", label: "Mails", icon: "mail" }];

let session = null;
let current = null;
let pendingMsg = ""; // message à garder sur l'écran de connexion (lien expiré…)

function shell() {
  const nav = (v, on) => `<li><button class="${on ? "on" : ""}" data-nav="${v.id}">${ic(v.icon)}<span class="nl">${esc(v.label)}</span></button></li>`;
  const soon = (v) => `<li><button disabled title="Prochain jalon">${ic(v.icon)}<span class="nl">${esc(v.label)}</span><span class="soon">bientôt</span></button></li>`;
  $("#app").innerHTML = `
    <aside id="side">
      <div class="brand"><div class="wm">RoseauSI</div><div class="brand-sub">Cockpit de pilotage</div><span class="poc-tag">Jalon 1</span></div>
      <ul class="nav">${VIEWS.map((v) => nav(v, v === current)).join("")}${SOON.map(soon).join("")}</ul>
      <div class="side-foot"><span>Connecté : <b>${esc(session?.user?.email)}</b></span>
        <div class="side-row"><button class="side-btn" data-act="reload">${ic("refresh", "ic-sm")}Actualiser</button><button class="side-btn" data-act="logout">${ic("logout", "ic-sm")}Déconnexion</button></div></div>
    </aside>
    <div class="main-col">
      <div class="top"><span class="mbrand">RoseauSI</span><h1>${esc(current.label)}</h1>
        <button class="iconbtn mob-only" data-act="reload" aria-label="Actualiser">${ic("refresh")}</button>
        <button class="iconbtn mob-only" data-act="logout" aria-label="Déconnexion">${ic("logout")}</button></div>
      <main id="view"></main>
    </div>
    <nav id="tabbar" aria-label="Navigation">${VIEWS.map((v) => `<button class="${v === current ? "on" : ""}" data-nav="${v.id}">${ic(v.icon)}${esc(v.label)}</button>`).join("")}${SOON.map((v) => `<button disabled>${ic(v.icon)}${esc(v.label)}</button>`).join("")}</nav>`;
}

function loginScreen(msg = "", sent = false) {
  $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on");
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

function route() {
  if (!session) return;
  const [, view = "contacts", id] = (location.hash || "#/contacts").split("/");
  const v = VIEWS.find((x) => x.id === view) ?? VIEWS[0];
  if (v !== current) { current = v; shell(); v.mount($("#view"), $("#dr-body")); }
  if (id) openDrawer(() => v.open(id));
  else closeDrawer(false);
}

function openDrawer(load) {
  $("#scrim").classList.add("on"); $("#drawer").classList.add("on");
  $("#dr-body").scrollTop = 0;
  load();
}
function closeDrawer(updateHash = true) {
  $("#scrim").classList.remove("on"); $("#drawer").classList.remove("on");
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

// Événements globaux
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) { location.hash = `#/${nav.dataset.nav}`; return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "logout") signOut();
  if (act === "reload") { current?.reload?.(); toast("Relecture depuis Notion…"); }
  if (act === "close") closeDrawer();
});
$("#scrim").addEventListener("click", () => closeDrawer());
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#drawer").classList.contains("on")) closeDrawer(); });
window.addEventListener("hashchange", route);
bindContactEvents($("#app"));
bindDrawerEvents($("#dr-body"));

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

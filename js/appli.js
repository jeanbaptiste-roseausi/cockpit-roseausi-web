// Appli installable (28/11/2026) : service worker, bandeau « Nouvelle version », bandeau hors connexion,
// carte « Appli » des Réglages (bouton Installer, ou encart iPhone) et connexion par lien collé en mode appli.
// Aucune notification ici (lot suivant).
import { esc, ic, toast } from "./ui.js";

const ua = navigator.userAgent || "";
/** iPhone ou iPad (iPadOS se présente comme un Mac tactile). */
export const estIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
/** Ouvert comme une appli installée (plein écran), et non dans un onglet du navigateur. */
export const enAppli = () => window.matchMedia("(display-mode: standalone)").matches
  || window.matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;

// ---------------- Service worker et version ----------------

let reg = null;
let rechargeDemandee = false;
const versionDe = (w) => { try { return w ? new URL(w.scriptURL).searchParams.get("v") : null; } catch { return null; } };
/** Version en ligne : version.txt, jamais lu depuis un cache. null hors réseau ou en local (pas de version.txt). */
async function versionEnLigne() {
  try {
    const r = await fetch("version.txt", { cache: "no-store" });
    if (!r.ok) return null;
    const v = (await r.text()).trim();
    return /^[\w.-]{1,40}$/.test(v) ? v : null;
  } catch { return null; }
}
/** Version de la page affichée (service worker qui la contrôle). */
export const versionCourante = () => versionDe(navigator.serviceWorker?.controller) || versionDe(reg?.active) || null;

async function enregistrer(v) {
  reg = await navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(v)}`, { scope: "./", updateViaCache: "none" });
  surveiller(reg);
  return reg;
}

function surveiller(r) {
  if (r._suivi) return;
  r._suivi = true;
  if (r.waiting && navigator.serviceWorker.controller) bandeauMaj();
  r.addEventListener("updatefound", () => {
    const w = r.installing;
    w?.addEventListener("statechange", () => {
      // Une version installée attend alors qu'une autre contrôle la page : c'est une mise à jour.
      if (w.state === "installed" && navigator.serviceWorker.controller) bandeauMaj();
    });
  });
}

/** Compare la version en ligne à celle du service worker le plus récent ; en installe une nouvelle s'il le faut. */
let verifT = 0;
async function verifier() {
  if (!reg || Date.now() - verifT < 20_000) return;
  verifT = Date.now();
  const v = await versionEnLigne();
  const derniere = versionDe(reg.installing || reg.waiting || reg.active);
  if (v && v !== derniere) { try { await enregistrer(v); } catch { /* réessayé au prochain retour sur la page */ } }
  else { try { await reg.update(); } catch { /* hors réseau */ } }
}

/** Les fichiers chargés avant que le service worker ne contrôle la page (première visite) rejoignent le cache. */
async function rangerFichiersCharges() {
  const ready = await navigator.serviceWorker.ready;
  const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.startsWith(location.origin));
  urls.push(new URL("js/app.js", location.href).href);
  (navigator.serviceWorker.controller || ready.active)?.postMessage({ type: "ranger", urls });
}

async function demarrer() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  // Banc de test (navigateur piloté) : pas de service worker, il détournerait les appels simulés. Un test peut le
  // réactiver avec localStorage « cockpit-sw » = 1.
  let forcer = false; try { forcer = localStorage.getItem("cockpit-sw") === "1"; } catch { /* stockage indisponible */ }
  if (navigator.webdriver && !forcer) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (rechargeDemandee) location.reload();
    window.dispatchEvent(new CustomEvent("cockpit:appli"));
  });
  try {
    const existant = await navigator.serviceWorker.getRegistration("./");
    const v = (await versionEnLigne()) || versionDe(existant?.active) || "dev";
    if (existant && versionDe(existant.installing || existant.waiting || existant.active) === v) { reg = existant; surveiller(reg); reg.update().catch(() => {}); }
    else await enregistrer(v);
    rangerFichiersCharges();
  } catch (e) { console.warn("Service worker non enregistré :", e); }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifier(); });
  setInterval(verifier, 30 * 60_000);
}

// ---------------- Bandeau « Nouvelle version » ----------------

function bandeauMaj() {
  if (document.getElementById("maj")) return;
  const b = document.createElement("button");
  b.id = "maj"; b.type = "button"; b.className = "maj";
  b.innerHTML = `${ic("refresh", "ic-sm")}<span>Nouvelle version, recharger</span>`;
  b.addEventListener("click", recharger);
  document.body.append(b);
}
function recharger() {
  rechargeDemandee = true;
  const w = reg?.waiting;
  if (w) { w.postMessage({ type: "prendre-la-main" }); setTimeout(() => location.reload(), 4000); }
  else location.reload();
}

// ---------------- Hors connexion (page déjà ouverte) ----------------

function horsLigne() {
  let b = document.getElementById("horsligne");
  if (navigator.onLine) { b?.remove(); return; }
  if (b) return;
  b = document.createElement("div");
  b.id = "horsligne"; b.className = "horsligne"; b.setAttribute("role", "status");
  b.innerHTML = `${ic("alert", "ic-sm")}<span>Hors connexion, le cockpit revient dès que le réseau est là.</span>`;
  document.body.append(b);
}
window.addEventListener("offline", horsLigne);
window.addEventListener("online", () => { horsLigne(); verifier(); });

// ---------------- Installation ----------------

// L'invitation peut arriver avant ce module : index.html la garde dans window.__installation.
let invitation = window.__installation || null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); invitation = e; window.dispatchEvent(new CustomEvent("cockpit:appli")); });
window.addEventListener("appinstalled", () => { invitation = null; toast("Cockpit installé comme une appli."); window.dispatchEvent(new CustomEvent("cockpit:appli")); });

async function installer() {
  if (!invitation) return;
  const e = invitation; invitation = null; window.__installation = null;
  await e.prompt();
  const r = await e.userChoice.catch(() => null);
  if (r?.outcome !== "accepted") toast("Installation annulée.");
  window.dispatchEvent(new CustomEvent("cockpit:appli"));
}

/** Carte « Appli » des Réglages. */
export function carteAppli() {
  const v = versionCourante();
  let corps;
  if (enAppli()) {
    corps = `<p>Le cockpit est ouvert comme une appli sur cet appareil.</p>`;
  } else if (invitation) {
    corps = `<p>Installe le cockpit comme une appli : il s'ouvre en plein écran depuis son icône, sans barre d'adresse.</p>
      <p style="margin-top:10px"><button class="btn pri" type="button" data-appli="installer">${ic("plus", "ic-sm")}Installer l'appli</button></p>`;
  } else if (estIOS) {
    corps = `<div class="banner info appli-ios">${ic("info", "ic-sm")}<div>
      <p><b>Sur iPhone ou iPad</b>, dans Safari : touche <b>Partager</b> (le carré avec la flèche), puis <b>« Sur l'écran d'accueil »</b>, puis Ajouter.</p>
      <p>L'appli installée a son propre stockage : il faudra <b>te reconnecter une fois</b> dans l'appli. Demande le lien de connexion depuis l'appli, puis dans Mail, appui long sur le bouton du lien, <b>Copier le lien</b>, et colle-le dans l'appli.</p></div></div>`;
  } else {
    corps = `<p>Ce navigateur ne propose pas l'installation ici, ou le cockpit est déjà installé. Dans Chrome ou Edge, sur ordinateur, l'icône d'installation est à droite de la barre d'adresse ; sur Android, menu ⋮ puis « Installer l'application ».</p>`;
  }
  return `<section class="card" id="carte-appli" style="margin-top:14px"><div class="card-h"><h2>Appli</h2><span class="chip ${enAppli() ? "c-good" : "dash"}">${enAppli() ? "Installée" : "Navigateur"}</span></div>
    ${corps}
    <p class="small muted" style="margin-top:10px">Version ${esc(v || "non mise en cache")}. Les fichiers de la page sont gardés pour s'ouvrir vite ; les données (Notion, Google) sont toujours relues en ligne et jamais gardées sur l'appareil.</p></section>`;
}

/** Garde la carte « Appli » à jour dans l'hôte donné (Réglages). */
let hoteAppli = null;
const rendreCarte = () => { if (hoteAppli?.isConnected) hoteAppli.innerHTML = carteAppli(); };
window.addEventListener("cockpit:appli", rendreCarte);
export function monterCarteAppli(host) {
  hoteAppli = host;
  rendreCarte();
  host.addEventListener("click", (e) => { if (e.target.closest("[data-appli='installer']")) installer(); });
}

// ---------------- Connexion par lien collé (mode appli) ----------------

/** Champ « colle le lien du mail », affiché sur l'écran de connexion quand le cockpit est ouvert en appli. */
export const formulaireLien = () => !enAppli() ? "" : `
  <form class="form" id="login-lien" style="margin-top:12px">
    <div class="fld"><label for="lien">Lien du mail</label><input id="lien" type="url" inputmode="url" autocomplete="off" placeholder="Colle ici le lien copié depuis le mail"></div>
    <button class="btn pri" type="submit">${ic("check", "ic-sm")}Se connecter</button>
  </form>`;

demarrer();

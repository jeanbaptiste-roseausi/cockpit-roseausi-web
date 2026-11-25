// Vue « Projets » : une carte par mission (règles calculées par la fonction projets), fiche complète
// avec la page Contexte, les tâches ouvertes et les derniers échanges, changement d'état.
import { projetsApi } from "./api.js";
import { $, esc, ic, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip } from "./ui.js";

const S = { items: null, etats: [], regles: null, loading: false, error: null, fetchedAt: null, f: { v: "En cours", q: "" }, open: null };
let host = null, drawerHost = null;

export const projetsView = {
  id: "projets",
  label: "Projets",
  icon: "folder",
  wide: true, // fiche en grand tiroir, comme le POC
  async mount(container, drawer) {
    host = container; drawerHost = drawer;
    render();
    if (!S.items) await load();
  },
  open: openProjet,
  close: () => { S.open = null; },
  reload: () => load(true),
};

async function load() {
  if (S.loading) return;
  S.loading = true; S.error = null; render();
  try {
    const r = await projetsApi.list();
    S.items = r.projets; S.etats = r.etats; S.regles = r.regles; S.fetchedAt = r.fetchedAt;
  } catch (e) { S.error = e.message; }
  finally { S.loading = false; render(); }
}

// ---------------- Éléments communs ----------------

const METEO_CL = { "🟢": "c-good", "🟠": "st-attente", "🔴": "c-crit" };
const meteoChip = (m) => m ? `<span class="chip ${METEO_CL[[...m][0]] ?? ""}">${esc(m)}</span>` : `<span class="chip dash" title="Météo non renseignée dans Notion">Météo absente</span>`;
const pct = (x) => `${Math.round(x * 100)} %`;
const gauge = (b) => b.consommePct == null ? "" : `<div class="gauge ${b.niveau === "crit" ? "c" : b.niveau === "warn" ? "w" : ""}" role="img" aria-label="Budget consommé ${pct(b.consommePct)}"><i style="width:${Math.min(100, Math.round(b.consommePct * 100))}%"></i></div>`;
const isOpenState = (e) => e !== "Terminé" && e !== "Annulé";
const sleepChip = (p) => isOpenState(p.etat) && p.sommeil?.endormi && p.journalLu
  ? `<span class="chip sleep" title="Aucune entrée au journal depuis plus de ${S.regles?.sommeilJours ?? 14} jours">${p.sommeil.aucunEchange ? "En sommeil · aucun échange depuis un an" : `En sommeil · ${p.sommeil.jours} j`}</span>` : "";
function ago(iso) {
  const d = Math.round((new Date(new Date().toISOString().slice(0, 10)) - new Date(iso.slice(0, 10))) / 86_400_000);
  return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : `il y a ${d} j`;
}
const lastEx = (p) => p.dernierEchange ? `${esc(fd(p.dernierEchange.date))} (${ago(p.dernierEchange.date)})` : p.journalLu ? "Aucun depuis un an" : "Non lu (projet clos)";

// ---------------- Liste ----------------

function render() {
  if (!host) return;
  const f = S.f;
  const count = (e) => (S.items || []).filter((p) => p.etat === e).length;
  const seg = (v, lab) => `<button class="${f.v === v ? "on" : ""}" data-pv="${v}">${lab} · ${count(v)}</button>`;
  const head = `<div class="bar"><div class="seg" role="group" aria-label="État">${seg("En cours", "En cours")}${seg("Prospect", "Prospects")}${seg("Terminé", "Terminés")}${seg("Annulé", "Annulés")}</div>
    <label class="sr" for="pf-q">Filtrer</label><input class="inp grow" id="pf-q" type="search" placeholder="Nom du projet…" value="${esc(f.q)}" autocomplete="off"></div>`;
  let body;
  if (S.error) body = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`;
  else if (!S.items) body = `<div class="card"><p class="empty">Chargement des projets depuis Notion…</p></div>`;
  else {
    const q = nrm(f.q.trim());
    const list = S.items.filter((p) => p.etat === f.v && (!q || nrm(p.nomComplet + " " + p.nom).includes(q)));
    const missions = list.filter((p) => !p.regulier), rec = list.filter((p) => p.regulier);
    body = `<p class="small muted" style="margin:-4px 0 12px">Lus dans Notion à ${new Date(S.fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${S.loading ? ", mise à jour…" : ""}. Budget consommé écrit chaque lundi par Budget missions, météo chaque nuit ; orange à 80 %, rouge à 100 %, sommeil après ${S.regles?.sommeilJours ?? 14} jours sans entrée au journal.</p>
      ${missions.length ? `<div class="grid3">${missions.map(card).join("")}</div>` : `<p class="empty">Aucun projet.</p>`}
      ${rec.length ? `<h2 style="margin:22px 0 10px">Activités récurrentes</h2><div class="grid3">${rec.map(card).join("")}</div>` : ""}`;
  }
  const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  host.innerHTML = head + body;
  if (active === "pf-q") { const i = $("#pf-q", host); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
}

function card(p) {
  const b = p.budget;
  return `<a class="prj ${p.budget.niveau === "crit" ? "crit" : ""}" href="#/projets/${p.id}">
    <div class="chips">${meteoChip(p.meteo)}${etatChip(p.etat, true)}${p.regulier ? `<span class="chip">Récurrent</span>` : ""}${sleepChip(p)}${p.horsPerimetre ? `<span class="chip st-attente">${p.horsPerimetre} hors périmètre</span>` : ""}</div>
    <h3>${esc(p.nom)}</h3>
    ${p.motifMeteo ? `<p class="mot clamp2">${esc(p.motifMeteo)}</p>` : ""}
    ${b.consommePct != null ? `<div><div class="stats" style="margin-bottom:5px"><span>Budget consommé <b class="${b.niveau === "crit" ? "neg" : b.niveau === "warn" ? "warn" : ""}">${pct(b.consommePct)}</b></span></div>${gauge(b)}</div>` : `<p class="small muted">Budget consommé : absent dans Notion</p>`}
    ${p.prochainJalon ? `<div class="jal">${ic("flag", "ic-sm")}<span class="clamp2" style="flex:1;min-width:0">${esc(p.prochainJalon)}</span>${due(p.dateJalon)}</div>` : ""}
    <div class="stats"><span><b>${p.taches.ouvertes}</b> tâche${p.taches.ouvertes > 1 ? "s" : ""} ouverte${p.taches.ouvertes > 1 ? "s" : ""}${p.taches.retard ? `, <b class="neg">${p.taches.retard}</b> en retard` : ""}</span>
      <span>Retards des tiers ${p.retardsTiers != null ? `<b>${p.retardsTiers}</b>` : `<em>absent</em>`}</span></div>
    <div class="stats"><span>Dernier échange <b>${lastEx(p)}</b></span></div>
  </a>`;
}

// ---------------- Fiche ----------------

async function openProjet(id) {
  const fromList = (S.items || []).find((p) => p.id === id);
  S.open = { id, p: fromList ? { ...fromList, partial: true } : null, error: null, saving: false };
  setDrawerOwner("projets");
  renderDrawer();
  try {
    const r = await projetsApi.get(id);
    if (S.open?.id !== id) return;
    S.open.p = r.projet; S.open.fetchedAt = r.fetchedAt;
    if (r.etats?.length) S.etats = r.etats;
  } catch (e) { if (S.open?.id === id) S.open.error = e.message; }
  renderDrawer();
}

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost || !ownsDrawer("projets")) return;
  $("#dr-kind").textContent = "Projet";
  const p = o.p;
  if (!p) { drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement du projet…</p>`; return; }
  const b = p.budget, full = !p.partial;
  const nb = (x, u) => x == null ? `<em>absent</em>` : `${String(Math.round(x * 10) / 10).replace(".", ",")} ${u}`;
  drawerHost.innerHTML = `
    <div class="pj-head"><div style="flex:1;min-width:0"><div class="chips" style="margin-bottom:8px">${meteoChip(p.meteo)}${etatChip(p.etat, true)}${p.regulier ? `<span class="chip">Récurrent</span>` : ""}${sleepChip(p)}</div>
      <h1>${esc(p.nom)}</h1>${p.nomComplet && p.nomComplet !== p.nom ? `<div class="sub">${esc(p.nomComplet)}</div>` : ""}</div>
      <div class="dact">
        ${full ? (p.contexte ? `<a class="btn sm pri" href="${esc(p.contexte.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Page Contexte</a>` : `<span class="chip dash">Pas de page Contexte</span>`) : ""}
        <a class="btn sm" href="#/todo/new/projet/${p.id}">${ic("plus", "ic-sm")}Tâche</a>
        ${p.url ? `<a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Ouvrir dans Notion</a>` : ""}
      </div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${p.motifMeteo ? `<div class="banner ${[...(p.meteo || " ")][0] === "🔴" ? "" : "info"}">${ic("alert", "ic-sm")}<span>${esc(p.motifMeteo)}</span></div>` : ""}
    <div class="pkpis">
      <div class="pk"><span>Budget consommé</span><b class="${b.niveau === "crit" ? "neg" : b.niveau === "warn" ? "warn" : ""}">${b.consommePct != null ? pct(b.consommePct) : "–"}</b><small>${b.consommePct != null ? `${nb(b.heuresConsommees, "h")} sur ${nb(b.heuresVendues, "h")} vendues` : "absent dans Notion"}</small>${gauge(b)}</div>
      <div class="pk"><span>Retards des tiers</span><b>${p.retardsTiers ?? "–"}</b><small>${p.retardsTiers == null ? "absent dans Notion" : "page Contexte"}</small></div>
      <div class="pk"><span>Tâches ouvertes</span><b>${p.taches.ouvertes}</b><small>${p.taches.retard ? `${p.taches.retard} en retard` : "aucune en retard"}</small></div>
      <div class="pk"><span>Dernier échange</span><b>${p.dernierEchange ? esc(fd(p.dernierEchange.date)) : "–"}</b><small>${p.dernierEchange ? ago(p.dernierEchange.date) : "aucun au journal"}</small></div>
      <div class="pk"><span>Prochain jalon</span><b>${p.dateJalon ? esc(fd(p.dateJalon)) : "–"}</b><small>${p.prochainJalon ? esc(String(p.prochainJalon).slice(0, 60)) : "absent dans Notion"}</small></div>
      <div class="pk"><span>Prochain rendez-vous</span><b>–</b><small>agenda non relié au cockpit</small></div>
    </div>
    <section class="sec"><h2>État</h2><div class="statusbar" role="group" aria-label="Changer l'état du projet">${S.etats.map((s) => `<button class="${s === p.etat ? "on" : ""}" data-pstate="${esc(s)}" ${s === p.etat || o.saving ? "disabled" : ""} aria-pressed="${s === p.etat}">${esc(s)}</button>`).join("")}</div></section>
    <div class="pgrid">
      <section class="sec"><h2>Tâches ouvertes <a class="btn sm" style="margin-left:auto" href="#/todo/new/projet/${p.id}">${ic("plus", "ic-sm")}Tâche</a></h2>
        ${!full ? `<p class="empty">Chargement…</p>` : p.tachesListe.length ? `<div class="list">${p.tachesListe.map(taskRow).join("")}</div>` : `<p class="empty">Aucune tâche ouverte.</p>`}</section>
      <section class="sec"><h2>Derniers échanges</h2>
        ${!full ? `<p class="empty">Chargement…</p>` : p.echanges.length ? `<div class="list">${p.echanges.map((e) => `<a class="row" href="${esc(e.url)}" target="_blank" rel="noopener"><div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(fd(e.date))}${e.format ? " · " + esc(e.format) : ""}</div></div>${ic("ext", "ic-sm")}</a>`).join("")}</div>` : `<p class="empty">Aucun échange au journal.</p>`}</section>
    </div>
    ${full && p.interlocuteurs.length ? `<section class="sec"><h2>Interlocuteurs</h2><div class="chips">${p.interlocuteurs.map((c) => `<a class="chip" href="#/contacts/${c.id}">${esc(c.nom)}</a>`).join("")}</div><p class="small muted" style="margin-top:8px">Contacts cités dans les derniers échanges et les tâches ouvertes.</p></section>` : ""}
    <section class="sec"><h2>Budget</h2><dl class="kv">
      <dt>Heures</dt><dd>${nb(b.heuresConsommees, "h")} consommées, ${nb(b.heuresVendues, "h")} vendues</dd>
      <dt>Jours</dt><dd>${nb(b.joursVendus, "j")} vendus, plafond ${nb(b.plafondJours, "j")}</dd>
      <dt>Ce mois</dt><dd>${nb(b.joursDuMois, "j")} passés, budget mensuel ${nb(b.budgetMensuelJours, "j")}</dd>
      <dt>Hors périmètre</dt><dd>${p.horsPerimetre ?? "<em>absent</em>"}</dd>
      <dt>Dernière activité</dt><dd>${p.derniereActivite ? esc(fd(p.derniereActivite)) + " <span class=\"muted small\">(journal ou mail, propriété Notion)</span>" : "<em>absente</em>"}</dd>
    </dl></section>
    <p class="small muted">Lu dans Notion${o.fetchedAt ? ` à ${new Date(o.fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}. Fiche modifiée le ${esc(new Date(p.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}${p.contexte?.modifie ? ` ; page Contexte modifiée le ${esc(new Date(p.contexte.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}` : ""}.</p>`;
}

const taskRow = (t) => `<a class="row" href="#/todo/${t.id}"><div class="rm"><div class="rt">${esc(t.nom)}</div><div class="ameta">${t.prio === "P1" ? chip("P1", "red") : t.prio ? chip(t.prio) : ""}${etatChip(t.etat)}</div></div><div class="rr">${due(t.echeance)}</div></a>`;

async function setState(s) {
  const o = S.open;
  if (!o?.p || o.saving) return;
  if ((s === "Terminé" || s === "Annulé") && !confirm(`Passer le projet « ${o.p.nom} » à l'état ${s} ?`)) return;
  o.saving = true; renderDrawer();
  try {
    const r = await projetsApi.update(o.id, { "État": s });
    o.p = r.projet; o.fetchedAt = r.fetchedAt;
    if (S.items) { const i = S.items.findIndex((x) => x.id === o.id); if (i >= 0) S.items[i] = { ...S.items[i], etat: r.projet.etat, modifie: r.projet.modifie }; }
    toast(`État du projet : ${s}.`);
  } catch (e) { toast(e.message, "err"); }
  finally { o.saving = false; renderDrawer(); render(); }
}

// ---------------- Événements ----------------

export function bindProjetsEvents(root) {
  root.addEventListener("click", (e) => { const v = e.target.closest("[data-pv]"); if (v) { S.f.v = v.dataset.pv; render(); } });
  root.addEventListener("input", (e) => { if (e.target.id === "pf-q") { S.f.q = e.target.value; render(); } });
}
export function bindProjetsDrawerEvents(root) {
  root.addEventListener("click", (e) => {
    if (!ownsDrawer("projets")) return;
    const b = e.target.closest("[data-pstate]");
    if (b) setState(b.dataset.pstate);
  });
}

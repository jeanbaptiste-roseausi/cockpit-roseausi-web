// Vue « Projets » : une carte par mission (règles calculées par la fonction projets), fiche complète
// avec la page Contexte, les tâches ouvertes et les derniers échanges, changement d'état.
import { projetsApi } from "./api.js";
import { setTaskEtat } from "./todo.js";
import { $, esc, ic, av, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip, isDone, ficheTop, renderSide, sideHTML, fmtIcon, taSpan } from "./ui.js";

const S = { items: null, etats: [], regles: null, loading: false, error: null, fetchedAt: null, f: { v: "En cours", q: "" }, open: null };
let host = null, drawerHost = null;

export const projetsView = {
  id: "projets",
  label: "Projets",
  icon: "folder",
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
    <div class="stats"><span>Dernier échange <b>${lastEx(p)}</b></span>${p.derniereActivite ? `<span title="Dernière activité (journal ou mail), écrite chaque nuit dans Notion">Activité ${ago(p.derniereActivite)}</span>` : ""}</div>
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
  const p = o.p;
  ficheTop({ kind: "Projet", url: p?.url || null, side: true });
  renderSide("projets", sideHTML({ notesMissing: "La propriété « Mes notes » du projet n'est pas encore lue par le cockpit. Elle le sera avec les données des modules en ligne, après le lot 1.", notesHint: "Non lues pour l'instant" }));
  if (!p) { drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement du projet…</p>`; return; }
  const b = p.budget, full = !p.partial;
  const done = o.done || (o.done = new Map());
  drawerHost.innerHTML = `
    <div class="pj-head"><div class="dact">
        <a class="btn sm pri" href="#/todo/new/projet/${p.id}">${ic("plus", "ic-sm")}Tâche</a>
        ${full ? (p.contexte ? `<a class="btn sm" href="${esc(p.contexte.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Page Contexte</a>` : `<span class="chip dash">Pas de page Contexte</span>`) : ""}
      </div>
      <div style="flex:1;min-width:0"><div class="chips" style="margin-bottom:8px">${meteoChip(p.meteo)}${etatChip(p.etat, true)}${p.regulier ? `<span class="chip">Récurrent</span>` : ""}${sleepChip(p)}</div>
      <h1>${esc(p.nom)}</h1>${p.nomComplet && p.nomComplet !== p.nom ? `<div class="sub">${esc(p.nomComplet)}</div>` : ""}</div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${p.motifMeteo ? `<div class="banner ${[...(p.meteo || " ")][0] === "🔴" ? "" : "info"}">${ic("alert", "ic-sm")}<span>${esc(p.motifMeteo)}</span></div>` : ""}
    <div class="pkpis">
      <div class="pk"><span>Budget consommé</span><b class="${b.niveau === "crit" ? "neg" : b.niveau === "warn" ? "warn" : ""}">${b.consommePct != null ? pct(b.consommePct) : "–"}</b><small>${budgetHint(b)}</small>${gauge(b)}</div>
      <div class="pk"><span>Retards des tiers</span><b>${p.retardsTiers ?? "–"}</b><small>${p.retardsTiers == null ? "absent dans Notion" : "page Contexte"}</small></div>
      <div class="pk"><span>Tâches ouvertes</span><b>${p.taches.ouvertes}</b><small>${p.taches.retard ? `${p.taches.retard} en retard` : "aucune en retard"}</small></div>
      <div class="pk"><span>Dernier échange</span><b>${p.dernierEchange ? esc(fd(p.dernierEchange.date)) : "–"}</b><small>${p.dernierEchange ? ago(p.dernierEchange.date) : "aucun au journal"}</small></div>
      <div class="pk"><span>Prochain jalon</span><b>${p.dateJalon ? esc(fd(p.dateJalon)) : "–"}</b><small>${p.prochainJalon ? esc(String(p.prochainJalon).slice(0, 60)) : "absent dans Notion"}</small></div>
      <div class="pk"><span>Prochain rendez-vous</span><b>–</b><small>agenda non relié au cockpit</small></div>
    </div>
    <section class="sec"><h2>État</h2><div class="statusbar" role="group" aria-label="Changer l'état du projet">${S.etats.map((s) => `<button class="${s === p.etat ? "on" : ""}" data-pstate="${esc(s)}" ${s === p.etat || o.saving ? "disabled" : ""} aria-pressed="${s === p.etat}">${esc(s)}</button>`).join("")}</div></section>
    <div class="pgrid">
      <section class="sec"><h2>Tâches ouvertes <span class="count">${full ? p.tachesListe.filter((t) => !isDone(done.get(t.id) || t)).length : ""}</span><a class="btn sm" style="margin-left:auto" href="#/todo/new/projet/${p.id}">${ic("plus", "ic-sm")}Tâche</a></h2>
        ${!full ? `<p class="empty">Chargement…</p>` : p.tachesListe.length ? `<div class="list">${p.tachesListe.map((t) => taskRow(done.get(t.id) || t, o.busy?.has(t.id))).join("")}</div>` : `<p class="empty">Aucune tâche ouverte.</p>`}</section>
      <section class="sec"><h2>Derniers échanges <span class="count">${full ? p.echanges.length : ""}</span></h2>
        ${!full ? `<p class="empty">Chargement…</p>` : p.echanges.length ? `<div class="list">${p.echanges.map((e) => `<a class="row" href="${esc(e.url)}" target="_blank" rel="noopener">${fmtIcon(e.format)}<div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(fd(e.date))}${e.format ? " · " + esc(e.format) : ""}</div></div>${ic("ext", "ic-sm")}</a>`).join("")}</div>` : `<p class="empty">Aucun échange au journal.</p>`}</section>
    </div>
    ${full && p.interlocuteurs.length ? `<section class="sec"><h2>Interlocuteurs</h2><div class="chips">${p.interlocuteurs.map((c) => `<a class="chip pers" href="#/contacts/${c.id}">${av({ nom: c.nom, type: "Personne" }, "xs")}${esc(c.nom)}</a>`).join("")}</div><p class="small muted" style="margin-top:8px">Contacts cités dans les derniers échanges et les tâches ouvertes.</p></section>` : ""}
    ${budgetSection(p)}
    ${infoSection(p, full)}
    <p class="small muted">Lu dans Notion${o.fetchedAt ? ` à ${new Date(o.fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}. Fiche modifiée le ${esc(new Date(p.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}${p.contexte?.modifie ? ` ; page Contexte modifiée le ${esc(new Date(p.contexte.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}` : ""}.</p>`;
}

// ---------------- Budget et informations ----------------

const n1 = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
const NR = (labels) => labels.length ? `<p class="nr">Non renseigné dans Notion : ${labels.join(", ")}.</p>` : "";

/** Ce qui fait le Consommé (%) : le ratio retenu par Budget missions (le plus élevé des deux). */
function budgetHint(b) {
  if (b.consommePct == null) return "non renseigné dans Notion";
  const h = b.ratioHeures, m = b.ratioMois;
  if (m != null && (h == null || m >= h)) return `${n1(b.joursDuMois)} j ce mois sur ${n1(b.budgetMensuelJours)} j de budget mensuel`;
  if (h != null) return `${n1(b.heuresConsommees)} h sur ${n1(b.heuresVendues)} h vendues`;
  return "écrit par Budget missions";
}

function budgetSection(p) {
  const b = p.budget;
  const rows = [], missing = [];
  const line = (lab, val) => rows.push(`<dt>${lab}</dt><dd>${val}</dd>`);
  if (b.consommePct != null) {
    const which = b.ratioMois != null && (b.ratioHeures == null || b.ratioMois >= b.ratioHeures) ? "mois" : b.ratioHeures != null ? "heures" : null;
    line("Consommé", `<b class="${b.niveau === "crit" ? "neg" : b.niveau === "warn" ? "warn" : ""}">${pct(b.consommePct)}</b>${gauge(b)}<span class="small muted">Le plus élevé entre heures consommées ÷ heures vendues et jours du mois ÷ budget mensuel, écrit chaque lundi par Budget missions${which ? ` ; ici, ${which === "mois" ? "le budget mensuel" : "les heures"}` : ""}. Orange à 80 %, rouge à 100 %.</span>`);
  } else missing.push("consommé (%)");
  if (b.heuresConsommees != null) line("Heures", `${n1(b.heuresConsommees)} h consommées${b.heuresVendues != null ? ` sur ${n1(b.heuresVendues)} h vendues (${pct(b.ratioHeures)})` : ""}`);
  else missing.push("heures consommées");
  if (b.heuresVendues == null) missing.push("heures vendues");
  if (b.budgetMensuelJours != null) line("Mois en cours", `${b.joursDuMois != null ? `${n1(b.joursDuMois)} j passés sur ` : ""}${n1(b.budgetMensuelJours)} j de budget mensuel${b.ratioMois != null ? ` (${pct(b.ratioMois)})` : ""}`);
  else {
    missing.push("budget mensuel");
    if (b.joursDuMois != null) line("Mois en cours", `${n1(b.joursDuMois)} j passés`);
  }
  if (b.joursDuMois == null) missing.push("jours du mois");
  if (b.joursVendus != null) line("Jours vendus", `${n1(b.joursVendus)} j`); else missing.push("jours vendus");
  if (b.plafondJours != null) line("Plafond", `${n1(b.plafondJours)} j`); else missing.push("plafond");
  if (b.palierAlerte) line("Palier déjà alerté", esc(b.palierAlerte)); else missing.push("palier budget alerté");
  return `<section class="sec"><h2>Budget</h2>${rows.length ? `<dl class="kv">${rows.join("")}</dl>` : ""}${NR(missing)}</section>`;
}

function infoSection(p, full) {
  const rows = [], missing = [];
  const line = (lab, val) => rows.push(`<dt>${lab}</dt><dd>${val}</dd>`);
  const d = (x) => esc(fd(x));
  if (p.dateDebut) line("Début réel", d(p.dateDebut)); else missing.push("date de début réelle");
  if (p.datePrevisionnelle) line("Date prévisionnelle", d(p.datePrevisionnelle)); else missing.push("date prévisionnelle");
  line("Responsable", p.responsables?.length ? p.responsables.map(esc).join(", ") : `Jean-Baptiste <span class="small muted">(champ vide, valeur par défaut de la base)</span>`);
  if (p.horsPerimetre != null) line("Hors périmètre ouverts", String(p.horsPerimetre)); else missing.push("hors périmètre ouverts");
  if (p.derniereActivite) line("Dernière activité", `${d(p.derniereActivite)} <span class="small muted">(journal ou mail, écrite chaque nuit)</span>`); else missing.push("dernière activité");
  line("Météo hebdo", p.meteoHebdo ? "Oui, suivi par l'automate du vendredi" : "Non");
  if (p.projetToggl) line("Projet Toggl", esc(p.projetToggl)); else missing.push("projet Toggl (nom identique)");
  const opp = full ? p.opportunitesListe || [] : [];
  // Liens de la relation qui ne mènent pas à une page de la base visée (page déplacée, corbeille).
  const hors = (n, k, base) => full && n > k ? `<p class="nr">${n - k} lien${n - k > 1 ? "s" : ""} de la relation mène${n - k > 1 ? "nt" : ""} à une page hors de la base ${base} (déplacée ou supprimée), non affiché${n - k > 1 ? "s" : ""}.</p>` : "";
  if (full && opp.length) line("Opportunités", `<div class="list">${opp.map((o) => `<a class="row" href="${esc(o.url)}" target="_blank" rel="noopener"><div class="rm"><div class="rt">${esc(o.nom)}</div><div class="rs">${[o.statut, o.caReel != null ? `CA réel ${eur(o.caReel)}` : o.caEstime != null ? `CA estimé ${eur(o.caEstime)}` : null].filter(Boolean).map(esc).join(" · ")}</div></div>${ic("ext", "ic-sm")}</a>`).join("")}</div>${hors(p.opportunites?.n || 0, opp.length, "Opportunités")}`);
  else if (full && p.opportunites?.n) line("Opportunités", hors(p.opportunites.n, 0, "Opportunités"));
  else if (!p.opportunites?.n) missing.push("opportunités");
  else if (!full) line("Opportunités", `${p.opportunites.n} liée${p.opportunites.n > 1 ? "s" : ""}`);
  const th = full ? p.themesListe || [] : [];
  if (full && th.length) line("Initiatives", `<div class="chips">${th.map((t) => `<a class="chip ${t.etat === "Terminé" ? "st-termine" : ""}" href="${esc(t.url)}" target="_blank" rel="noopener" title="${esc(t.etat || "")}">${esc(t.nom)}</a>`).join("")}</div>${hors(p.themes?.n || 0, th.length, "Thèmes")}`);
  else if (full && p.themes?.n) line("Initiatives", hors(p.themes.n, 0, "Thèmes"));
  else if (!p.themes?.n) missing.push("thèmes");
  else if (!full) line("Initiatives", `${p.themes.n} liée${p.themes.n > 1 ? "s" : ""}`);
  return `<section class="sec"><h2>Informations</h2><dl class="kv">${rows.join("")}</dl>${NR(missing)}</section>`;
}
const eur = (x) => `${Math.round(x).toLocaleString("fr-FR")} €`;

// Ligne de tâche avec case à cocher (repris du POC) : Terminé, ou retour à « A faire », écrit dans Notion.
const taskRow = (t, busy) => { const d = isDone(t); return `<div class="arow ${d ? "done" : ""}">
  <button class="chk ${d ? "done" : ""}" data-pdone="${t.id}" ${busy ? "disabled" : ""} aria-label="${d ? "Rouvrir la tâche" : "Marquer comme terminée"}">${d ? ic("check", "ic-sm") : ""}</button>
  <a class="am" href="#/todo/${t.id}"><div class="an">${esc(t.nom)}</div><div class="ameta">${!d && t.prio === "P1" ? chip("P1", "red") : !d && t.prio ? chip(t.prio) : ""}${etatChip(t.etat, d)}${taSpan(t.typeAction)}</div></a>
  ${d ? "" : due(t.echeance)}</div>`; };

async function toggleTask(id) {
  const o = S.open;
  if (!o?.p?.tachesListe) return;
  const t = (o.done && o.done.get(id)) || o.p.tachesListe.find((x) => x.id === id);
  if (!t) return;
  o.busy = o.busy || new Set(); o.busy.add(id); renderDrawer();
  try {
    const r = await setTaskEtat(id, isDone(t) ? "A faire" : "Terminé");
    o.done.set(id, { ...t, etat: r.etat });
  } catch (e) { toast(e.message, "err"); }
  finally { o.busy.delete(id); renderDrawer(); }
}

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
    if (b) { setState(b.dataset.pstate); return; }
    const c = e.target.closest("[data-pdone]");
    if (c) { e.preventDefault(); toggleTask(c.dataset.pdone); }
  });
}

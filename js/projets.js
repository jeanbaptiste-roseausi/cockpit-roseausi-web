// Vue « Projets » : une carte par mission (règles calculées par la fonction projets), fiche complète
// avec la page Contexte, les tâches ouvertes et les derniers échanges, changement d'état.
import { projetsApi } from "./api.js";
import { setTaskEtat } from "./todo.js";
import { og } from "./origines.js";
import { saFold } from "./props.js";
import { $, esc, ic, av, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip, isDone, ficheTop, renderSide, sideHTML, fmtIcon, taSpan, syncOf, syncSpan, staleBanner, setNoteSaver , swapHTML } from "./ui.js";

const S = { items: null, etats: [], options: null, thHide: {}, thNone: false, thSel: null, regles: null, loading: false, error: null, fetchedAt: null, synchro: null, f: { v: "En cours", q: "" }, open: null };
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
    S.items = r.projets; S.etats = r.etats; S.regles = r.regles; S.fetchedAt = r.fetchedAt; S.synchro = syncOf(r);
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
    body = `${staleBanner(S.synchro)}<p class="small muted" style="margin:-4px 0 12px">${syncSpan(S.synchro, true)}${S.loading ? ", mise à jour…" : ""}. Budget consommé écrit chaque lundi par Budget missions, météo chaque nuit ; orange à 80 %, rouge à 100 %, sommeil après ${S.regles?.sommeilJours ?? 14} jours sans entrée au journal.</p>
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
    S.open.p = r.projet; S.open.fetchedAt = r.fetchedAt; S.open.synchro = syncOf(r);
    if (r.etats?.length) S.etats = r.etats;
    if (r.options) S.options = r.options;
  } catch (e) { if (S.open?.id === id) S.open.error = e.message; }
  renderDrawer();
}

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost || !ownsDrawer("projets")) return;
  const p = o.p;
  ficheTop({ kind: "Projet", url: p?.url || null, side: true });
  // Lot 1 bis : Mes notes du projet, modifiables si Notion les donne sans mise en forme.
  renderSide("projets", sideHTML({
    notes: [{ label: "Mes notes", text: p && !p.partial ? p.mesNotes : "", prop: "Mes notes", editable: !!(p && !p.partial && p.textesModifiables?.["Mes notes"] && canEdit("Mes notes")), locked: p?.textesModifiables?.["Mes notes"] === false, saved: o.savedNote === "Mes notes", og: og("projets", "Mes notes") }],
    notesMissing: !p || p.partial ? "Chargement des notes…" : !("mesNotes" in p) ? "Mes notes du projet non lues : la fonction projets n'est pas encore à jour." : "",
  }));
  if (!p) { drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement du projet…</p>`; return; }
  const b = p.budget, full = !p.partial;
  const done = o.done || (o.done = new Map());
  swapHTML(drawerHost, `
    <div class="pj-head"><div class="dact">
        <a class="btn sm pri" href="#/todo/new/projet/${p.id}">${ic("plus", "ic-sm")}Tâche</a>
        ${full && S.options ? `<button class="btn sm" data-pparam="1" aria-expanded="${o.params ? "true" : "false"}">${ic("note", "ic-sm")}Paramètres</button>` : ""}
        ${full ? (p.contexte ? `<a class="btn sm" href="${esc(p.contexte.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Page Contexte</a>` : `<span class="chip dash">Pas de page Contexte</span>`) : ""}
      </div>
      <div style="flex:1;min-width:0"><div class="chips" style="margin-bottom:8px">${meteoChip(p.meteo)}${etatChip(p.etat, true)}${p.regulier ? `<span class="chip">Récurrent</span>` : ""}${sleepChip(p)}</div>
      <h1>${esc(p.nom)}</h1>${p.nomComplet && p.nomComplet !== p.nom ? `<div class="sub">${esc(p.nomComplet)}</div>` : ""}</div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${full && o.params ? paramForm(p, o) : ""}
    ${p.motifMeteo ? `<div class="banner ${[...(p.meteo || " ")][0] === "🔴" ? "" : "info"}">${ic("alert", "ic-sm")}<span>${esc(p.motifMeteo)}</span></div>` : ""}
    ${full ? saFold(p.syntheseAgent) : ""}
    <div class="pkpis four">
      <div class="pk"><span>Budget consommé</span><b class="${b.niveau === "crit" ? "neg" : b.niveau === "warn" ? "warn" : ""}">${b.consommePct != null ? pct(b.consommePct) : "–"}</b><small>${budgetHint(b)}</small>${gauge(b)}</div>
      <div class="pk"><span>Tâches ouvertes</span><b>${p.taches.ouvertes}</b><small>${[p.taches.retard ? `${p.taches.retard} en retard` : "aucune en retard", p.retardsTiers ? `${p.retardsTiers} retard${p.retardsTiers > 1 ? "s" : ""} des tiers` : ""].filter(Boolean).join(", ")}</small></div>
      <div class="pk"><span>Dernier échange</span><b>${p.dernierEchange ? esc(fd(p.dernierEchange.date)) : "–"}</b><small>${p.dernierEchange ? ago(p.dernierEchange.date) : "aucun au journal"}</small></div>
      <div class="pk"><span>Prochain jalon</span><b>${p.dateJalon ? esc(fd(p.dateJalon)) : "–"}</b><small>${p.prochainJalon ? esc(String(p.prochainJalon).slice(0, 60)) : "absent dans Notion"}</small></div>
    </div>
    <section class="sec"><h2>État${og("projets", "État")}</h2><div class="statusbar" role="group" aria-label="Changer l'état du projet">${S.etats.map((s) => `<button class="${s === p.etat ? "on" : ""}" data-pstate="${esc(s)}" ${s === p.etat || o.saving ? "disabled" : ""} aria-pressed="${s === p.etat}">${esc(s)}</button>`).join("")}</div></section>
    <div class="pgrid">
      <section class="sec"><h2>Tâches ouvertes <span class="count">${full ? p.tachesListe.filter((t) => !isDone(done.get(t.id) || t)).length : ""}</span><a class="btn sm" style="margin-left:auto" href="#/todo/new/projet/${p.id}">${ic("plus", "ic-sm")}Tâche</a></h2>
        ${!full ? `<p class="empty">Chargement…</p>` : p.tachesListe.length ? `<div class="list">${p.tachesListe.map((t) => taskRow(done.get(t.id) || t, o.busy?.has(t.id))).join("")}</div>` : `<p class="empty">Aucune tâche ouverte.</p>`}</section>
      <section class="sec"><h2>Derniers échanges <span class="count">${full ? p.echanges.length : ""}</span></h2>
        ${!full ? `<p class="empty">Chargement…</p>` : p.echanges.length ? `<div class="list">${p.echanges.map((e) => `<a class="row" href="${esc(e.url)}" target="_blank" rel="noopener">${fmtIcon(e.format)}<div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(fd(e.date))}${e.format ? " · " + esc(e.format) : ""}${e.parTag ? ` · <span class="par-tag" title="Relation Projets vide dans Notion : rattaché au projet par son Tag">par le Tag ${esc(e.parTag)}</span>` : ""}</div></div>${ic("ext", "ic-sm")}</a>`).join("")}</div>` : `<p class="empty">Aucun échange au journal.</p>`}</section>
    </div>
    ${full && (p.themesListe || []).length ? `<section class="sec"><h2>Timeline par initiative${og("projets", "timeline")} <span class="count">${p.themesListe.length}</span></h2>${timelineHTML(p)}</section>` : ""}
    ${full && p.interlocuteurs.length ? `<section class="sec"><h2>Interlocuteurs${og("projets", "interlocuteurs")}</h2><div class="chips">${p.interlocuteurs.map((c) => `<a class="chip pers" href="#/contacts/${c.id}">${av({ nom: c.nom, type: "Personne" }, "xs")}${esc(c.nom)}</a>`).join("")}</div><p class="small muted" style="margin-top:8px">Contacts cités dans les derniers échanges et les tâches ouvertes.</p></section>` : ""}
    ${budgetSection(p)}
    ${infoSection(p, full)}
    <p class="small muted">${o.synchro ? syncSpan(o.synchro, true) : "Lu dans Notion"}${p.contexteIndisponible ? ". Page Contexte, opportunités et thèmes non lus : Notion ne répond pas" : ""}. Fiche modifiée le ${esc(new Date(p.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}${p.contexte?.modifie ? ` ; page Contexte modifiée le ${esc(new Date(p.contexte.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}` : ""}.</p>`);
}

// ---------------- Budget et informations ----------------

// Pastille d'origine des lignes Budget et Informations (clé : propriété Notion de la ligne).
const OGK = { "Consommé": "Consommé (%)", "Heures": "Heures consommées", "Mois en cours": "Jours du mois", "Jours vendus": "Jours vendus", "Plafond": "Plafond (j)",
  "Palier déjà alerté": "Palier budget alerté", "Début réel": "Date de début Réelle ", "Date prévisionnelle": "Date prévisionnelle", "Responsable": "Responsable",
  "Hors périmètre ouverts": "Hors périmètre ouverts", "Dernière activité": "Dernière activité", "Météo hebdo": "Météo hebdo", "Projet Toggl": "Projet Toggl",
  "Opportunités": "💶 Opportunités", "Initiatives": "Thèmes" };
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
  const line = (lab, val, k = OGK[lab]) => rows.push(`<dt>${lab}${k ? og("projets", k) : ""}</dt><dd>${val}</dd>`);
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
  const line = (lab, val, k = OGK[lab]) => rows.push(`<dt>${lab}${k ? og("projets", k) : ""}</dt><dd>${val}</dd>`);
  const d = (x) => esc(fd(x));
  if (p.dateDebut) line("Début réel", d(p.dateDebut)); else missing.push("date de début réelle");
  if (p.datePrevisionnelle) line("Date prévisionnelle", d(p.datePrevisionnelle)); else missing.push("date prévisionnelle");
  line("Responsable", p.responsables?.length ? p.responsables.map(esc).join(", ") : `Jean-Baptiste <span class="small muted">(champ vide, valeur par défaut de la base)</span>`);
  if (p.horsPerimetre != null) line("Hors périmètre ouverts", String(p.horsPerimetre)); else missing.push("hors périmètre ouverts");
  if (p.derniereActivite) line("Dernière activité", `${d(p.derniereActivite)} <span class="small muted">(journal ou mail, écrite chaque nuit)</span>`); else missing.push("dernière activité");
  line("Météo hebdo", p.meteoHebdo ? "Oui, suivi par l'automate du vendredi" : "Non");
  if (p.projetToggl) line("Projet Toggl", esc(p.projetToggl)); else missing.push("projet Toggl (nom identique)");
  if (full && !p.syntheseAgent) missing.push("synthèse agent");
  const opp = full ? p.opportunitesListe || [] : [];
  // Liens de la relation qui ne mènent pas à une page de la base visée (page déplacée, corbeille).
  const hors = (n, k, base) => full && n > k ? `<p class="nr">${n - k} lien${n - k > 1 ? "s" : ""} de la relation mène${n - k > 1 ? "nt" : ""} à une page hors de la base ${base} (déplacée ou supprimée), non affiché${n - k > 1 ? "s" : ""}.</p>` : "";
  if (full && opp.length) line("Opportunités", `<div class="list">${opp.map((o) => `<a class="row" href="#/pistes/${o.id}"><div class="rm"><div class="rt">${esc(o.nom)}</div><div class="rs">${[o.statut, o.caReel != null ? `CA réel ${eur(o.caReel)}` : o.caEstime != null ? `CA estimé ${eur(o.caEstime)}` : null].filter(Boolean).map(esc).join(" · ")}</div></div>${ic("arrow", "ic-sm")}</a>`).join("")}</div>${hors(p.opportunites?.n || 0, opp.length, "Opportunités")}`);
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
    await applyUpdate({ "État": s });
    toast(`État du projet : ${s}.`);
  } catch (e) { toast(e.message, "err"); }
  finally { o.saving = false; renderDrawer(); render(); }
}

// ---------------- Paramètres du projet (lot 1 bis, POC) ----------------
// Nom, météo, motif, prochain jalon et sa date, écrits dans Notion. Heures par jour, TJ cible et couleur
// du projet n'existent pas dans Notion : ils ne sont pas proposés (voir README).

const canEdit = (n) => (S.options?.modifiables || []).includes(n);
const PTEXTES = ["Motif météo", "Prochain jalon", "Mes notes"];

function paramForm(p, o) {
  const v = p.parametres || {};
  const busy = o.saving;
  const locked = (n) => p.textesModifiables && p.textesModifiables[n] === false;
  const txt = (n, id, lab, rows) => !canEdit(n) ? "" : locked(n)
    ? `<div class="fld wide"><span class="lb">${lab}</span><p class="notes">${esc(v[n] || "")}</p><span class="small muted">Mise en forme dans Notion : à modifier dans Notion.</span></div>`
    : `<div class="fld wide"><label for="${id}">${lab}${og("projets", n)}</label><textarea id="${id}" data-param="${esc(n)}" rows="${rows}" maxlength="10000">${esc(v[n] || "")}</textarea></div>`;
  const meteo = S.options?.meteo || [];
  return `<form class="form paramform" id="pp-form" onsubmit="return false">
    <h2 class="wide" style="margin:0">Paramètres du projet</h2>
    ${canEdit("Nom") ? `<div class="fld wide"><label for="pp-n">Nom dans Notion${og("projets", "Nom")}</label><input id="pp-n" data-param="Nom" value="${esc(v["Nom"] || "")}" required autocomplete="off"></div>` : ""}
    ${canEdit("Météo") ? `<div class="fld"><label for="pp-m">Météo${og("projets", "Météo")}</label><select id="pp-m" data-param="Météo"><option value="">Non renseignée</option>${(meteo.includes(v["Météo"]) || !v["Météo"] ? meteo : [v["Météo"], ...meteo]).map((x) => `<option ${x === v["Météo"] ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>` : ""}
    ${canEdit("Date prochain jalon") ? `<div class="fld"><label for="pp-dj">Date du jalon${og("projets", "Date prochain jalon")}</label><input id="pp-dj" type="date" data-param="Date prochain jalon" value="${esc(String(v["Date prochain jalon"] || "").slice(0, 10))}"></div>` : ""}
    ${txt("Motif météo", "pp-motif", "Motif de la météo", 2)}
    ${txt("Prochain jalon", "pp-jal", "Prochain jalon", 2)}
    <p class="small muted wide">La météo et son motif sont aussi écrits par un automate (chaque nuit) : il peut les remplacer à son prochain passage. Heures par jour, TJ cible et couleur du projet n'existent pas dans Notion.</p>
    <div class="mfoot wide"><button class="btn sm" type="button" data-pparam="0">Fermer</button><button class="btn sm pri" type="button" data-psave="1" ${busy ? "disabled" : ""}>${busy ? "Enregistrement…" : "Enregistrer dans Notion"}</button></div>
  </form>`;
}

async function saveParams() {
  const o = S.open, p = o?.p;
  if (!p || o.saving) return;
  const v = p.parametres || {};
  const changes = {}, avant = {};
  for (const el of drawerHost.querySelectorAll("#pp-form [data-param]")) {
    const n = el.dataset.param, val = el.value.trim();
    const old = n === "Date prochain jalon" ? String(v[n] || "").slice(0, 10) : String(v[n] ?? "").trim();
    if (val === old) continue;
    if (n === "Nom" && !val) { toast("Le nom du projet ne peut pas être vide.", "err"); return; }
    changes[n] = val || null;
    if (PTEXTES.includes(n)) avant[n] = v[n] ?? "";
  }
  if (!Object.keys(changes).length) { o.params = false; renderDrawer(); return; }
  o.saving = true; renderDrawer();
  try {
    await applyUpdate(changes, avant);
    o.params = false;
    toast("Paramètres enregistrés dans Notion.");
  } catch (e) {
    toast(e.message, "err");
    if (e.code === "conflit" || e.code === "mise_en_forme") { o.saving = false; openProjet(o.id); return; }
  } finally { o.saving = false; renderDrawer(); render(); }
}

/** Écrit dans Notion par la fonction projets, puis recompose la fiche et la carte. */
async function applyUpdate(changes, avant) {
  const o = S.open;
  const r = await projetsApi.update(o.id, changes, avant && Object.keys(avant).length ? avant : undefined);
  if (S.open !== o) return r;
  o.p = r.projet; o.fetchedAt = r.fetchedAt; o.synchro = syncOf(r);
  if (r.options) S.options = r.options;
  if (S.items) { const i = S.items.findIndex((x) => x.id === o.id); if (i >= 0) { const { tachesListe, echanges, interlocuteurs, opportunitesListe, themesListe, timeline, contexte, ...card } = r.projet; S.items[i] = { ...S.items[i], ...card }; } }
  return r;
}

setNoteSaver("projets", async (prop, value, before) => {
  const o = S.open;
  if (!o) return;
  try {
    await applyUpdate({ [prop]: value || null }, { [prop]: before });
    o.savedNote = prop;
    toast("Notes enregistrées dans Notion.");
  } catch (e) {
    if (e.code === "conflit" || e.code === "mise_en_forme") { toast(e.message, "err"); openProjet(o.id); return; }
    throw e;
  }
  renderDrawer();
});

// ---------------- Timeline par initiative (lot 1 bis, POC) ----------------
// Barres des initiatives (dates de la base Thèmes), tâches datées en losange, échanges en point, jalon,
// trait rouge à aujourd'hui. Positions en pourcentage de la largeur : aucun défilement horizontal.

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const TH_CL = { "Pas commencé": "th-pasc", "Préparation": "th-prep", "En cours": "th-encours", "Terminé": "th-fini" };
const ymd = (d) => new Date(d.length === 10 ? d + "T12:00:00" : d);

function timelineHTML(p) {
  const ths = p.themesListe || [], tl = p.timeline || { actions: [], echanges: [] };
  const today = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 10);
  const dates = [...ths.flatMap((t) => [t.debut, t.fin]), p.dateJalon, today].filter(Boolean).map((x) => String(x).slice(0, 10)).sort();
  const a = ymd(dates[0]), b = ymd(dates[dates.length - 1]);
  const t0 = new Date(a.getFullYear(), a.getMonth(), 1), t1 = new Date(b.getFullYear(), b.getMonth() + 1, 1);
  const span = t1 - t0;
  const pos = (d) => { if (!d) return null; const x = (ymd(String(d).slice(0, 10)) - t0) / span * 100; return x < 0 || x > 100 ? null : Math.round(x * 100) / 100; };
  const months = [];
  for (let d = new Date(t0); d < t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
  const narrow = window.matchMedia("(max-width: 700px)").matches;
  const every = months.length > (narrow ? 12 : 18) ? 3 : months.length > (narrow ? 5 : 9) ? 2 : 1;
  const grid = months.map((m) => `<span class="tl-g" style="left:${pos(m.toISOString().slice(0, 10)) ?? 0}%"></span>`).join("");
  const now = pos(today) != null ? `<span class="tl-today" style="left:${pos(today)}%" title="Aujourd'hui"></span>` : "";
  const head = `<div class="tl-row tl-head"><div class="tl-lab"></div><div class="tl-track">${months.map((m, k) => k % every ? "" : `<span class="tl-m" style="left:${(m - t0) / span * 100}%">${MOIS[m.getMonth()]}${m.getMonth() === 0 ? " " + String(m.getFullYear()).slice(2) : ""}</span>`).join("")}</div></div>`;
  const lane = (lab, sub, inner, attrs = "") => `<div class="tl-row"><div class="tl-lab" ${attrs}><b>${lab}</b>${sub ? `<small>${sub}</small>` : ""}</div><div class="tl-track">${grid}${now}${inner}</div></div>`;
  const marks = (as, is) => as.filter((x) => pos(x.echeance) != null).map((x) => { const d = isDone(x), late = !d && x.echeance < today; return `<a class="tl-act ${d ? "done" : ""} ${late ? "late" : ""}" style="left:${pos(x.echeance)}%" href="#/todo/${x.id}" title="${esc(x.nom)} · ${esc(fd(x.echeance))}" aria-label="Tâche ${esc(x.nom)}, ${esc(fd(x.echeance))}"></a>`; }).join("")
    + is.filter((i) => pos(i.date) != null).map((i) => `<a class="tl-int" style="left:${pos(i.date)}%" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.titre)} · ${esc(fd(i.date))}" aria-label="Échange ${esc(i.titre)}, ${esc(fd(i.date))}"></a>`).join("");
  const has = (x, id) => (x.themes || []).some((t) => String(t).replace(/-/g, "") === String(id).replace(/-/g, ""));
  let rows = "";
  if (p.dateJalon && pos(p.dateJalon) != null) rows += lane("Prochain jalon", esc(fd(p.dateJalon)), `<span class="tl-jal" style="left:${pos(p.dateJalon)}%" title="${esc(p.prochainJalon || "")}">${ic("flag", "ic-sm")}</span>`);
  for (const t of ths.filter((x) => !S.thHide[x.id])) {
    const ta = tl.actions.filter((x) => has(x, t.id)), ti = tl.echanges.filter((x) => has(x, t.id));
    const open = ta.filter((x) => !isDone(x)).length;
    const l = pos(t.debut) ?? (t.debut && t.debut < dates[0] ? 0 : null), r = pos(t.fin);
    const bar = t.debut && t.fin && l != null && r != null ? `<span class="tl-bar ${TH_CL[t.etat] || ""}" style="left:${l}%;width:${Math.max(0.8, r - l)}%" title="${esc(t.nom)} · du ${esc(fd(t.debut))} au ${esc(fd(t.fin))}"></span>` : `<span class="tl-nodate">sans dates</span>`;
    rows += lane(esc(t.nom), `${esc(t.etat || "État non renseigné")} · ${open} action${open > 1 ? "s" : ""} ouverte${open > 1 ? "s" : ""}`, bar + marks(ta, ti), `role="button" tabindex="0" data-thsel="${t.id}" aria-pressed="${S.thSel === t.id}"`);
  }
  const noA = tl.actions.filter((x) => !(x.themes || []).length && !isDone(x)), noI = tl.echanges.filter((x) => !(x.themes || []).length);
  if (S.thNone) rows += lane("Sans initiative", `${noI.length} échanges · ${noA.length} actions`, marks(noA, noI));
  const chips = ths.map((t) => `<button class="chip ${S.thHide[t.id] ? "" : "st-encours"}" data-thtog="${t.id}" aria-pressed="${!S.thHide[t.id]}">${esc(t.nom)}</button>`).join("");
  const sel = ths.find((t) => t.id === S.thSel);
  let detail = "";
  if (sel) {
    const ta = tl.actions.filter((x) => has(x, sel.id)).sort((x, y) => isDone(x) - isDone(y) || (x.echeance || "9").localeCompare(y.echeance || "9"));
    const ti = tl.echanges.filter((x) => has(x, sel.id));
    detail = `<div class="sec" style="margin-top:12px"><div class="card-h"><h3 style="margin:0;flex:1">${esc(sel.nom)}</h3><a class="btn sm" href="${esc(sel.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Notion</a><button class="iconbtn" data-thsel="" aria-label="Fermer le détail">${ic("close", "ic-sm")}</button></div>
      <p class="small muted">${sel.debut ? `Du ${esc(fd(sel.debut))} au ${esc(fd(sel.fin))}` : "Sans dates"} · ${ta.length} action${ta.length > 1 ? "s" : ""} · ${ti.length} échange${ti.length > 1 ? "s" : ""}</p>
      <div class="pgrid"><div><h3>Actions</h3>${ta.length ? `<div class="list">${ta.map((x) => `<a class="row" href="#/todo/${x.id}"><div class="rm"><div class="rt ${isDone(x) ? "strike" : ""}">${esc(x.nom)}</div><div class="ameta">${etatChip(x.etat, isDone(x))}</div></div><div class="rr">${isDone(x) ? "" : due(x.echeance)}</div></a>`).join("")}</div>` : `<p class="empty">Aucune action.</p>`}</div>
      <div><h3>Échanges</h3>${ti.length ? `<div class="list">${ti.map((i) => `<a class="row" href="${esc(i.url)}" target="_blank" rel="noopener"><div class="rm"><div class="rt">${esc(i.titre)}</div><div class="rs">${esc(fd(i.date))}</div></div>${ic("ext", "ic-sm")}</a>`).join("")}</div>` : `<p class="empty">Aucun échange rattaché à cette initiative.</p>`}</div></div></div>`;
  }
  return `<div class="bar" style="margin-bottom:8px"><span class="small muted" style="flex:1;min-width:160px">Touche une initiative pour la masquer ou l'afficher, son nom pour le détail.</span><label class="chk-l"><input type="checkbox" data-thnone="1" ${S.thNone ? "checked" : ""}> Sans initiative</label></div>
    <div class="chips" style="margin-bottom:10px">${chips}</div>
    <div class="tl">${head}${rows}</div>
    <div class="clegend"><span><i style="background:var(--teal)"></i>En cours</span><span><i style="background:var(--teal-50);border:1px solid var(--teal)"></i>Préparation</span><span><i style="background:var(--surface);border:1.5px dashed var(--line-dashed)"></i>Pas commencé</span><span><i style="background:var(--line-strong)"></i>Terminé</span><span><i class="dia"></i>Tâche datée</span><span><i class="dot2"></i>Échange</span><span><i style="background:var(--alert);width:2px;border-radius:0"></i>Aujourd'hui</span></div>
    ${tl.partiel ? `<p class="small muted">Tâches et échanges non lus : miroir indisponible.</p>` : ""}${detail}`;
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
    if (c) { e.preventDefault(); toggleTask(c.dataset.pdone); return; }
    const pp = e.target.closest("[data-pparam]");
    if (pp && S.open) { S.open.params = pp.dataset.pparam === "1" && !S.open.params; renderDrawer(); if (S.open.params) setTimeout(() => $("#pp-n")?.focus(), 30); return; }
    if (e.target.closest("[data-psave]")) { saveParams(); return; }
    const tg = e.target.closest("[data-thtog]");
    if (tg) { S.thHide[tg.dataset.thtog] = !S.thHide[tg.dataset.thtog]; renderDrawer(); return; }
    const ts = e.target.closest("[data-thsel]");
    if (ts) { S.thSel = ts.dataset.thsel && S.thSel !== ts.dataset.thsel ? ts.dataset.thsel : null; renderDrawer(); }
  });
  root.addEventListener("change", (e) => {
    if (!ownsDrawer("projets")) return;
    if (e.target.dataset?.thnone) { S.thNone = e.target.checked; renderDrawer(); }
  });
  root.addEventListener("keydown", (e) => {
    if (!ownsDrawer("projets")) return;
    const ts = e.target.closest?.("[data-thsel]");
    if (ts && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ts.click(); }
  });
}


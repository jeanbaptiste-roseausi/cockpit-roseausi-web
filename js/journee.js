// Vues « Ma journée » et « Vue d'ensemble » (lot 5a, 26/11/2026). Données du miroir Notion seulement,
// calculées par la fonction journee ; rien d'inventé : l'agenda et les mails restent « à venir » tant que
// l'accès Google n'est pas donné. Gestes : terminer une tâche, changer son échéance (fonction todo).
import { journeeApi, todoApi } from "./api.js";
import { $, esc, ic, fd, toast, taSpan, syncOf, syncSpan, staleBanner, chip } from "./ui.js";

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const today = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}` : `${m} min`;
const hm = (iso) => iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", " h ") : "";
const lab = (v) => (v == null ? "" : String(v).replace(/^[^\p{L}\p{N}]+/u, "").trim());
const stars = (p) => { const n = !p ? null : /🧊/u.test(p) ? 0 : ((String(p).match(/⭐/gu) || []).length || null); return n == null ? "" : n === 0 ? `<span class="chip st-encours">Froide</span>` : `<span class="stars" title="Priorité ${n} sur 3">${"★".repeat(n)}${"☆".repeat(3 - n)}</span>`; };

// ======================= Ma journée =======================

const J = { data: null, error: null, loading: false, open: null, busy: new Set() };
let jHost = null;

export const journeeView = {
  id: "journee",
  label: "Ma journée",
  short: "Journée",
  icon: "home",
  async mount(container) { jHost = container; renderJ(); await loadJ(!!J.data); },
  open() {},
  close() {},
  reload: () => loadJ(true),
};

async function loadJ(silent = false) {
  if (J.loading) return;
  J.loading = true; if (!silent) { J.error = null; renderJ(); }
  const t0 = performance.now();
  try { J.data = await journeeApi.get(); J.error = null; J.ms = Math.round(performance.now() - t0); }
  catch (e) { if (!silent || !J.data) J.error = e.message; else toast(e.message, "err"); }
  finally { J.loading = false; renderJ(); }
}

const pjChip = (d, ids) => (ids || []).slice(0, 1).map((id) => d.projetsNoms?.[id] ? `<a class="chip pj" href="#/projets/${id}">${ic("folder", "ic-sm")}${esc(d.projetsNoms[id])}</a>` : "").join("");
const piChip = (d, ids) => (ids || []).slice(0, 1).map((id) => d.pistesNoms?.[id] ? `<a class="chip pi" href="#/pistes/${id}">${ic("target", "ic-sm")}${esc(d.pistesNoms[id].trim())}</a>` : "").join("");
const prioChip = (t) => t.prio === "P1" ? chip("P1", "red") : t.prio ? chip(t.prio) : "";

/** Ligne de tâche de la journée : case à cocher, intitulé, liens, durée, échéance modifiable, brouillon. */
function dayRow(d, t, { done = false } = {}) {
  const late = !done && t.echeance && t.echeance < d.date;
  const busy = J.busy.has(t.id);
  return `<div class="row dayrow ${done ? "done" : ""}">
    <button class="chk ${done ? "done" : ""}" data-jck="${t.id}" data-to="${done ? "A faire" : "Terminé"}" ${busy ? "disabled" : ""} aria-label="${done ? "Rouvrir" : "Marquer comme faite"} : ${esc(t.nom)}">${done ? ic("check", "ic-sm") : ""}</button>
    <div class="rm"><div class="rt">${done ? `<span class="dbadge">${ic("check", "ic-sm")}${t.etat === "Annulé" ? "Annulée" : "Faite"}</span>` : ""}<a class="lnk ttl" href="#/todo/${t.id}">${esc(t.nom)}</a></div>
      <div class="chips" style="margin-top:6px">${prioChip(t)}${pjChip(d, t.projets)}${piChip(d, t.pistes)}${taSpan(t.typeAction)}<span class="eff">${fmtMin(t.duree)}${t.dureeEstimee ? " estimées" : ""}</span>
        ${!done ? `<label class="chip echchip ${late ? "c-crit" : ""}" title="Changer l'échéance">${late ? "En retard, " : t.echeance === d.date ? "Aujourd'hui, " : ""}${t.echeance ? esc(fd(t.echeance)) : "Sans échéance"}<input type="date" data-jech="${t.id}" value="${esc(t.echeance || "")}" ${busy ? "disabled" : ""} aria-label="Changer l'échéance de ${esc(t.nom)}"></label>` : t.echeance ? `<span class="chip">${esc(fd(t.echeance))}</span>` : ""}</div></div>
    <div class="rr">${t.brouillon ? `<a class="btn sm ${t.bloc === "Prêt à envoyer" ? "pri" : ""}" href="${esc(t.brouillon)}" target="_blank" rel="noopener">Brouillon</a>` : `<a class="btn sm" href="#/todo/${t.id}">Ouvrir</a>`}</div></div>`;
}

/** Ligne courte (listes des voyants, prêtes à relire). */
const miniTask = (d, t) => `<a class="row" href="#/todo/${t.id}"><div class="rm"><div class="rt">${esc(t.nom)}</div><div class="chips" style="margin-top:4px">${prioChip(t)}${pjChip(d, t.projets)}${piChip(d, t.pistes)}${taSpan(t.typeAction)}</div></div><div class="rr">${t.echeance ? `<span class="due ${t.echeance < d.date ? "late" : t.echeance === d.date ? "today" : ""}">${t.echeance === d.date ? "Aujourd'hui" : esc(fd(t.echeance))}</span>` : `<span class="small muted">Sans échéance</span>`}</div></a>`;
const miniMission = (m) => `<a class="row" href="#/projets/${m.id}"><div class="rm"><div class="rt">${esc(m.nom)}</div><div class="rs">${m.meteo ? esc(lab(m.meteo)) : "Météo non renseignée"}</div></div><div class="rr"><b class="${m.niveau === "crit" ? "neg" : ""}">${Math.round((m.consomme ?? 0) * 100)} %</b></div></a>`;

function voyant(v) {
  const src = `<span class="vy-src">${esc(v.source)}, ${syncSpan({ source: "miroir", synchronise: v.synchronise })}</span>`;
  if (v.niveau === "vert") return `<div class="voyant vert" title="${esc(v.regle)}"><span class="vy-ok">${ic("check", "ic-sm")}</span><div><b>${esc(v.titre)}</b>${src}</div></div>`;
  const open = J.open === v.id;
  return `<button class="voyant ${v.niveau} ${open ? "on" : ""}" data-jvy="${v.id}" aria-expanded="${open}" title="${esc(v.regle)}">
    <span class="vy-n">${v.n}</span><div><b>${esc(v.titre)}</b><span class="vy-d">${esc(v.detail)}</span>${src}</div></button>`;
}

function renderJ() {
  if (!jHost) return;
  const now = new Date();
  const head = `<section class="hello"><h1>Bonjour Jean-Baptiste</h1><p class="small muted">${JOURS[now.getDay()]} ${now.getDate()} ${MOIS[now.getMonth()]}</p>`;
  if (J.error) { jHost.innerHTML = head + `</section><div class="banner">${ic("alert", "ic-sm")}<span>${esc(J.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`; return; }
  const d = J.data;
  if (!d) { jHost.innerHTML = head + `<p>Chargement de ta journée depuis le miroir de Notion…</p></section>`; return; }
  const sy = syncOf(d);
  const b = d.brief;
  const briefLine = b ? `Brief ${b.date === d.date ? "de " + hm(b.cree) : "du " + esc(fd(b.date)) + ", pas encore de brief aujourd'hui"} · <a class="lnk" href="${esc(b.url)}" target="_blank" rel="noopener">Ouvrir le brief dans Notion</a>` : "Aucun brief du matin dans le Journal de bord";
  const j = d.jour;
  const opened = d.voyants.find((v) => v.id === J.open && v.niveau !== "vert");
  const agenda = d.aVenir.find((x) => x.id === "agenda"), mails = d.aVenir.find((x) => x.id === "mails");
  jHost.innerHTML = head + `<p>${briefLine} · ${syncSpan(sy)}${J.loading ? ", mise à jour…" : ""}</p></section>
  ${staleBanner(sy)}
  <section class="voyants" aria-label="Voyants">${d.voyants.map(voyant).join("")}</section>
  ${opened ? `<section class="card vy-list"><div class="card-h"><h2>${esc(opened.titre)}</h2><span class="count">${opened.n}</span><button class="lnk" data-jvy="${opened.id}">Fermer</button></div>
    <p class="small muted" style="margin-bottom:6px">${esc(opened.regle)}</p>
    <div class="list">${opened.items.map((x) => opened.id === "budget" ? miniMission(x) : miniTask(d, x)).join("")}</div></section>` : ""}
  <section class="dayprog"><div class="dp1"><div class="dpl"><b>Ta journée, ${j.faites} sur ${j.total} faite${j.faites > 1 ? "s" : ""}</b><span>reste environ ${fmtMin(j.resteMin)} · ${j.enRetard} en retard, ${j.duJour} du jour</span></div>
    <div class="gauge"><i style="width:${j.total ? Math.round(j.faites / j.total * 100) : 0}%"></i></div></div>
    <div class="dpnext soon-box"><span class="small muted">${esc(agenda.titre)}</span><b>${esc(agenda.raison)}</b></div></section>
  <div class="daygrid">
    <div class="daymain">
      <section class="card"><div class="card-h"><h2>Tes priorités</h2><span class="count">${d.priorites.length}</span></div>
        <p class="small muted" style="margin-bottom:4px">${esc(d.regles.priorites)}</p>
        <div class="list">${d.priorites.map((t) => dayRow(d, t)).join("") || `<p class="empty">Aucune tâche P1 ou P2 due.</p>`}</div></section>
      <section class="card"><div class="card-h"><h2>À faire, dans l'ordre</h2><span class="small muted">par bloc, puis échéance et durée</span></div>
        ${d.jour.blocs.map((l, n) => l.taches.length || l.faites.length ? `<h3 class="lane">${n + 1}. ${esc(l.bloc)} <small>${l.taches.length} · ${fmtMin(l.taches.reduce((s, t) => s + t.duree, 0))}</small></h3>
          <div class="list">${l.taches.map((t) => dayRow(d, t)).join("")}${l.faites.map((t) => dayRow(d, t, { done: true })).join("")}</div>` : "").join("")}
        ${!j.total ? `<p class="empty">Aucune tâche due aujourd'hui ni en retard.</p>` : ""}
        <p class="small muted" style="margin-top:8px">${esc(d.regles.jour)} ${esc(d.regles.duree)}</p></section>
    </div>
    <div class="dayside">
      <section class="card daycard"><div class="card-h"><h2>Relances de pistes échues</h2><span class="count">${d.relances.length}</span></div>
        <div class="list">${d.relances.map((r) => `<a class="row" href="#/pistes/${r.id}"><div class="rm"><div class="rt">${esc(r.nom.trim())}</div><div class="rs">${esc(r.tache.nom)}</div><div class="chips" style="margin-top:4px">${r.etape ? `<span class="chip">${esc(lab(r.etape))}</span>` : ""}</div></div><div class="rr"><span class="due ${r.joursRetard > 0 ? "late" : "today"}">${r.joursRetard > 0 ? esc(fd(r.tache.echeance)) : "Aujourd'hui"}</span>${stars(r.prio)}</div></a>`).join("") || `<p class="empty">Aucune relance échue.</p>`}</div>
        <p class="small muted" style="margin-top:6px">${esc(d.regles.relances)}${d.pistesSansTache ? ` ${d.pistesSansTache} pistes actives n'ont aucune tâche ouverte : <a class="lnk" href="#/pistes">Prospection</a>.` : ""}</p></section>
      <section class="card daycard"><div class="card-h"><h2>Prêtes à relire</h2><span class="count">${d.relire.length}</span></div>
        <div class="list">${d.relire.map((t) => miniTask(d, t)).join("") || `<p class="empty">Rien à relire.</p>`}</div></section>
      <section class="card daycard soon-card"><div class="card-h"><h2>${esc(agenda.titre)}</h2><span class="chip dash">À venir</span></div><p class="small">${esc(agenda.raison)}</p><p class="small muted">Source prévue, ${esc(agenda.source)}. Rien n'est affiché à la place.</p></section>
      <section class="card daycard soon-card"><div class="card-h"><h2>${esc(mails.titre)}</h2><span class="chip dash">À venir</span></div><p class="small">${esc(mails.raison)}</p><p class="small muted">Source prévue, ${esc(mails.source)}. Rien n'est affiché à la place.</p></section>
    </div>
  </div>`;
}

async function setTask(id, changes, msg) {
  J.busy.add(id); renderJ();
  try { await todoApi.update(id, changes); toast(msg); await loadJ(true); }
  catch (e) { toast(e.message, "err"); }
  finally { J.busy.delete(id); renderJ(); }
}

// ======================= Vue d'ensemble =======================

const E = { data: null, error: null, loading: false };
let eHost = null;

export const ensembleView = {
  id: "ensemble",
  label: "Vue d'ensemble",
  short: "Ensemble",
  icon: "board",
  async mount(container) { eHost = container; renderE(); await loadE(!!E.data); },
  open() {},
  close() {},
  reload: () => loadE(true),
};

async function loadE(silent = false) {
  if (E.loading) return;
  E.loading = true; if (!silent) { E.error = null; renderE(); }
  try { E.data = await journeeApi.ensemble(); E.error = null; }
  catch (e) { if (!silent || !E.data) E.error = e.message; else toast(e.message, "err"); }
  finally { E.loading = false; renderE(); }
}

const METEO_CL = [[/vert/i, "c-good"], [/surveiller/i, "c-warn"], [/difficult/i, "c-crit"]];
const meteoChip = (m) => m ? `<span class="chip ${METEO_CL.find(([re]) => re.test(m))?.[1] ?? ""}">${esc(lab(m))}</span>` : "";

export function interRow(e, d) {
  const pj = e.projets.map((id) => d.projetsNoms?.[id]).find(Boolean), pjId = e.projets.find((id) => d.projetsNoms?.[id]);
  const pi = e.pistes.map((id) => d.pistesNoms?.[id]).find(Boolean), piId = e.pistes.find((id) => d.pistesNoms?.[id]);
  const k = /atelier/i.test(e.format || "") ? "atelier" : /r[ée]union/i.test(e.format || "") ? "reunion" : /call|appel/i.test(e.format || "") ? "call" : null;
  const dt = e.date ? new Date(e.date) : null;
  const when = dt ? `${fd(e.date)}${/T/.test(e.date) ? " à " + dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ") : ""}` : "";
  return `<a class="row" href="#/journal/${e.id}"><span class="ifmt sm ${k ? "" : "none"}">${ic(k || "note", "ic-sm")}</span>
    <div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(when)}${e.format ? " · " + esc(lab(e.format)) : ""}${e.duree ? ` · ${e.duree} min` : ""}</div>
    <div class="chips" style="margin-top:6px">${pi ? `<span class="chip pi">${ic("target", "ic-sm")}${esc(pi.trim())}</span>` : ""}${pj ? `<span class="chip pj">${ic("folder", "ic-sm")}${esc(pj)}</span>` : ""}${!e.projets.length && !e.pistes.length ? `<span class="chip dash">Non rattachée</span>` : ""}${e.contacts.length ? `<span class="chip">${e.contacts.length} contact${e.contacts.length > 1 ? "s" : ""}</span>` : ""}${e.actions ? `<span class="chip">${e.actions} action${e.actions > 1 ? "s" : ""}</span>` : ""}</div></div></a>`;
}

function renderE() {
  if (!eHost) return;
  const head = `<section class="hello">`;
  if (E.error) { eHost.innerHTML = head + `</section><div class="banner">${ic("alert", "ic-sm")}<span>${esc(E.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`; return; }
  const d = E.data;
  if (!d) { eHost.innerHTML = head + `<p>Chargement depuis le miroir de Notion…</p></section>`; return; }
  const sy = syncOf(d), k = d.kpis;
  const relRow = (r) => `<a class="row" href="#/pistes/${r.id}"><div class="rm"><div class="rt">${esc(r.nom.trim())}</div><div class="rs clamp2">${esc(r.tache.nom)}</div><div class="chips" style="margin-top:6px">${r.etape ? `<span class="chip">${esc(lab(r.etape))}</span>` : ""}${r.issue && lab(r.issue) !== "En cours" ? `<span class="chip">${esc(lab(r.issue))}</span>` : ""}</div></div><div class="rr"><span class="due ${r.tache.echeance < d.date ? "late" : r.tache.echeance === d.date ? "today" : ""}">${r.tache.echeance === d.date ? "Aujourd'hui" : esc(fd(r.tache.echeance))}</span>${stars(r.prio)}</div></a>`;
  const actRow = (t) => `<a class="arow" href="#/todo/${t.id}"><div class="am"><div class="an">${esc(t.nom)}</div><div class="ameta chips">${t.prio === "P1" ? chip("P1", "red") : ""}${pjChip(d, t.projets)}${piChip(d, t.pistes)}${taSpan(t.typeAction)}</div></div><span class="due ${t.echeance < d.date ? "late" : "today"}">${t.echeance === d.date ? "Aujourd'hui" : esc(fd(t.echeance))}</span></a>`;
  eHost.innerHTML = head + `<p class="muted">${syncSpan(sy, true)}${E.loading ? ", mise à jour…" : ""}</p></section>
  ${staleBanner(sy)}
  <div class="kpis">
    <a class="kpi" href="#/pistes"><b>${k.pistesActives}</b><span>Pistes actives</span></a>
    <a class="kpi ${k.relancesDues ? "alert" : ""}" href="#/pistes"><b>${k.relancesDues}</b><span>Relances dues</span></a>
    <a class="kpi ${k.actionsRetard ? "alert" : ""}" href="#/todo"><b>${k.actionsRetard}</b><span>Actions en retard</span></a>
    <a class="kpi ${k.missionsDifficulte ? "alert" : ""}" href="#/projets"><b>${k.missionsDifficulte}<small> / ${k.missions}</small></b><span>Missions en difficulté</span></a>
  </div>
  <div class="grid2">
    <section class="card"><div class="card-h"><h2>À relancer</h2><span class="count">${d.aRelancer.length}</span><a class="lnk" href="#/pistes">Toutes les pistes</a></div>
      <p class="small muted" style="margin-bottom:6px">Prochaine tâche de la piste due dans les sept jours. ${esc(d.regles.relances)}</p>
      <div class="list">${d.aRelancer.map(relRow).join("") || `<p class="empty">Rien à relancer cette semaine.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Actions du jour et en retard</h2><span class="count">${d.actionsTotal}</span><a class="lnk" href="#/todo">Toutes</a></div>
      ${d.relire ? `<div class="banner info" style="margin-bottom:8px">${ic("info", "ic-sm")}<span>${d.relire} tâche${d.relire > 1 ? "s" : ""} prête${d.relire > 1 ? "s" : ""} à relire.</span></div>` : ""}
      <div class="list">${d.actions.map(actRow).join("") || `<p class="empty">Aucune action due.</p>`}</div>
      ${d.actionsTotal > d.actions.length ? `<a class="lnk" href="#/journee">Voir les ${d.actionsTotal - d.actions.length} autres dans Ma journée</a>` : ""}</section>
    <section class="card"><div class="card-h"><h2>Météo des missions</h2><a class="lnk" href="#/projets">Projets</a></div>
      <p class="small muted" style="margin-bottom:6px">${esc(d.regles.meteo)}</p>
      <div class="list">${d.meteo.map((m) => `<a class="row" href="#/projets/${m.id}"><div class="rm"><div class="rt">${esc(m.nom)}</div><div class="rs clamp2">${esc(m.motif || "")}</div></div><div class="rr">${meteoChip(m.meteo)}${m.dateJalon ? `<span class="due">Jalon ${esc(fd(m.dateJalon))}</span>` : ""}</div></a>`).join("") || `<p class="empty">Aucune mission en cours avec une météo.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Dernières interactions</h2><a class="lnk" href="#/journal">Journal</a></div>
      <div class="list">${d.interactions.map((e) => interRow(e, d)).join("") || `<p class="empty">Aucune interaction.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Pistes prioritaires sans nouvelles</h2><span class="count">${d.sansNouvelles.length}</span></div>
      <p class="small muted" style="margin-bottom:6px">${esc(d.regles.sansNouvelles)}</p>
      <div class="list">${d.sansNouvelles.map((p) => `<a class="row" href="#/pistes/${p.id}"><div class="rm"><div class="rt">${esc(p.nom.trim())}</div><div class="chips" style="margin-top:6px">${p.etape ? `<span class="chip">${esc(lab(p.etape))}</span>` : ""}<span class="chip">${p.dernierEchange ? "Dernier échange " + esc(fd(p.dernierEchange)) : "Aucun échange au journal"}</span></div></div><div class="rr">${stars(p.prio)}</div></a>`).join("") || `<p class="empty">Toutes les pistes prioritaires ont eu un échange récent.</p>`}</div></section>
  </div>`;
}

// ======================= Événements =======================

export function bindJourneeEvents(root) {
  root.addEventListener("click", (e) => {
    const vy = e.target.closest("[data-jvy]");
    if (vy) { J.open = J.open === vy.dataset.jvy ? null : vy.dataset.jvy; renderJ(); return; }
    const ck = e.target.closest("[data-jck]");
    if (ck && !ck.disabled) setTask(ck.dataset.jck, { "État": ck.dataset.to }, ck.dataset.to === "Terminé" ? "Tâche terminée dans Notion." : "Tâche rouverte dans Notion.");
  });
  root.addEventListener("change", (e) => {
    const inp = e.target.closest?.("input[data-jech]");
    if (inp && inp.value) setTask(inp.dataset.jech, { "Échéance": inp.value }, `Échéance au ${fd(inp.value)}, dans Notion.`);
  });
}

export { today };

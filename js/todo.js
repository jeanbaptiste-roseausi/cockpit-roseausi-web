// Vue « TO DO » : tâches ouvertes groupées par échéance (comme le POC), fiche modifiable,
// changement d'état en un clic, création de tâche.
import { todoApi } from "./api.js";
import { contactIndex } from "./contacts.js";
import { $, esc, ic, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip, etatLabel, isDone, ficheTop, renderSide, sideHTML, ficheTabs, taSpan, syncOf, syncSpan, staleBanner, setNoteSaver , swapHTML } from "./ui.js";

const PROSPECTION_PROJECT = "3e6a08ac559780ccb74ce21b2d7e2bbb"; // projet « Prospection » (filtre du POC)
const CONTACTS_REL = "👱‍♀️ Contacts";
const THEME_REL = "Thème";
const TEXTES = ["Récap", "Mes notes"]; // textes longs : envoyés avec la valeur affichée (contrôle de conflit)

const S = {
  items: null, done: null, schema: null, loading: false, error: null, fetchedAt: null, synchro: null,
  f: { v: "ouvertes", proj: "", q: "", mode: "liste" },
  justDone: new Set(),  // tâches terminées pendant la session : restent visibles, barrées, jusqu'à l'actualisation
  open: null,           // fiche ouverte : { id, task, values, saving: Set, error }
};

let host = null, drawerHost = null;
const nid = (id) => String(id || "").replace(/-/g, "");
const today = () => new Date().toISOString().slice(0, 10);
const ddiff = (iso) => Math.round((new Date(iso.slice(0, 10) + "T12:00:00") - new Date(today() + "T12:00:00")) / 86_400_000);

export const todoView = {
  id: "todo",
  label: "TO DO",
  icon: "todo",
  async mount(container, drawer) {
    host = container; drawerHost = drawer;
    render();
    if (!S.items) await load();
  },
  open: (id) => (id === "new" ? openNew() : openTask(id)),
  // #/todo/new/<id du contact> ou #/todo/new/projet/<id du projet>
  openNew: (a, b) => (a === "projet" ? openNew(null, b) : openNew(a)),
  close: () => { S.open = null; },
  reload: () => { S.justDone.clear(); S.done = null; return load(true); },
};

async function load(force = false) {
  if (S.loading) return;
  S.loading = true; S.error = null; render();
  try {
    const [list, schema] = await Promise.all([todoApi.list(), S.schema && !force ? S.schema : todoApi.schema()]);
    S.items = list.tasks; S.fetchedAt = list.fetchedAt; S.synchro = syncOf(list); S.schema = schema;
    if (S.f.v === "faites") await loadDone();
  } catch (e) { S.error = e.message; }
  finally { S.loading = false; render(); }
}
/** Tâches ouvertes (chargées une fois), pour la recherche globale. */
export async function taskIndex() {
  if (!S.items && !S.loading) await load();
  else if (S.loading) await new Promise((r) => { const t = setInterval(() => { if (!S.loading) { clearInterval(t); r(); } }, 100); });
  return (S.items || []).filter((t) => !isDone(t));
}

/** Changement d'état depuis une autre vue (fiche projet) : même écriture, même cache que la vue TO DO. */
export async function setTaskEtat(id, etat) {
  const r = await update(id, { "État": etat }, etat === "Terminé" ? "Tâche terminée dans Notion." : `État : ${etatLabel(etat)}.`);
  render();
  return r.task;
}

async function loadDone() {
  try { S.done = (await todoApi.list({ scope: "done" })).tasks; } catch (e) { S.done = []; toast(e.message, "err"); }
}

const projets = () => S.schema?.projets || [];
const projById = (id) => projets().find((p) => nid(p.id) === nid(id));
const projChip = (id) => { const p = projById(id); return p ? `<span class="chip pj">${ic("folder", "ic-sm")}${esc(p.nom)}</span>` : ""; };
const prioChip = (t) => t.prio === "P1" && !isDone(t) ? chip("P1", "red") : t.prio && !isDone(t) ? chip(t.prio) : "";
// Initiatives (base Thèmes, lue en direct par la fonction todo) : pastille sur chaque ligne (lot 1 bis).
const initiatives = () => S.schema?.initiatives || [];
const iniById = (id) => initiatives().find((x) => nid(x.id) === nid(id));
const iniChip = (id) => { const t = iniById(id); return t ? `<span class="chip ini" title="Initiative">${ic("layers", "ic-sm")}${esc(t.nom)}</span>` : ""; };
const contactName = (id) => contactsList.sync().find((c) => nid(c.id) === nid(id))?.nom;

// ---------------- Liste ----------------

function filtered() {
  const f = S.f;
  let list;
  if (f.v === "faites") list = (S.done || []).slice().sort((a, b) => (b.modifie || "").localeCompare(a.modifie || ""));
  else list = (S.items || []).filter((t) => !isDone(t) || S.justDone.has(t.id));
  if (f.v === "retard") list = list.filter((t) => t.echeance && ddiff(t.echeance) < 0);
  if (f.v === "relire") list = list.filter((t) => t.etat === "Prêt à relire");
  if (f.v === "prospection") list = list.filter((t) => t.pistes > 0 || t.projets.some((p) => nid(p) === PROSPECTION_PROJECT));
  if (f.proj) list = list.filter((t) => t.projets.some((p) => nid(p) === nid(f.proj)));
  const q = nrm(f.q.trim());
  // Recherche (lot 1 bis, POC) : intitulé, type, projet, initiative, récap, synthèse agent, Mes notes, noms des contacts.
  if (q) list = list.filter((t) => nrm([t.nom, t.typeAction, t.texte, ...t.projets.map((p) => projById(p)?.nom), ...(t.themes || []).map((x) => iniById(x)?.nom), ...(t.contacts || []).map(contactName)].join(" ")).includes(q));
  if (f.v !== "faites") list.sort((a, b) => (a.echeance || "9").localeCompare(b.echeance || "9") || (a.prio || "P9").localeCompare(b.prio || "P9"));
  return list;
}

function render() {
  if (!host) return;
  const f = S.f;
  const seg = (v, lab) => `<button class="${f.v === v ? "on" : ""}" data-tv="${v}">${lab}</button>`;
  const mseg = (v, lab) => `<button class="${f.mode === v ? "on" : ""}" data-tmode="${v}" aria-pressed="${f.mode === v}">${lab}</button>`;
  const usedProj = new Set((S.items || []).flatMap((t) => t.projets.map(nid)));
  const projOpts = projets().filter((p) => usedProj.has(nid(p.id)));
  const head = `<div class="bar">
      <div class="seg" role="group" aria-label="Vue">${seg("ouvertes", "Ouvertes")}${seg("retard", "En retard")}${seg("relire", "Prêtes à relire")}${seg("prospection", "Prospection")}${seg("faites", "Faites (14 j)")}</div>
      <label class="sr" for="tf-p">Projet</label>
      <select class="sel" id="tf-p"><option value="">Tous les projets</option>${projOpts.map((p) => `<option value="${p.id}" ${f.proj === p.id ? "selected" : ""}>${esc(p.nom)}</option>`).join("")}</select>
      <label class="sr" for="tf-q">Filtrer</label>
      <input class="inp grow" id="tf-q" type="search" placeholder="Intitulé, récap, notes, contact…" value="${esc(f.q)}" autocomplete="off">
      <div class="seg" role="group" aria-label="Affichage">${mseg("liste", ic("list", "ic-sm") + " Liste")}${mseg("kanban", ic("board", "ic-sm") + " Kanban")}</div>
      <a class="btn sm pri" href="#/todo/new">${ic("plus", "ic-sm")}Tâche</a>
    </div>`;
  let body;
  if (S.error) body = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`;
  else if (!S.items || (f.v === "faites" && !S.done)) body = `<div class="card"><p class="empty">Chargement des tâches depuis Notion…</p></div>`;
  else {
    const list = filtered();
    const late = (S.items || []).filter((t) => !isDone(t) && t.echeance && ddiff(t.echeance) < 0).length;
    body = `${staleBanner(S.synchro)}<p class="small muted" style="margin:-4px 0 10px">${list.length} tâche${list.length > 1 ? "s" : ""}${f.v === "faites" ? " terminées ou annulées ces 14 derniers jours" : ` sur ${S.items.filter((t) => !isDone(t)).length} ouvertes, dont ${late} en retard`}${S.synchro ? `, ${syncSpan(S.synchro)}` : ""}${S.loading ? ", mise à jour…" : ""}.</p>`;
    if (!list.length) body += `<p class="empty">Aucune tâche pour ces filtres.</p>`;
    else if (f.mode === "kanban") body += kanban(list);
    else if (f.v === "faites") body += `<div class="card"><div class="list">${list.map(row).join("")}</div></div>`;
    else {
      const G = [["En retard", (t) => t.echeance && ddiff(t.echeance) < 0], ["Aujourd'hui", (t) => t.echeance && ddiff(t.echeance) === 0],
        ["Sept prochains jours", (t) => t.echeance && ddiff(t.echeance) > 0 && ddiff(t.echeance) <= 7], ["Plus tard", (t) => t.echeance && ddiff(t.echeance) > 7], ["Sans échéance", (t) => !t.echeance]];
      body += `<div class="grid2">${G.map(([lab, fn]) => { const it = list.filter(fn); return it.length ? `<section class="card"><div class="card-h"><h2>${lab}</h2><span class="count">${it.length}</span></div><div class="list">${it.map(row).join("")}</div></section>` : ""; }).join("")}</div>`;
    }
  }
  const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  host.innerHTML = head + body;
  if (active === "tf-q") { const i = $("#tf-q", host); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
}

function row(t) {
  const d = isDone(t);
  return `<div class="arow ${d ? "done" : ""}">
    <button class="chk ${d ? "done" : ""}" data-tdone="${t.id}" aria-label="${d ? "Rouvrir la tâche" : "Marquer comme terminée"}">${d ? ic("check", "ic-sm") : ""}</button>
    <a class="am" href="#/todo/${t.id}"><div class="an">${esc(t.nom)}</div>
      <div class="ameta">${prioChip(t)}${etatChip(t.etat)}${t.projets.slice(0, 1).map(projChip).join("")}${(t.themes || []).slice(0, 1).map(iniChip).join("")}${taSpan(t.typeAction)}</div></a>
    ${d ? "" : due(t.echeance)}</div>`;
}

// Kanban par état (repris du POC) : glisser une carte d'une colonne à l'autre change l'état dans Notion.
// Sur téléphone les colonnes s'empilent (aucun défilement horizontal) ; l'état se change dans la fiche.
const OPEN_COLS = ["A venir", "A faire", "En cours", "En attente", "À rédiger", "Prêt à relire"];
function kanban(list) {
  const states = S.schema?.editable?.["État"]?.options || [];
  const cols = S.f.v === "faites" ? ["Terminé", "Annulé"] : OPEN_COLS.filter((e) => states.includes(e));
  const extra = [...new Set(list.map((t) => t.etat))].filter((e) => e && !cols.includes(e) && !(S.f.v !== "faites" && isDone({ etat: e })));
  const mobile = window.matchMedia("(max-width: 900px)").matches;
  return `<p class="small muted" style="margin:-4px 0 10px">${mobile ? "Ouvre une carte pour changer son état." : "Glisse une carte d'une colonne à l'autre pour changer son état dans Notion."}</p>
    <div class="board">${[...cols, ...extra].map((e) => { const it = list.filter((t) => t.etat === e); return `<section class="col" data-drop="${esc(e)}"><div class="col-h">${esc(etatLabel(e))}<span class="n">${it.length}</span></div>${it.map(kcard).join("") || `<p class="small muted" style="padding:6px">Aucune tâche</p>`}</section>`; }).join("")}</div>`;
}
const kcard = (t) => `<a class="pcard acard" href="#/todo/${t.id}" draggable="true" data-drag="${t.id}"><div class="an">${esc(t.nom)}</div>
  <div class="chips">${prioChip(t)}${t.projets.slice(0, 1).map(projChip).join("")}${(t.themes || []).slice(0, 1).map(iniChip).join("")}</div>
  <div class="acard-f">${due(t.echeance)}${taSpan(t.typeAction)}</div></a>`;

// ---------------- Écritures ----------------

function applyTask(task) {
  const { id, nom, etat, prio, echeance, typeAction, bloc, projets: pr, contacts, pistes, themes, blocDeduit, texte, creeParAgent, modifie } = task;
  const item = { id, nom, etat, prio, echeance, typeAction, bloc, projets: pr, contacts, pistes, themes, blocDeduit, texte, creeParAgent, modifie };
  for (const arr of [S.items, S.done]) if (arr) { const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i] = item; }
  if (S.items && !S.items.some((x) => x.id === id) && !isDone(item)) S.items.push(item);
}

async function update(id, changes, okMsg, avant) {
  const r = await todoApi.update(id, changes, avant);
  applyTask(r.task);
  if (S.open?.id === id) { S.open.task = r.task; S.open.values = r.values; }
  if (isDone(r.task)) S.justDone.add(id);
  toast(okMsg);
  return r;
}

/** Case à cocher d'une ligne : Terminé, ou retour à « A faire ». */
async function toggleDone(id, btn) {
  const t = (S.items || []).concat(S.done || []).find((x) => x.id === id);
  if (!t) return;
  btn.disabled = true;
  try { await update(id, { "État": isDone(t) ? "A faire" : "Terminé" }, isDone(t) ? "Tâche rouverte." : "Tâche terminée dans Notion."); }
  catch (e) { toast(e.message, "err"); }
  finally { render(); renderDrawer(); }
}

// ---------------- Fiche ----------------

async function openTask(id) {
  const fromList = (S.items || []).concat(S.done || []).find((t) => t.id === id);
  const sec = S.open?.id === id ? S.open.sec : "synthese";
  S.open = { id, task: fromList ? { ...fromList, partial: true } : null, values: null, saving: new Set(), error: null, sec };
  setDrawerOwner("todo");
  renderDrawer();
  try {
    if (!S.schema) S.schema = await todoApi.schema();
    const r = await todoApi.get(id);
    if (S.open?.id !== id) return;
    S.open.task = r.task; S.open.values = r.values;
  } catch (e) { if (S.open?.id === id) S.open.error = e.message; }
  renderDrawer();
  contactsList().then(() => renderDrawer()); // noms et liste de choix des contacts
}

const FIELD_ORDER = ["Nom", "Récap", "État", "Échéance", "Prio", "Type d'action", "Bloc", "Durée estimée (min)"];
const LABEL = { Nom: "Intitulé", Prio: "Priorité" };

let contactsCache = [];
async function contactsList() { try { contactsCache = await contactIndex(); } catch { /* */ } return contactsCache; }
contactsList.sync = () => contactsCache;

const SECS = { synthese: "Synthèse", modifier: "Modifier", liens: "Projet et initiative" };

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost || !ownsDrawer("todo")) return;
  const t = o.task;
  ficheTop({ kind: o.isNew ? "Nouvelle tâche" : "Tâche", url: t?.url || null, side: !o.isNew });
  if (o.isNew) { drawerHost.innerHTML = newForm(o); return; }
  renderSide("todo", sideHTML({
    notes: [{ label: "Mes notes", text: t?.mesNotes, prop: "Mes notes", editable: !!(t && !t.partial && o.values && t.textesModifiables?.["Mes notes"] && S.schema?.editable?.["Mes notes"]), locked: t?.textesModifiables?.["Mes notes"] === false, saved: o.savedNote === "Mes notes" }],
    notesMissing: !t || t.partial ? "Chargement des notes…" : "",
    ordre: t && !t.partial ? { etat: t.ordreAgent, mission: t.ordreMission } : null,
  }));
  if (!t) { drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement de la tâche…</p>`; return; }
  const d = isDone(t);
  const states = S.schema?.editable?.["État"]?.options || [];
  const cNames = { ...(t.contactsNoms || {}) };
  for (const c of contactsList.sync()) if (t.contacts.some((x) => nid(x) === nid(c.id))) cNames[c.id] = c.nom;
  const nameOfContact = (id) => cNames[id] ?? Object.entries(cNames).find(([k]) => nid(k) === nid(id))?.[1] ?? "Contact";
  const nameOfProj = (id) => t.projetsNoms?.[id] ?? projById(id)?.nom ?? "Projet";
  const cur = SECS[o.sec] ? o.sec : "synthese";
  const body = {
    synthese: () => synthese(o, nameOfProj),
    modifier: () => `<h3 class="sh" style="margin-top:0">État</h3>
      <div class="statusbar" role="group" aria-label="Changer l'état">${states.map((s) => `<button class="${s === t.etat ? "on" : ""}" data-tstate="${esc(s)}" ${s === t.etat || o.saving.has("État") ? "disabled" : ""} aria-pressed="${s === t.etat}">${esc(etatLabel(s))}</button>`).join("")}</div>
      <h3 class="sh">Champs</h3>${o.values ? form(o) : `<p class="empty">Chargement des champs…</p>`}
      <p class="small muted" style="margin-top:10px">Chaque champ est enregistré dans Notion en le quittant. Mes notes se modifient dans le panneau de droite.${t.textesModifiables && !t.textesModifiables["Récap"] ? " Le récap a une mise en forme dans Notion (gras, lien, mention…) : il se modifie dans Notion pour ne pas la perdre." : ""}</p>`,
    liens: () => o.values ? iniSelect(o, "tl-th") + links(o, nameOfProj, nameOfContact) : `<p class="empty">Chargement…</p>`,
  }[cur]();

  swapHTML(drawerHost, `
    <div class="dh"><div class="dact">
      ${t.etat === "Annulé" ? `<button class="btn sm pri" data-tstate="A faire">${ic("refresh", "ic-sm")}Rétablir</button>`
        : d ? `<button class="btn sm" data-tstate="A faire">${ic("refresh", "ic-sm")}Rouvrir</button>`
        : `<button class="btn sm pri" data-tstate="Terminé">${ic("check", "ic-sm")}Marquer fait</button><button class="btn sm" data-tstate="Annulé">${ic("close", "ic-sm")}Annuler la tâche</button>`}
      <button class="btn sm" data-tsec="modifier">${ic("note", "ic-sm")}Reformuler</button></div>
      <span class="ifmt">${ic("todo")}</span><div style="flex:1;min-width:0"><h1 class="${d ? "strike" : ""}">${esc(t.nom)}</h1>
      <div class="chips" style="margin-top:8px">${etatChip(t.etat, true)}${t.prio ? chip(t.prio, t.prio === "P1" ? "red" : "") : ""}${t.typeAction ? `<span class="chip">${taSpan(t.typeAction)}</span>` : ""}${t.projets.map((p) => `<a class="chip pj" href="#/projets/${p}">${ic("folder", "ic-sm")}${esc(nameOfProj(p))}</a>`).join("")}${t.creeParAgent ? `<span class="chip dash">Créée par l'agent</span>` : ""}</div></div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${ficheTabs([["synthese", SECS.synthese], ["modifier", SECS.modifier], ["liens", SECS.liens, t.projets.length + t.contacts.length]], cur, "data-tsec")}
    <section class="cbody" aria-label="${SECS[cur]}">${body}</section>`);
}

function synthese(o, nameOfProj) {
  const t = o.task, d = isDone(t), busy = o.saving.has("Échéance");
  return `<div class="sfacts">
      <div><span>État</span><b>${esc(etatLabel(t.etat) || "Non renseigné")}</b>${t.prio ? `<small>${esc(t.prio)}</small>` : ""}</div>
      <div><span>Échéance</span><b>${t.echeance ? esc(fd(t.echeance)) : "Aucune"}</b>${t.echeance && !d ? `<small>${due(t.echeance)}</small>` : ""}
        ${o.values ? `<label class="echq"><span class="sr">Changer l'échéance</span><input type="date" data-tprop="Échéance" value="${esc(String(o.values["Échéance"] || "").slice(0, 10))}" ${busy ? "disabled" : ""}></label>` : ""}</div>
      <div><span>Bloc</span><b>${t.bloc ? esc(t.bloc) : t.blocDeduit ? `${esc(t.blocDeduit)} <span class="small muted">(déduit)</span>` : "Non renseigné"}</b>${!t.bloc && t.blocDeduit ? `<small>Déduit du type d'action et de l'état, rien n'est écrit dans Notion</small>` : ""}</div>
      <div><span>Durée estimée</span><b>${t.dureeMin != null ? `${t.dureeMin} min` : t.partial ? "…" : "Non renseignée"}</b>${t.typeAction ? `<small>${taSpan(t.typeAction)}</small>` : ""}</div>
      ${t.projets.map((p) => `<a class="sfact-link" href="#/projets/${p}"><span>Projet</span><b>${esc(nameOfProj(p))}</b><small>Ouvrir le projet ›</small></a>`).join("")}
      ${t.pistes ? `<div><span>Piste</span><b>${t.pistes} piste${t.pistes > 1 ? "s" : ""} liée${t.pistes > 1 ? "s" : ""}</b><small>Fiche piste au lot 2</small></div>` : ""}
    </div>
    ${o.values ? iniSelect(o, "ts-th") : ""}
    ${!t.projets.length && !t.pistes ? `<div class="banner dashed">${ic("alert", "ic-sm")}<span>Tâche rattachée à aucun projet ni piste.</span><button class="btn sm" data-tsec="liens">Rattacher</button></div>` : ""}
    ${t.recap ? `<h3 class="sh">Récap</h3><p class="notes">${esc(t.recap)}</p>` : ""}
    ${t.brouillon || t.lienSource ? `<div class="dact" style="margin:12px 0">${t.brouillon ? `<a class="btn sm pri" href="${esc(t.brouillon)}" target="_blank" rel="noopener">${ic("mail", "ic-sm")}Brouillon Gmail</a>` : ""}${t.lienSource ? `<a class="btn sm" href="${esc(t.lienSource)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Source</a>` : ""}</div>` : ""}
    ${t.syntheseAgent ? `<h3 class="sh">Synthèse agent</h3><p class="notes">${esc(t.syntheseAgent)}</p>` : ""}
    ${t.modifie ? `<p class="small muted" style="margin-top:14px">Modifiée dans Notion le ${esc(new Date(t.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}. Le récap se modifie dans l'onglet Modifier, Mes notes dans le panneau de droite.</p>` : ""}`;
}

/**
 * Choix de l'initiative (lot 1 bis, POC) : une seule par tâche, initiatives des projets de la tâche en tête.
 * Choisir une initiative rattache aussi la tâche à son projet (fait par la fonction todo).
 */
function iniSelect(o, id) {
  const t = o.task;
  if (!S.schema?.editable?.[THEME_REL]) return "";
  const busy = o.saving.has(THEME_REL);
  const cur = (t.themes || [])[0] || "";
  if ((t.themes || []).length > 1 || t.themesMore) {
    return `<div class="thq"><span class="lb">Initiatives</span><div class="chips">${t.themes.map(iniChip).join("")}</div><span class="small muted">Plusieurs initiatives : à modifier dans Notion.</span></div>`;
  }
  if (S.schema.initiativesIndisponibles) return `<p class="small muted">Initiatives indisponibles pour l'instant (Notion n'a pas répondu).${cur ? " Cette tâche en a une." : ""}</p>`;
  const linked = new Set(t.projets.map(nid));
  const groups = new Map();
  for (const x of initiatives()) {
    const pid = (x.projets || [])[0];
    const p = pid ? projById(pid) : null;
    if (!p) continue;
    if (x.etat === "Terminé" && nid(x.id) !== nid(cur)) continue;
    if (!groups.has(p.id)) groups.set(p.id, { p, items: [] });
    groups.get(p.id).items.push(x);
  }
  const order = [...groups.values()].sort((a, b) => (linked.has(nid(b.p.id)) - linked.has(nid(a.p.id))) || a.p.nom.localeCompare(b.p.nom, "fr"));
  return `<div class="thq"><label for="${id}">Initiative</label><select class="sel" id="${id}" data-tini="1" ${busy ? "disabled" : ""}>
    <option value="">Aucune initiative</option>${order.map((g) => `<optgroup label="${esc(g.p.nom)}">${g.items.map((x) => `<option value="${x.id}" ${nid(cur) === nid(x.id) ? "selected" : ""}>${esc(x.nom)}</option>`).join("")}</optgroup>`).join("")}
    ${cur && !iniById(cur) ? `<option value="${esc(cur)}" selected>Initiative liée (hors liste)</option>` : ""}</select>
    <span class="small muted">${busy ? "Enregistrement…" : "Choisir une initiative rattache aussi la tâche à son projet."}</span></div>`;
}

function links(o, nameOfProj, nameOfContact) {
  const t = o.task, busyP = o.saving.has("Projets"), busyC = o.saving.has(CONTACTS_REL);
  const linkedP = new Set(t.projets.map(nid)), linkedC = new Set(t.contacts.map(nid));
  const projChoices = projets().filter((p) => !linkedP.has(nid(p.id)) && p.etat !== "Annulé" && p.etat !== "Terminé");
  const contactChoices = contactsList.sync().filter((c) => !linkedC.has(nid(c.id)));
  return `<dl class="kv">
    <dt>Projets</dt><dd><div class="chips">${t.projets.map((p) => `<span class="chip pj">${ic("folder", "ic-sm")}<a href="#/projets/${p}">${esc(nameOfProj(p))}</a><button class="x" data-trel="Projets" data-trm="${p}" aria-label="Retirer le projet ${esc(nameOfProj(p))}" ${busyP || t.projetsMore ? "disabled" : ""}>×</button></span>`).join("") || `<span class="muted small">Aucun</span>`}</div>
      ${t.projetsMore ? "" : `<label class="sr" for="tl-p">Ajouter un projet</label><select class="sel addrel" id="tl-p" data-tadd="Projets" ${busyP ? "disabled" : ""}><option value="">+ Ajouter un projet</option>${projChoices.map((p) => `<option value="${p.id}">${esc(p.nom)}${p.etat === "Prospect" ? " (prospect)" : ""}</option>`).join("")}</select>`}</dd>
    <dt>Contacts</dt><dd><div class="chips">${t.contacts.map((c) => `<span class="chip"><a href="#/contacts/${c}">${esc(nameOfContact(c))}</a><button class="x" data-trel="${CONTACTS_REL}" data-trm="${c}" aria-label="Retirer ${esc(nameOfContact(c))}" ${busyC || t.contactsMore ? "disabled" : ""}>×</button></span>`).join("") || `<span class="muted small">Aucun</span>`}</div>
      ${t.contactsMore ? "" : `<label class="sr" for="tl-c">Ajouter un contact</label><input class="inp addrel" id="tl-c" list="tl-cl" placeholder="+ Ajouter un contact (nom)" autocomplete="off" ${busyC ? "disabled" : ""}>
      <datalist id="tl-cl">${contactChoices.map((c) => `<option value="${esc(c.nom)}">`).join("")}</datalist>`}</dd>
  </dl>${t.projetsMore || t.contactsMore ? `<p class="small muted">Trop de liens pour être modifiés ici, passe par Notion.</p>` : ""}`;
}

function form(o) {
  const ed = S.schema?.editable || {};
  return `<form class="form" onsubmit="return false">${FIELD_ORDER.filter((k) => ed[k]).map((k) => field(k, ed[k], o.values[k], o.saving.has(k), "tprop")).join("")}</form>`;
}

function field(name, def, value, saving, attr, idp = "tx-") {
  const id = idp + nrm(name).replace(/[^a-z0-9]+/g, "-");
  const lab = `<label for="${id}">${esc(LABEL[name] || name)} <span class="fstate">${saving ? "Enregistrement…" : ""}</span></label>`;
  const attrs = `id="${id}" data-${attr}="${esc(name)}" ${saving ? "disabled" : ""}`;
  const v = value ?? "";
  let input;
  if (def.options) {
    const opts = def.options.includes(v) || !v ? def.options : [v, ...def.options];
    input = `<select ${attrs}>${def.type === "status" ? "" : `<option value="">Non renseigné</option>`}${opts.map((x) => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(etatLabel(x))}</option>`).join("")}</select>`;
  } else if (def.type === "date") input = `<input type="date" ${attrs} value="${esc(String(v).slice(0, 10))}">`;
  else if (def.type === "number") input = `<input type="number" min="0" step="5" inputmode="numeric" ${attrs} value="${esc(v)}">`;
  else if (def.type === "rich_text") {
    const locked = attr === "tprop" && S.open?.task?.textesModifiables && !S.open.task.textesModifiables[name];
    input = locked ? `<p class="notes">${esc(v) || `<span class="muted">Vide</span>`}</p>` : `<textarea ${attrs} rows="4" maxlength="10000">${esc(v)}</textarea>`;
  }
  else input = `<input type="text" ${attrs} value="${esc(v)}" autocomplete="off" ${def.type === "title" ? "required" : ""}>`;
  return `<div class="fld ${def.type === "title" || def.type === "rich_text" ? "wide" : ""}">${lab}${input}</div>`;
}

async function saveField(el) {
  const o = S.open, prop = el.dataset.tprop;
  if (!o || !o.values || !prop) return;
  const type = S.schema.editable[prop]?.type;
  const val = el.value.trim();
  if (String(o.values[prop] ?? "").slice(0, type === "date" ? 10 : undefined) === val) return;
  if (type === "title" && !val) { el.value = o.values[prop]; toast("L'intitulé ne peut pas être vide.", "err"); return; }
  const avant = TEXTES.includes(prop) ? { [prop]: o.values[prop] ?? "" } : undefined;
  await saving(prop, () => update(o.id, { [prop]: val === "" ? null : type === "number" ? Number(val) : val }, `${LABEL[prop] || prop} enregistré dans Notion.`, avant));
}

setNoteSaver("todo", async (prop, value, before) => {
  const o = S.open;
  if (!o || o.isNew) return;
  try {
    await update(o.id, { [prop]: value || null }, "Notes enregistrées dans Notion.", { [prop]: before });
    o.savedNote = prop;
  } catch (e) {
    if (e.code === "conflit" || e.code === "mise_en_forme") { toast(e.message, "err"); openTask(o.id); return; }
    throw e;
  }
  renderDrawer(); render();
});

async function saving(prop, fn) {
  const o = S.open;
  o.saving.add(prop); renderDrawer();
  try { await fn(); } catch (e) {
    toast(e.message, "err");
    if (e.code === "conflit" || e.code === "mise_en_forme") { o.saving.delete(prop); openTask(o.id); return; }
  }
  finally { o.saving.delete(prop); renderDrawer(); render(); }
}

// ---------------- Création ----------------

async function openNew(contactId, projetId) {
  S.open = { id: "new", isNew: true, contactId: contactId || null, projetId: projetId || null, saving: new Set(), error: null };
  setDrawerOwner("todo");
  renderDrawer();
  try { if (!S.schema) S.schema = await todoApi.schema(); } catch (e) { S.open.error = e.message; }
  await contactsList();
  renderDrawer();
  setTimeout(() => $("#tn-nom")?.focus(), 50);
}

function newForm(o) {
  if (!S.schema) return o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement…</p>`;
  const ed = S.schema.editable;
  const c = o.contactId ? contactsList.sync().find((x) => nid(x.id) === nid(o.contactId)) : null;
  const projChoices = projets().filter((p) => p.etat !== "Annulé" && p.etat !== "Terminé");
  return `<div class="dh"><span class="ifmt">${ic("plus")}</span><div><h1>Nouvelle tâche</h1><div class="sub">Créée directement dans la base TO DO de Notion.</div></div></div>
    <form class="form" id="tn-form">
      <div class="fld wide"><label for="tn-nom">Intitulé</label><input id="tn-nom" required autocomplete="off" placeholder="Ex. Relancer Benoît pour le devis"></div>
      ${field("État", ed["État"], "A faire", false, "tnew", "tn-")}
      ${field("Échéance", ed["Échéance"], "", false, "tnew", "tn-")}
      ${ed["Prio"] ? field("Prio", ed["Prio"], "", false, "tnew", "tn-") : ""}
      ${ed["Type d'action"] ? field("Type d'action", ed["Type d'action"], "", false, "tnew", "tn-") : ""}
      <div class="fld"><label for="tn-proj">Projet</label><select id="tn-proj"><option value="">Aucun</option>${projChoices.map((p) => `<option value="${p.id}" ${o.projetId && nid(o.projetId) === nid(p.id) ? "selected" : ""}>${esc(p.nom)}</option>`).join("")}</select></div>
      <div class="fld"><label for="tn-contact">Contact</label><input id="tn-contact" list="tn-cl" autocomplete="off" placeholder="Nom du contact" value="${esc(c?.nom || "")}">
        <datalist id="tn-cl">${contactsList.sync().map((x) => `<option value="${esc(x.nom)}">`).join("")}</datalist></div>
      ${o.error ? `<div class="banner wide">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
      <div class="mfoot wide"><a class="btn sm" href="${o.contactId ? `#/contacts/${o.contactId}` : o.projetId ? `#/projets/${o.projetId}` : "#/todo"}">Annuler</a><button class="btn sm pri" type="submit" ${o.saving.has("new") ? "disabled" : ""}>${o.saving.has("new") ? "Création…" : "Créer dans Notion"}</button></div>
    </form>`;
}

function contactIdByName(name) {
  const n = nrm(name.trim());
  if (!n) return null;
  const all = contactsList.sync();
  return (all.find((c) => nrm(c.nom) === n) || null)?.id ?? undefined; // undefined : nom inconnu
}

async function submitNew(form) {
  const o = S.open;
  const v = (sel) => form.querySelector(sel)?.value.trim() ?? "";
  const values = { "Nom": v("#tn-nom"), "État": v("[data-tnew='État']") || "A faire" };
  for (const k of ["Échéance", "Prio", "Type d'action"]) { const x = form.querySelector(`[data-tnew="${k}"]`)?.value; if (x) values[k] = x; }
  if (v("#tn-proj")) values["Projets"] = [v("#tn-proj")];
  const cname = v("#tn-contact");
  if (cname) {
    const cid = contactIdByName(cname);
    if (!cid) { o.error = `Contact « ${cname} » introuvable parmi les contacts actifs.`; renderDrawer(); return; }
    values[CONTACTS_REL] = [cid];
  }
  if (!values["Nom"]) { o.error = "Donne un intitulé à la tâche."; renderDrawer(); return; }
  o.saving.add("new"); o.error = null; renderDrawer();
  try {
    const r = await todoApi.create(values);
    applyTask(r.task);
    toast("Tâche créée dans Notion.");
    location.hash = `#/todo/${r.task.id}`;
  } catch (e) { o.error = e.message; o.saving.delete("new"); renderDrawer(); }
  render();
}

// ---------------- Événements ----------------

export function bindTodoEvents(root) {
  root.addEventListener("click", (e) => {
    const v = e.target.closest("[data-tv]");
    if (v) { S.f.v = v.dataset.tv; render(); if (S.f.v === "faites" && !S.done) loadDone().then(render); return; }
    const chk = e.target.closest("[data-tdone]");
    if (chk) { e.preventDefault(); toggleDone(chk.dataset.tdone, chk); return; }
    const m = e.target.closest("[data-tmode]");
    if (m) { S.f.mode = m.dataset.tmode; render(); }
  });
  // Glisser-déposer du kanban (souris, ordinateur).
  let dragId = null;
  root.addEventListener("dragstart", (e) => { const c = e.target.closest?.("[data-drag]"); if (!c) return; dragId = c.dataset.drag; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
  root.addEventListener("dragend", (e) => { e.target.closest?.("[data-drag]")?.classList.remove("dragging"); root.querySelectorAll(".col.over").forEach((c) => c.classList.remove("over")); });
  root.addEventListener("dragover", (e) => { const col = e.target.closest?.("[data-drop]"); if (!col || !dragId) return; e.preventDefault(); root.querySelectorAll(".col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); });
  root.addEventListener("drop", async (e) => {
    const col = e.target.closest?.("[data-drop]"); if (!col || !dragId) return;
    e.preventDefault(); col.classList.remove("over");
    const id = dragId, etat = col.dataset.drop; dragId = null;
    const t = (S.items || []).concat(S.done || []).find((x) => x.id === id);
    if (!t || t.etat === etat) return;
    try { await update(id, { "État": etat }, `État : ${etatLabel(etat)}.`); } catch (err) { toast(err.message, "err"); }
    render(); renderDrawer();
  });
  root.addEventListener("input", (e) => { if (e.target.id === "tf-q") { S.f.q = e.target.value; render(); } });
  root.addEventListener("change", (e) => { if (e.target.id === "tf-p") { S.f.proj = e.target.value; render(); } });
}

export function bindTodoDrawerEvents(root) {
  root.addEventListener("click", (e) => {
    if (!ownsDrawer("todo") || !S.open || S.open.isNew) return;
    const sec = e.target.closest("[data-tsec]");
    if (sec) { S.open.sec = sec.dataset.tsec; renderDrawer(); root.scrollTop = 0; return; }
    const st = e.target.closest("[data-tstate]");
    if (st) { const s = st.dataset.tstate; saving("État", () => update(S.open.id, { "État": s }, `État : ${etatLabel(s)}.`)); return; }
    const rm = e.target.closest("[data-trm]");
    if (rm) { const prop = rm.dataset.trel; saving(prop, () => update(S.open.id, { [prop]: { remove: [rm.dataset.trm] } }, "Lien retiré dans Notion.")); }
  });
  root.addEventListener("change", (e) => {
    if (!ownsDrawer("todo") || !S.open) return;
    const el = e.target;
    if (el.dataset?.tprop) { saveField(el); return; }
    if (el.dataset?.tini) { const v = el.value; saving(THEME_REL, () => update(S.open.id, { [THEME_REL]: { set: v ? [v] : [] } }, v ? "Initiative enregistrée dans Notion." : "Initiative retirée dans Notion.")); return; }
    if (el.dataset?.tadd === "Projets" && el.value) { const id = el.value; saving("Projets", () => update(S.open.id, { "Projets": { add: [id] } }, "Projet ajouté dans Notion.")); return; }
    if (el.id === "tl-c" && el.value.trim()) {
      const id = contactIdByName(el.value);
      if (!id) { toast(`Contact « ${el.value} » introuvable parmi les contacts actifs.`, "err"); return; }
      saving(CONTACTS_REL, () => update(S.open.id, { [CONTACTS_REL]: { add: [id] } }, "Contact ajouté dans Notion."));
    }
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id === "tn-form") { e.preventDefault(); submitNew(e.target); }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.tprop && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); }
  });
}

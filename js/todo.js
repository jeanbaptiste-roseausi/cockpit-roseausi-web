// Vue « TO DO » : tâches ouvertes groupées par échéance (comme le POC), fiche modifiable,
// changement d'état en un clic, création de tâche.
import { todoApi } from "./api.js";
import { contactIndex } from "./contacts.js";
import { og } from "./origines.js";
import { ppOpts, ppSel, ppDate, ppTxt, ppLink, ppBtn, ppBand, saFold, DUR_OPT, fmtMin } from "./props.js";
import { jetonsHTML } from "./jetons.js";
import { $, esc, ic, nrm, fd, due, chip, toast, toastUndo, setDrawerOwner, ownsDrawer, etatChip, etatLabel, isDone, ficheTop, renderSide, sideHTML, ficheTabs, taSpan, syncOf, syncSpan, staleBanner, setNoteSaver , swapHTML } from "./ui.js";

const PROSPECTION_PROJECT = "3e6a08ac559780ccb74ce21b2d7e2bbb"; // projet « Prospection » (filtre du POC)
const CONTACTS_REL = "👱‍♀️ Contacts";
const THEME_REL = "Thème";
const PISTES_REL = "Pistes/Opportunités"; // lot 2 (suite)
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
  label: "Actions",
  icon: "todo",
  async mount(container, drawer) {
    host = container; drawerHost = drawer;
    render();
    if (!S.items) await load();
  },
  open: (id) => (id === "new" ? openNew() : openTask(id)),
  // #/todo/new/<id du contact>, #/todo/new/projet/<id du projet> ou #/todo/new/piste/<id de la piste>
  openNew: (a, b) => (a === "projet" ? openNew(null, b) : a === "piste" ? openNew(null, null, b) : openNew(a)),
  close: () => { S.open = null; },
  reload: () => { S.justDone.clear(); S.done = null; return load(true); },
};

async function load(force = false) {
  if (S.loading) return;
  S.loading = true; S.error = null; render();
  try {
    const [list, schema] = await Promise.all([todoApi.list(), S.schema && !force ? S.schema : todoApi.schema()]);
    S.items = list.tasks; S.fetchedAt = list.fetchedAt; S.synchro = syncOf(list); S.schema = schema;
    S.pistesNoms = { ...(S.pistesNoms || {}), ...(list.pistesNoms || {}) };
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
// Pistes (lot 2, suite) : noms renvoyés par la fonction todo (liste) ou choix du schéma.
const pisteName = (id) => S.pistesNoms?.[id] ?? (S.schema?.pistes || []).find((p) => nid(p.id) === nid(id))?.nom;
const pisteChip = (id) => { const n = pisteName(id); return n ? `<span class="chip st-encours" title="Piste">${ic("target", "ic-sm")}${esc(n)}</span>` : ""; };
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
  if (q) list = list.filter((t) => nrm([t.nom, t.typeAction, t.texte, ...t.projets.map((p) => projById(p)?.nom), ...(t.themes || []).map((x) => iniById(x)?.nom), ...(t.contacts || []).map(contactName), ...(t.pistesIds || []).map(pisteName)].join(" ")).includes(q));
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
      <div class="ameta">${prioChip(t)}${etatChip(t.etat)}${t.projets.slice(0, 1).map(projChip).join("")}${(t.pistesIds || []).slice(0, 1).map(pisteChip).join("")}${(t.themes || []).slice(0, 1).map(iniChip).join("")}${taSpan(t.typeAction)}</div></a>
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
// Carte du kanban (retours du 26/11) : vraie carte (fond, bordure fine, coins arrondis), titre en gras sans
// soulignement, la carte entière ouvre la fiche ; dessous, une ligne discrète (projet ou piste en petite pastille,
// échéance, type d'action, priorité). Liseré à gauche : rouge si la tâche est en retard, orange si c'est une P1.
const todayParis = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
function kcard(t) {
  const d = isDone(t), late = !d && !!t.echeance && t.echeance.slice(0, 10) < todayParis(), p1 = !d && t.prio === "P1";
  const lien = t.projets.slice(0, 1).map(projChip).join("") || (t.pistesIds || []).slice(0, 1).map(pisteChip).join("");
  const flag = late ? "En retard" : p1 ? "Priorité P1" : "";
  return `<a class="pcard acard${late ? " is-late" : p1 ? " is-p1" : ""}" href="#/todo/${t.id}" draggable="true" data-drag="${t.id}"${flag ? ` title="${flag}"` : ""}>
  <div class="an">${esc(t.nom)}</div>
  <div class="acard-f">${lien}${due(t.echeance)}${taSpan(t.typeAction)}${prioChip(t)}${flag ? `<span class="sr">, ${flag}</span>` : ""}</div></a>`;
}

// ---------------- Écritures ----------------

function applyTask(task) {
  const { id, nom, etat, prio, echeance, typeAction, bloc, projets: pr, contacts, pistes, pistesIds, themes, blocDeduit, texte, creeParAgent, modifie } = task;
  const item = { id, nom, etat, prio, echeance, typeAction, bloc, projets: pr, contacts, pistes, pistesIds, themes, blocDeduit, texte, creeParAgent, modifie };
  for (const p of task.pistesListe || []) (S.pistesNoms ||= {})[p.id] = p.nom;
  for (const arr of [S.items, S.done]) if (arr) { const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i] = item; }
  if (S.items && !S.items.some((x) => x.id === id) && !isDone(item)) S.items.push(item);
}

async function update(id, changes, okMsg, avant) {
  const r = await todoApi.update(id, changes, avant);
  applyTask(r.task);
  if (S.open?.id === id) { S.open.task = r.task; S.open.values = r.values; }
  if (isDone(r.task)) S.justDone.add(id);
  if (okMsg) toast(okMsg);
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
    notes: [{ label: "Mes notes", text: t?.mesNotes, prop: "Mes notes", editable: !!(t && !t.partial && o.values && t.textesModifiables?.["Mes notes"] && S.schema?.editable?.["Mes notes"]), locked: t?.textesModifiables?.["Mes notes"] === false, saved: o.savedNote === "Mes notes", og: og("todo", "Mes notes") }],
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
    synthese: () => synthese(o),
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
      ${band(o, nameOfProj)}</div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${ficheTabs([["synthese", SECS.synthese], ["modifier", SECS.modifier], ["liens", SECS.liens, t.projets.length + t.contacts.length]], cur, "data-tsec")}
    <section class="cbody" aria-label="${SECS[cur]}">${body}</section>`);
}

// Estimation de la durée d'après le type d'action, tant que la durée n'est pas fixée (artefact, DUR_TA).
const DUR_TA = { Email: 5, "Compte rendu": 10, "Ordre du jour": 15, Relance: 5, "Prise de contact": 10, Production: 45, Recherche: 30, "Point à creuser": 15 };

/**
 * Bande de propriétés de la tâche (fiches compactes, 27/11/2026). Les listes portent data-tprop ou data-tini :
 * l'écriture suit saveField et le choix d'initiative existants.
 */
function band(o, nameOfProj) {
  const t = o.task, d = isDone(t), ed = S.schema?.editable || {}, ready = !!(o.values && !t.partial);
  const can = (k) => ready && !!ed[k];
  const opts = (k, empty) => ppOpts([...(empty ? [["", empty]] : []), ...(ed[k]?.options || []).map((x) => [x, etatLabel(x)])], o.values?.[k] ?? "");
  const late = t.echeance && !d && t.echeance.slice(0, 10) < today(), now = t.echeance && !d && t.echeance.slice(0, 10) === today();
  const ini = iniOptions(o);
  const iniNom = (t.themes || [])[0] ? (iniById(t.themes[0])?.nom || "Initiative liée") : "";
  const chips = [
    can("État") ? ppSel(`data-tprop="État"`, opts("État"), esc(etatLabel(t.etat) || "Sans état"), "État de la tâche", etatCls(t.etat), o.saving.has("État")) : etatChip(t.etat, true).replace('class="chip', 'class="chip pp'),
    can("Prio") ? ppSel(`data-tprop="Prio"`, opts("Prio", "Sans priorité"), t.prio ? esc(t.prio) : "+ Priorité", "Priorité", t.prio === "P1" && !d ? "c-crit" : t.prio ? "" : "pp-add dash", o.saving.has("Prio")) : t.prio ? ppTxt(esc(t.prio), t.prio === "P1" && !d ? "c-crit" : "") : "",
    can("Échéance") ? ppDate(`data-tprop="Échéance"`, o.values["Échéance"], t.echeance ? `${late ? ic("alert", "ic-sm") : ""}${now ? "Aujourd'hui" : esc(fd(t.echeance))}` : "+ Échéance", "Échéance", late ? "c-crit" : now ? "today" : t.echeance ? "" : "pp-add dash", o.saving.has("Échéance"))
      : t.echeance ? ppTxt(esc(fd(t.echeance)), late ? "c-crit" : "") : "",
    ...t.projets.map((p) => ppLink(`#/projets/${p}`, `${ic("folder", "ic-sm")}${esc(nameOfProj(p))}`, "pj", "Ouvrir le projet")),
    ini && ready ? ppSel(`data-tini="1"`, ini, iniNom ? `${ic("layers", "ic-sm")}${esc(iniNom)}` : "+ Initiative", "Initiative, choisir une initiative rattache aussi la tâche à son projet", iniNom ? "" : "pp-add dash", o.saving.has(THEME_REL))
      : (t.themes || []).map(iniChip).join("").replaceAll('class="chip', 'class="chip pp'),
    ...(t.pistesListe || []).map((p) => ppLink(`#/pistes/${p.id}`, `${ic("target", "ic-sm")}${esc(p.nom)}`, "pi", "Ouvrir la piste")),
    !t.projets.length && !t.pistes ? ppBtn(`data-tsec="liens"`, "+ Projet ou piste", "pp-add dash", "Rattacher la tâche") : "",
    can("Type d'action") ? ppSel(`data-tprop="Type d'action"`, opts("Type d'action", "Non défini"), t.typeAction ? taSpan(t.typeAction) : "+ Type", "Type d'action", t.typeAction ? "" : "pp-add dash", o.saving.has("Type d'action")) : t.typeAction ? ppTxt(taSpan(t.typeAction)) : "",
    can("Bloc") ? ppSel(`data-tprop="Bloc"`, opts("Bloc", "Non défini"), esc(t.bloc || t.blocDeduit || "+ Bloc"), t.bloc ? "Bloc" : "Bloc déduit du type d'action et de l'état, choisis-en un pour le fixer", t.bloc ? "" : t.blocDeduit ? "pp-calc dash" : "pp-add dash", o.saving.has("Bloc"))
      : t.bloc || t.blocDeduit ? ppTxt(esc(t.bloc || t.blocDeduit), t.bloc ? "" : "pp-calc dash", t.bloc ? "Bloc" : "Déduit du type d'action et de l'état") : "",
    can("Durée estimée (min)") ? ppSel(`data-tprop="Durée estimée (min)"`, ppOpts(DUR_OPT, o.values["Durée estimée (min)"] ?? ""), t.dureeMin != null ? fmtMin(t.dureeMin) : "≈ " + fmtMin(DUR_TA[t.typeAction] || 15), t.dureeMin != null ? "Durée estimée" : "Durée estimée d'après le type, choisis-en une pour la fixer", t.dureeMin != null ? "" : "pp-calc dash", o.saving.has("Durée estimée (min)"))
      : t.dureeMin != null ? ppTxt(fmtMin(t.dureeMin)) : "",
    t.creeParAgent ? ppTxt("Créée par l'agent", "pp-calc dash") : "",
  ];
  return ppBand(chips);
}
const etatCls = (e) => (etatChip(e, true).match(/class="chip ([^"]*)"/) || [])[1] || "";

function synthese(o) {
  const t = o.task;
  return `<h3 class="sh">Récap</h3>${t.recap ? `<p class="rec">${esc(t.recap)}</p>` : t.partial ? `<p class="empty">Chargement…</p>` : `<p class="empty">Pas encore de récap. <button class="lnk" data-tsec="modifier">L'écrire</button></p>`}
    ${t.brouillon || t.lienSource ? `<div class="dact" style="margin:12px 0">${t.brouillon ? `<a class="btn sm pri" href="${esc(t.brouillon)}" target="_blank" rel="noopener">${ic("mail", "ic-sm")}Brouillon Gmail</a>` : ""}${t.lienSource ? `<a class="btn sm" href="${esc(t.lienSource)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Source</a>` : ""}</div>` : ""}
    ${saFold(t.syntheseAgent)}
    ${t.modifie ? `<p class="small muted" style="margin-top:14px">Modifiée dans Notion le ${esc(new Date(t.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}. Le récap se modifie dans l'onglet Modifier, Mes notes dans le panneau de droite.</p>` : ""}`;
}

/** Options de la liste d'initiatives (groupées par projet, projets de la tâche en tête), ou null si indisponible. */
function iniOptions(o) {
  const t = o.task;
  if (!S.schema?.editable?.[THEME_REL] || (t.themes || []).length > 1 || t.themesMore || S.schema.initiativesIndisponibles) return null;
  const cur = (t.themes || [])[0] || "";
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
  return `<option value="">Aucune initiative</option>${order.map((g) => `<optgroup label="${esc(g.p.nom)}">${g.items.map((x) => `<option value="${x.id}" ${nid(cur) === nid(x.id) ? "selected" : ""}>${esc(x.nom)}</option>`).join("")}</optgroup>`).join("")}
    ${cur && !iniById(cur) ? `<option value="${esc(cur)}" selected>Initiative liée (hors liste)</option>` : ""}`;
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
  return `<div class="thq"><label for="${id}">Initiative${og("todo", "Thème")}</label><select class="sel" id="${id}" data-tini="1" ${busy ? "disabled" : ""}>
    <option value="">Aucune initiative</option>${order.map((g) => `<optgroup label="${esc(g.p.nom)}">${g.items.map((x) => `<option value="${x.id}" ${nid(cur) === nid(x.id) ? "selected" : ""}>${esc(x.nom)}</option>`).join("")}</optgroup>`).join("")}
    ${cur && !iniById(cur) ? `<option value="${esc(cur)}" selected>Initiative liée (hors liste)</option>` : ""}</select>
    <span class="small muted">${busy ? "Enregistrement…" : "Choisir une initiative rattache aussi la tâche à son projet."}</span></div>`;
}

// Rattachements en jetons (artefact) : chaque ajout ou retrait part aussitôt dans Notion, avec « Annuler ».
function links(o, nameOfProj, nameOfContact) {
  const t = o.task;
  const row = (prop, label, title, items, choices, more, ph) => `<dt>${label}${og("todo", prop)}</dt><dd>${jetonsHTML({
    id: "tl-" + nrm(prop).replace(/[^a-z0-9]+/g, "-"), label: title, placeholder: ph, busy: o.saving.has(prop), locked: more,
    items, choices, onAdd: (id) => relTask(prop, "add", id), onRemove: (id) => relTask(prop, "remove", id),
  })}</dd>`;
  const projChoices = projets().filter((p) => p.etat !== "Annulé" && p.etat !== "Terminé").map((p) => ({ id: p.id, nom: p.nom, sub: p.etat === "Prospect" ? "prospect" : "" }));
  const pisteRow = S.schema?.editable?.[PISTES_REL] ? row(PISTES_REL, "Pistes", "Pistes de la tâche",
    (t.pistesIds || []).map((p) => ({ id: p, nom: pisteName(p) || "Piste", href: `#/pistes/${p}`, icon: "target" })),
    (S.schema?.pistes || []).map((p) => ({ id: p.id, nom: p.nom, sub: p.issue || "" })), t.pistesMore, "Rattacher une piste") : "";
  return `<dl class="kv">
    ${row("Projets", "Projets", "Projets de la tâche", t.projets.map((p) => ({ id: p, nom: nameOfProj(p), href: `#/projets/${p}`, icon: "folder", cls: "pj" })), projChoices, t.projetsMore, "Rattacher un projet")}
    ${row(CONTACTS_REL, "Contacts", "Contacts de la tâche", t.contacts.map((c) => ({ id: c, nom: nameOfContact(c), href: `#/contacts/${c}` })), contactsList.sync().map((c) => ({ id: c.id, nom: c.nom })), t.contactsMore, "Rattacher un contact")}
    ${pisteRow}
  </dl>${t.projetsMore || t.contactsMore ? `<p class="small muted">Trop de liens pour être modifiés ici, passe par Notion.</p>` : `<p class="small muted">Chaque ajout ou retrait part tout de suite dans Notion. Une erreur ? La croix retire le lien, et « Annuler » le remet.</p>`}`;
}

const REL_LAB = { "Projets": ["Projet ajouté", "Projet retiré"], [CONTACTS_REL]: ["Contact ajouté", "Contact retiré"], [PISTES_REL]: ["Piste rattachée", "Piste retirée"] };
function relTask(prop, op, id, undoable = true, tid = S.open?.id) {
  const [addL, rmL] = REL_LAB[prop] || ["Lien ajouté", "Lien retiré"];
  const go = async () => {
    await update(tid, { [prop]: { [op]: [id] } }, undoable ? "" : `${op === "add" ? addL : rmL} de nouveau.`);
    if (undoable) toastUndo(`${op === "add" ? addL : rmL} dans Notion.`, () => relTask(prop, op === "add" ? "remove" : "add", id, false, tid));
  };
  const o = S.open;
  // Fiche fermée entre-temps (Annuler) : l'écriture part quand même, sans état d'attente à afficher.
  if (!o || o.id !== tid) return go().then(render, (e) => toast(e.message, "err"));
  if (o.saving.has(prop)) return;
  return saving(prop, go);
}

function form(o) {
  const ed = S.schema?.editable || {};
  return `<form class="form" onsubmit="return false">${FIELD_ORDER.filter((k) => ed[k]).map((k) => field(k, ed[k], o.values[k], o.saving.has(k), "tprop")).join("")}</form>`;
}

function field(name, def, value, saving, attr, idp = "tx-") {
  const id = idp + nrm(name).replace(/[^a-z0-9]+/g, "-");
  const lab = `<label for="${id}">${esc(LABEL[name] || name)}${attr === "tprop" ? og("todo", name) : ""} <span class="fstate">${saving ? "Enregistrement…" : ""}</span></label>`;
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

async function openNew(contactId, projetId, pisteId) {
  S.open = { id: "new", isNew: true, contactId: contactId || null, projetId: projetId || null, pisteId: pisteId || null, saving: new Set(), error: null };
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
      ${ed[PISTES_REL] ? `<div class="fld"><label for="tn-piste">Piste</label><select id="tn-piste"><option value="">Aucune</option>${(S.schema.pistes || []).map((p) => `<option value="${p.id}" ${o.pisteId && nid(o.pisteId) === nid(p.id) ? "selected" : ""}>${esc(p.nom)}</option>`).join("")}</select></div>` : ""}
      ${o.error ? `<div class="banner wide">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
      <div class="mfoot wide"><a class="btn sm" href="${o.contactId ? `#/contacts/${o.contactId}` : o.projetId ? `#/projets/${o.projetId}` : o.pisteId ? `#/pistes/${o.pisteId}` : "#/todo"}">Annuler</a><button class="btn sm pri" type="submit" ${o.saving.has("new") ? "disabled" : ""}>${o.saving.has("new") ? "Création…" : "Créer dans Notion"}</button></div>
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
  if (v("#tn-piste")) values[PISTES_REL] = [v("#tn-piste")];
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
  });
  root.addEventListener("change", (e) => {
    if (!ownsDrawer("todo") || !S.open) return;
    const el = e.target;
    if (el.dataset?.tprop) { saveField(el); return; }
    if (el.dataset?.tini) { const v = el.value; saving(THEME_REL, () => update(S.open.id, { [THEME_REL]: { set: v ? [v] : [] } }, v ? "Initiative enregistrée dans Notion." : "Initiative retirée dans Notion.")); return; }
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id === "tn-form") { e.preventDefault(); submitNew(e.target); }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.tprop && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); }
  });
}

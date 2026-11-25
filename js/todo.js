// Vue « TO DO » : tâches ouvertes groupées par échéance (comme le POC), fiche modifiable,
// changement d'état en un clic, création de tâche.
import { todoApi } from "./api.js";
import { contactIndex } from "./contacts.js";
import { $, esc, ic, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip, etatLabel, isDone } from "./ui.js";

const PROSPECTION_PROJECT = "3e6a08ac559780ccb74ce21b2d7e2bbb"; // projet « Prospection » (filtre du POC)
const CONTACTS_REL = "👱‍♀️ Contacts";

const S = {
  items: null, done: null, schema: null, loading: false, error: null, fetchedAt: null,
  f: { v: "ouvertes", proj: "", q: "" },
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
    S.items = list.tasks; S.fetchedAt = list.fetchedAt; S.schema = schema;
    if (S.f.v === "faites") await loadDone();
  } catch (e) { S.error = e.message; }
  finally { S.loading = false; render(); }
}
async function loadDone() {
  try { S.done = (await todoApi.list({ scope: "done" })).tasks; } catch (e) { S.done = []; toast(e.message, "err"); }
}

const projets = () => S.schema?.projets || [];
const projById = (id) => projets().find((p) => nid(p.id) === nid(id));
const projChip = (id) => { const p = projById(id); return p ? `<span class="chip pj">${ic("folder", "ic-sm")}${esc(p.nom)}</span>` : ""; };
const prioChip = (t) => t.prio === "P1" && !isDone(t) ? chip("P1", "red") : t.prio && !isDone(t) ? chip(t.prio) : "";

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
  if (q) list = list.filter((t) => nrm([t.nom, t.typeAction, ...t.projets.map((p) => projById(p)?.nom)].join(" ")).includes(q));
  if (f.v !== "faites") list.sort((a, b) => (a.echeance || "9").localeCompare(b.echeance || "9") || (a.prio || "P9").localeCompare(b.prio || "P9"));
  return list;
}

function render() {
  if (!host) return;
  const f = S.f;
  const seg = (v, lab) => `<button class="${f.v === v ? "on" : ""}" data-tv="${v}">${lab}</button>`;
  const usedProj = new Set((S.items || []).flatMap((t) => t.projets.map(nid)));
  const projOpts = projets().filter((p) => usedProj.has(nid(p.id)));
  const head = `<div class="bar">
      <div class="seg" role="group" aria-label="Vue">${seg("ouvertes", "Ouvertes")}${seg("retard", "En retard")}${seg("relire", "À relire")}${seg("prospection", "Prospection")}${seg("faites", "Faites (14 j)")}</div>
      <label class="sr" for="tf-p">Projet</label>
      <select class="sel" id="tf-p"><option value="">Tous les projets</option>${projOpts.map((p) => `<option value="${p.id}" ${f.proj === p.id ? "selected" : ""}>${esc(p.nom)}</option>`).join("")}</select>
      <label class="sr" for="tf-q">Filtrer</label>
      <input class="inp grow" id="tf-q" type="search" placeholder="Intitulé, projet, type…" value="${esc(f.q)}" autocomplete="off">
      <a class="btn sm pri" href="#/todo/new">${ic("plus", "ic-sm")}Tâche</a>
    </div>`;
  let body;
  if (S.error) body = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`;
  else if (!S.items || (f.v === "faites" && !S.done)) body = `<div class="card"><p class="empty">Chargement des tâches depuis Notion…</p></div>`;
  else {
    const list = filtered();
    const late = (S.items || []).filter((t) => !isDone(t) && t.echeance && ddiff(t.echeance) < 0).length;
    body = `<p class="small muted" style="margin:-4px 0 10px">${list.length} tâche${list.length > 1 ? "s" : ""}${f.v === "faites" ? " terminées ou annulées ces 14 derniers jours" : ` sur ${S.items.filter((t) => !isDone(t)).length} ouvertes, dont ${late} en retard`}${S.fetchedAt ? `, lues dans Notion à ${new Date(S.fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}${S.loading ? ", mise à jour…" : ""}.</p>`;
    if (!list.length) body += `<p class="empty">Aucune tâche pour ces filtres.</p>`;
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
      <div class="ameta">${prioChip(t)}${etatChip(t.etat)}${t.projets.slice(0, 1).map(projChip).join("")}${t.typeAction ? `<span class="ta">${esc(t.typeAction)}</span>` : ""}</div></a>
    ${d ? "" : due(t.echeance)}</div>`;
}

// ---------------- Écritures ----------------

function applyTask(task) {
  const { id, nom, etat, prio, echeance, typeAction, bloc, projets: pr, contacts, pistes, creeParAgent, modifie } = task;
  const item = { id, nom, etat, prio, echeance, typeAction, bloc, projets: pr, contacts, pistes, creeParAgent, modifie };
  for (const arr of [S.items, S.done]) if (arr) { const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i] = item; }
  if (S.items && !S.items.some((x) => x.id === id) && !isDone(item)) S.items.push(item);
}

async function update(id, changes, okMsg) {
  const r = await todoApi.update(id, changes);
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
  S.open = { id, task: fromList ? { ...fromList, partial: true } : null, values: null, saving: new Set(), error: null };
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

const FIELD_ORDER = ["Nom", "État", "Échéance", "Prio", "Type d'action", "Bloc"];
const LABEL = { Nom: "Intitulé", Prio: "Priorité" };

let contactsCache = [];
async function contactsList() { try { contactsCache = await contactIndex(); } catch { /* */ } return contactsCache; }
contactsList.sync = () => contactsCache;

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost || !ownsDrawer("todo")) return;
  $("#dr-kind").textContent = o.isNew ? "Nouvelle tâche" : "Tâche";
  if (o.isNew) { drawerHost.innerHTML = newForm(o); return; }
  const t = o.task;
  if (!t) { drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement de la tâche…</p>`; return; }
  const d = isDone(t);
  const states = S.schema?.editable?.["État"]?.options || [];
  const cNames = { ...(t.contactsNoms || {}) };
  for (const c of contactsList.sync()) if (t.contacts.some((x) => nid(x) === nid(c.id))) cNames[c.id] = c.nom;
  const nameOfContact = (id) => cNames[id] ?? Object.entries(cNames).find(([k]) => nid(k) === nid(id))?.[1] ?? "Contact";
  const nameOfProj = (id) => t.projetsNoms?.[id] ?? projById(id)?.nom ?? "Projet";

  drawerHost.innerHTML = `
    <div class="dh"><span class="ifmt">${ic("todo")}</span><div style="flex:1;min-width:0"><h1 class="${d ? "strike" : ""}">${esc(t.nom)}</h1>
      <div class="chips" style="margin-top:8px">${etatChip(t.etat, true)}${t.prio ? chip(t.prio, t.prio === "P1" ? "red" : "") : ""}${t.typeAction ? `<span class="chip">${esc(t.typeAction)}</span>` : ""}${t.creeParAgent ? `<span class="chip dash">Créée par l'agent</span>` : ""}</div></div></div>
    <div class="dact">
      ${t.etat === "Annulé" ? `<button class="btn sm pri" data-tstate="A faire">${ic("refresh", "ic-sm")}Rétablir</button>`
        : d ? `<button class="btn sm" data-tstate="A faire">${ic("refresh", "ic-sm")}Rouvrir</button>`
        : `<button class="btn sm pri" data-tstate="Terminé">${ic("check", "ic-sm")}Marquer fait</button><button class="btn sm" data-tstate="Annulé">${ic("close", "ic-sm")}Annuler la tâche</button>`}
      ${t.url ? `<a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Ouvrir dans Notion</a>` : ""}
      ${t.brouillon ? `<a class="btn sm" href="${esc(t.brouillon)}" target="_blank" rel="noopener">${ic("mail", "ic-sm")}Brouillon Gmail</a>` : ""}
      ${t.lienSource ? `<a class="btn sm" href="${esc(t.lienSource)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Source</a>` : ""}
    </div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    <section class="sec"><h2>État</h2>
      <div class="statusbar" role="group" aria-label="Changer l'état">${states.map((s) => `<button class="${s === t.etat ? "on" : ""}" data-tstate="${esc(s)}" ${s === t.etat || o.saving.has("État") ? "disabled" : ""} aria-pressed="${s === t.etat}">${esc(etatLabel(s))}</button>`).join("")}</div>
    </section>
    <div class="sfacts">
      <div><span>Échéance</span><b>${t.echeance ? esc(fd(t.echeance)) : "Aucune"}</b>${t.echeance && !d ? `<small>${due(t.echeance)}</small>` : ""}</div>
      <div><span>Projet</span><b>${t.projets.length ? t.projets.map((p) => `<a href="#/projets/${p}">${esc(nameOfProj(p))}</a>`).join(", ") : "Aucun"}</b>${t.pistes ? `<small>${t.pistes} piste(s) liée(s)</small>` : ""}</div>
    </div>
    <section class="sec"><h2>Liens</h2>${o.values ? links(o, nameOfProj, nameOfContact) : `<p class="empty">Chargement…</p>`}</section>
    <section class="sec"><h2>Modifier</h2>${o.values ? form(o) : `<p class="empty">Chargement des champs…</p>`}</section>
    ${t.recap ? `<section class="sec"><h2>Récap</h2><p class="notes">${esc(t.recap)}</p></section>` : ""}
    ${t.mesNotes ? `<section class="sec"><h2>Mes notes</h2><p class="notes">${esc(t.mesNotes)}</p></section>` : ""}
    ${t.ordreAgent && t.ordreAgent !== "Fait" ? `<div class="banner ${t.ordreAgent === "Bloqué" ? "" : "info"}">${ic("alert", "ic-sm")}<span>Ordre de mission ${esc(t.ordreAgent.toLowerCase())}${t.ordreMission ? " · " + esc(t.ordreMission.slice(0, 200)) : ""}</span></div>` : ""}
    ${t.syntheseAgent ? `<section class="sec"><h2>Synthèse agent</h2><p class="notes">${esc(t.syntheseAgent)}</p></section>` : ""}
    ${t.modifie ? `<p class="small muted">Modifiée dans Notion le ${esc(new Date(t.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}. Récap et notes se modifient dans Notion.</p>` : ""}`;
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
  else input = `<input type="text" ${attrs} value="${esc(v)}" autocomplete="off" ${def.type === "title" ? "required" : ""}>`;
  return `<div class="fld ${def.type === "title" ? "wide" : ""}">${lab}${input}</div>`;
}

async function saveField(el) {
  const o = S.open, prop = el.dataset.tprop;
  if (!o || !o.values || !prop) return;
  const type = S.schema.editable[prop]?.type;
  const val = el.value.trim();
  if (String(o.values[prop] ?? "").slice(0, type === "date" ? 10 : undefined) === val) return;
  if (type === "title" && !val) { el.value = o.values[prop]; toast("L'intitulé ne peut pas être vide.", "err"); return; }
  await saving(prop, () => update(o.id, { [prop]: val || null }, `${LABEL[prop] || prop} enregistré dans Notion.`));
}

async function saving(prop, fn) {
  const o = S.open;
  o.saving.add(prop); renderDrawer();
  try { await fn(); } catch (e) { toast(e.message, "err"); }
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
    if (chk) { e.preventDefault(); toggleDone(chk.dataset.tdone, chk); }
  });
  root.addEventListener("input", (e) => { if (e.target.id === "tf-q") { S.f.q = e.target.value; render(); } });
  root.addEventListener("change", (e) => { if (e.target.id === "tf-p") { S.f.proj = e.target.value; render(); } });
}

export function bindTodoDrawerEvents(root) {
  root.addEventListener("click", (e) => {
    if (!ownsDrawer("todo") || !S.open || S.open.isNew) return;
    const st = e.target.closest("[data-tstate]");
    if (st) { const s = st.dataset.tstate; saving("État", () => update(S.open.id, { "État": s }, `État : ${etatLabel(s)}.`)); return; }
    const rm = e.target.closest("[data-trm]");
    if (rm) { const prop = rm.dataset.trel; saving(prop, () => update(S.open.id, { [prop]: { remove: [rm.dataset.trm] } }, "Lien retiré dans Notion.")); }
  });
  root.addEventListener("change", (e) => {
    if (!ownsDrawer("todo") || !S.open) return;
    const el = e.target;
    if (el.dataset?.tprop) { saveField(el); return; }
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

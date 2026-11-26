// Vue « Contacts » : liste des contacts actifs et fiche modifiable.
// Chaque vue du cockpit expose la même interface : { id, label, icon, render(), open(id) }.
import { contactsApi, todoApi, projetsIndex, pistesApi } from "./api.js";
import { $, esc, ic, av, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip, isDone, ficheTop, renderSide, sideHTML, ficheTabs, parcChip, taSpan, syncOf, syncSpan, staleBanner, natureChip, setNoteSaver , swapHTML } from "./ui.js";
import { og, ogLegend } from "./origines.js";
import { refreshPistes, pisteSection } from "./pistes.js";
import { modeDemande, modesSeg } from "./modes.js";

const S = {
  items: null, schema: null, loading: false, error: null, fetchedAt: null, synchro: null,
  f: { q: "", type: "tous", parcours: "", mode: "liste", sort: "liens" },
  open: null, // fiche ouverte : { id, contact, values, saving: Set, sec, pistes }
  acreer: null, // lot 2 (suite) : contacts « À créer » et pistes actives sans contact, lus à la demande
};

const FIELD_ORDER = [
  "Parcours réseau", "Prio", "Qualif Prospect", "Prochaine action", "Date prochaine action",
  "Dernier échange", "Position", "Type", "Email", "Phone", "Linkedin", "Site web",
];
const LABEL = { Phone: "Téléphone", Linkedin: "LinkedIn", Email: "Mail", "Parcours réseau": "Statut (parcours réseau)" };
const colorOf = (prop, val) => S.schema?.editable?.[prop]?.colors?.[val];

let host = null;      // conteneur de la vue
let drawerHost = null;

export const contactsView = {
  id: "contacts",
  label: "Contacts",
  icon: "users",
  async mount(container, drawer) {
    host = container; drawerHost = drawer;
    // Arrivée depuis la barre d'affichage de Réseau (Liste, Cartes, À créer).
    if (modeDemande.contacts) { S.f.mode = modeDemande.contacts; modeDemande.contacts = null; if (S.f.mode === "acreer") S.acreer = null; }
    render();
    if (!S.items) await load();
  },
  open: openContact,
  openNew: (kind, id) => openNewContact(kind === "piste" ? id : null),
  close: () => { S.open = null; },
  // Actualiser relit aussi « À créer » et les pistes sans contact (défaut du 26/11 : la liste restait figée).
  reload: () => { S.acreer = null; return load(true); },
};

/** À relire au prochain affichage du mode « À créer » (après un rattachement ou une création). */
export const invalidateACreer = () => { S.acreer = null; if (S.f.mode === "acreer") render(); };
/** Relit la liste des contacts (après un geste fait ailleurs : piste créée, parcours changé). */
export const refreshContacts = () => { if (S.items && !S.loading) load(true); };

async function load(force = false) {
  if (S.loading) return;
  S.loading = true; S.error = null; render();
  try {
    const [list, schema] = await Promise.all([contactsApi.list(), S.schema && !force ? S.schema : contactsApi.schema()]);
    S.items = list.contacts; S.fetchedAt = list.fetchedAt; S.synchro = syncOf(list); S.schema = schema;
  } catch (e) {
    S.error = e.message;
  } finally {
    S.loading = false; render();
  }
}

const orgName = (id) => S.items?.find((c) => c.id === id)?.nom;
const NOTES_CONTACT = "👦👩‍🦰Notes contacts", NOTES_ENTREPRISE = "Notes entreprise";
/** Dernier échange d'une ligne : direct au Journal de bord (lot 1 bis), sinon la propriété « Dernier échange ». */
const lastEx = (c) => c.dernierEchangeDirect?.date || c.dernierEchange || "";
const subOf = (c) => [c.position, ...(c.rattacheA || []).map(orgName).filter(Boolean)].filter(Boolean).join(" · ")
  || (c.typeOrg || []).join(", ");

function filtered() {
  const f = S.f, q = nrm(f.q.trim());
  let list = S.items || [];
  if (f.type !== "tous") list = list.filter((c) => c.type === f.type);
  if (f.parcours) list = list.filter((c) => (f.parcours === "__none" ? !c.parcours : c.parcours === f.parcours));
  if (q) list = list.filter((c) => nrm([c.nom, c.position, c.prochaineAction, subOf(c), ...(c.typeOrg || [])].join(" ")).includes(q));
  if (f.sort === "nom") list = list.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  else if (f.sort === "recent") list = list.slice().sort((a, b) => lastEx(b).localeCompare(lastEx(a)) || a.nom.localeCompare(b.nom, "fr"));
  // Tri par liens (POC) : a recommandé × 3, recommandé par × 2, pistes, membres, échanges ; score calculé par la fonction.
  else if (f.sort === "liens") list = list.slice().sort((a, b) => (b.scoreLiens ?? 0) - (a.scoreLiens ?? 0) || a.nom.localeCompare(b.nom, "fr"));
  return list;
}

function render() {
  if (!host) return;
  const f = S.f;
  const seg = (v, lab) => `<button class="${f.type === v ? "on" : ""}" data-type="${v}">${lab}</button>`;
  const opts = S.schema?.editable?.["Parcours réseau"]?.options || [];
  const head = `
    <div class="bar">
      <a class="btn sm pri" href="#/contacts/new">${ic("plus", "ic-sm")}Contact</a>
      ${modesSeg("contacts", f.mode, (m) => `data-cmode="${m}"`)}
      <div class="seg" role="group" aria-label="Type de fiche">${seg("tous", "Tous")}${seg("Personne", "Personnes")}${seg("Organisation", "Organisations")}${seg("Réseau", "Réseaux")}</div>
      <label class="sr" for="cf-p">Statut</label>
      <select class="sel" id="cf-p"><option value="">Tous statuts</option>${opts.map((o) => `<option ${f.parcours === o ? "selected" : ""}>${esc(o)}</option>`).join("")}<option value="__none" ${f.parcours === "__none" ? "selected" : ""}>Sans statut</option></select>
      <label class="sr" for="cf-q">Filtrer</label>
      <input class="inp grow" id="cf-q" type="search" placeholder="Nom, poste, organisation…" value="${esc(f.q)}" autocomplete="off">
    </div>`;

  let body;
  if (S.error) body = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`;
  else if (f.mode === "acreer") body = aCreerHTML();
  else if (!S.items) body = `<div class="card"><p class="empty">Chargement des contacts depuis Notion…</p></div>`;
  else {
    const list = filtered();
    const srt = (v, lab) => `<button class="lnk ${f.sort === v ? "on" : ""}" data-csort="${v}">${lab}</button>`;
    body = `${staleBanner(S.synchro)}<p class="small muted" style="margin:-4px 0 10px">${list.length} fiche${list.length > 1 ? "s" : ""} sur ${S.items.length} contacts actifs${S.synchro ? `, ${syncSpan(S.synchro)}` : ""}${S.loading ? ", mise à jour…" : ""}. Trier par ${srt("liens", "liens")}, ${srt("recent", "dernier échange")}, ${srt("nom", "nom")}, ${srt("", "ordre Notion")}.</p>
      ${!list.length ? `<p class="empty">Aucun contact pour ces filtres.</p>` : f.mode === "cartes" ? `<div class="cgrid">${list.slice(0, 400).map(card).join("")}</div>` : `<div class="card"><div class="list">${list.slice(0, 400).map(row).join("")}</div></div>`}
      ${list.length > 400 ? `<p class="small muted" style="margin-top:8px">Seules les 400 premières fiches sont affichées, affine le filtre.</p>` : ""}`;
  }
  // Conserve le focus et la position du curseur dans le champ de recherche pendant la frappe.
  const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  host.innerHTML = head + body;
  if (active === "cf-q") { const i = $("#cf-q", host); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
}

// Ligne (POC, contactRow) : parcours, pistes en cours (lot 2, suite), actions ouvertes, mail, dernier échange direct.
const pisChip = (c) => c.pistesEnCours ? `<span class="chip st-encours">${c.pistesEnCours} piste${c.pistesEnCours > 1 ? "s" : ""}</span>` : "";
const actChip = (c) => c.tachesOuvertes ? `<span class="chip">${c.tachesOuvertes} action${c.tachesOuvertes > 1 ? "s" : ""}</span>` : "";
const mailChip = (c) => c.email ? `<span class="chip pl" title="Mail">${ic("mail", "ic-sm")}${esc(c.email)}</span>` : "";
function exSpan(c) {
  if (c.dernierEchangeDirect) return `<span class="due" title="Dernier échange direct au Journal de bord : ${esc(c.dernierEchangeDirect.titre)}">${esc(fd(c.dernierEchangeDirect.date))}</span>`;
  if (c.dernierEchange) return `<span class="small muted" title="Propriété « Dernier échange » de la fiche (aucun échange relié au Journal de bord)">Échange ${esc(fd(c.dernierEchange))}</span>`;
  return `<span class="small muted">Aucun échange</span>`;
}
function row(c) {
  return `<a class="row" href="#/contacts/${c.id}">${av(c)}
    <div class="rm"><div class="rt">${esc(c.nom)}</div><div class="rs">${esc(subOf(c)) || "&nbsp;"}</div>
      ${((x) => x ? `<div class="chips" style="margin-top:4px">${x}</div>` : "")(`${parcChip(c.parcours)}${natureChip(c.nature)}${pisChip(c)}${actChip(c)}${c.prio === "P1" ? chip("P1", "red") : c.prio ? chip(c.prio) : ""}${mailChip(c)}`)}
      ${c.prochaineAction ? `<div class="rs clamp2">${ic("arrow", "ic-sm")} ${esc(c.prochaineAction)} ${due(c.dateProchaineAction)}</div>` : ""}</div>
    <div class="rr">${exSpan(c)}</div></a>`;
}

function card(c) {
  return `<a class="ccard" href="#/contacts/${c.id}">${av(c)}<div class="cm"><div class="cn">${esc(c.nom)}</div><div class="cs">${esc(subOf(c)) || "&nbsp;"}</div>
    <div class="chips">${parcChip(c.parcours)}${natureChip(c.nature)}${pisChip(c)}${actChip(c)}${c.prio === "P1" ? chip("P1", "red") : c.prio ? chip(c.prio) : ""}${c.qualif ? chip(c.qualif, colorOf("Qualif Prospect", c.qualif)) : ""}</div>
    ${c.prochaineAction || c.dateProchaineAction ? `<div class="cs clamp2" style="margin-top:6px">${ic("arrow", "ic-sm")} ${esc(c.prochaineAction || "Prochaine action")} ${due(c.dateProchaineAction)}</div>` : ""}</div></a>`;
}

// ---------------- Fiche ----------------

async function openContact(id) {
  const fromList = S.items?.find((c) => c.id === id);
  const sec = S.open?.id === id ? S.open.sec : "synthese";
  S.open = { id, contact: fromList ? { ...fromList, partial: true } : null, values: null, saving: new Set(), error: null, tasks: null, pistes: null, sec };
  setDrawerOwner("contacts");
  renderDrawer();
  // Pistes liées (lot 2, suite), en parallèle.
  pistesApi.ofContact(id).then((r) => { if (S.open?.id === id) { S.open.pistes = r.pistes || []; renderDrawer(); } })
    .catch(() => { if (S.open?.id === id) { S.open.pistes = "error"; renderDrawer(); } });
  // Tâches liées, chargées en parallèle de la fiche.
  todoApi.list({ contact: id }).then(async (r) => {
    let projets = [];
    try { projets = await projetsIndex(); } catch { /* noms indisponibles */ }
    if (S.open?.id === id) { S.open.tasks = r.tasks; S.open.projets = projets; renderDrawer(); }
  })
    .catch(() => { if (S.open?.id === id) { S.open.tasks = "error"; renderDrawer(); } });
  try {
    if (!S.schema) S.schema = await contactsApi.schema();
    const r = await contactsApi.get(id);
    if (S.open?.id !== id) return;
    S.open.contact = r.contact; S.open.values = r.values;
  } catch (e) {
    if (S.open?.id !== id) return;
    S.open.error = e.message;
  }
  renderDrawer();
}

const SECS = { synthese: "Synthèse", pistes: "Pistes", taches: "Tâches", fiche: "Fiche" };

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost || !ownsDrawer("contacts")) return;
  if (o.isNew) { renderNew(o); return; }
  const c = o.contact;
  ficheTop({ kind: c?.type === "Organisation" ? "Organisation" : c?.type === "Réseau" ? "Réseau" : "Contact", url: c?.url || null, side: true });
  renderSide("contacts", sideHTML({
    notes: notesOf(c, o),
    notesMissing: !c || c.partial ? "Chargement des notes…" : "",
    ordre: c && !c.partial ? { etat: c.ordreAgent, mission: c.ordreMission } : null,
  }));
  if (!c) {
    drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement de la fiche…</p>`;
    return;
  }
  const tel = c.phone ? c.phone.replace(/\s/g, "") : "";
  const acts = [
    `<a class="btn sm pri" href="#/todo/new/${o.id}">${ic("plus", "ic-sm")}Tâche</a>`,
    tel ? `<a class="btn sm" href="tel:${esc(tel)}">${ic("call", "ic-sm")}Appeler</a>` : "",
    c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}">${ic("mail", "ic-sm")}Écrire</a>` : "",
    c.linkedin ? `<a class="btn sm" href="${esc(c.linkedin)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}LinkedIn</a>` : "",
  ].join("");
  const sub = [subOf(c), c.type !== "Personne" ? c.segmentation : null].filter(Boolean).join(" · ");
  const openN = Array.isArray(o.tasks) ? o.tasks.filter((x) => !isDone(x)).length : null;
  const cur = SECS[o.sec] ? o.sec : "synthese";
  const pisN = Array.isArray(o.pistes) ? o.pistes.length : null;
  const body = { synthese: () => synthese(o), pistes: () => pistesSection(o), taches: () => tasksSection(o), fiche: () => o.values ? form(o) : `<p class="empty">Chargement des champs…</p>` }[cur]();
  swapHTML(drawerHost, `
    <div class="dh"><div class="dact">${acts}</div>${av(c, "lg")}<div style="flex:1;min-width:0"><h1>${esc(c.nom)}</h1><div class="sub">${esc(sub)}</div>
      <div class="chips" style="margin-top:8px">${c.type ? `<span class="chip">${esc(c.type)}</span>` : ""}${natureChip(c.nature)}${chip(c.qualif, colorOf("Qualif Prospect", c.qualif))}${c.prio ? chip(c.prio, colorOf("Prio", c.prio)) : ""}</div></div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${ficheTabs([["synthese", SECS.synthese], ["pistes", SECS.pistes, pisN], ["taches", SECS.taches, openN], ["fiche", SECS.fiche]], cur, "data-csec")}
    <section class="cbody" aria-label="${SECS[cur]}">${body}</section>`);
}

function synthese(o) {
  const c = o.contact, rel = c.relations || {};
  const n = (r) => r ? `${r.n}${r.more ? "+" : ""}` : "0";
  const orgs = (c.rattacheA || []).map((id) => ({ id, nom: orgName(id) })).filter((x) => x.nom);
  const open = Array.isArray(o.tasks) ? o.tasks.filter((x) => !isDone(x)) : null;
  // Lot 1 bis (POC) : dernier échange direct lu au Journal, prochaine étape (première tâche ouverte, sinon la
  // prochaine action de la fiche), recommandeurs ou rattachements nommés. Lot 2 (suite) : prochaine étape de la
  // piste active la plus proche, calculée par la fonction (prochaineEtapePiste).
  const next = open && open.length ? open.slice().sort((a, b) => (a.echeance || "9").localeCompare(b.echeance || "9"))[0] : null;
  const ld = c.dernierEchangeDirect;
  const names = (list) => list.map((x) => x.nom ? `<a href="#/contacts/${x.id}">${esc(x.nom)}</a>` : `<span class="muted">fiche non lue</span>`).join(", ");
  const people = c.type === "Personne"
    ? `<div><span>Recommandé par${og("contacts", "Recommandé par")}</span><b>${c.partial || !c.recommandeParNoms ? "…" : c.recommandeParNoms.length ? names(c.recommandeParNoms) : "Contact direct"}</b></div>`
    : `<div><span>Rattachements${og("contacts", "Rattaché à")}</span><b>${c.partial ? "…" : (c.rattacheANoms || []).length ? names(c.rattacheANoms) : orgs.length ? orgs.map((x) => esc(x.nom)).join(", ") : "Aucun"}</b></div>`;
  return `${ogLegend()}<div class="sfacts">
      ${c.type === "Personne" || !c.type ? `<div><span>Statut${og("contacts", "Parcours réseau")}</span><b>${c.parcours ? esc(c.parcours) : "Non renseigné"}</b></div>` : ""}
      ${c.nature == null && !c.partial ? `<div><span>Dernier échange${og("contacts", "Dernier échange")}</span><b>${c.dernierEchange ? esc(fd(c.dernierEchange)) : "Aucun"}</b><small>Propriété de la fiche (journal non lu)</small></div>` : `<div><span>Dernier échange direct${og("contacts", "dernierEchangeDirect")}</span><b>${ld ? esc(fd(ld.date)) : c.partial ? "…" : "Aucun au Journal de bord"}</b>${ld ? `<small><a href="https://www.notion.so/${esc(String(ld.id).replace(/-/g, ""))}" target="_blank" rel="noopener">${esc(ld.titre)}</a></small>` : c.dernierEchange ? `<small>Propriété Dernier échange : ${esc(fd(c.dernierEchange))}</small>` : ""}</div>`}
      <div><span>Prochaine étape${og("contacts", next ? "prochaineEtape" : "Prochaine action")}</span>${next ? `<b><a href="#/todo/${next.id}">${esc(next.nom)}</a></b>${next.echeance ? `<small>${due(next.echeance)}</small>` : ""}`
        : c.prochaineAction ? `<b>${esc(c.prochaineAction)}</b><small>Prochaine action de la fiche ${due(c.dateProchaineAction)}</small>` : `<b>${open === null ? "…" : "Rien de prévu"}</b>`}</div>
      ${c.prochaineEtapePiste ? `<div><span>Prochaine étape d'une piste${og("contacts", "prochaineEtapePiste")}</span><b><a href="#/pistes/${esc(c.prochaineEtapePiste.piste)}">${esc(c.prochaineEtapePiste.action || c.prochaineEtapePiste.nom)}</a></b><small>${c.prochaineEtapePiste.action ? esc(c.prochaineEtapePiste.nom) + " " : ""}${c.prochaineEtapePiste.date ? due(c.prochaineEtapePiste.date) : "sans date"}</small></div>` : ""}
      ${people}
      <div><span>Liens dans Notion${og("contacts", "liens")}</span><b class="small">${n(rel.opportunites)} opportunité(s) · ${n(rel.todo)} tâche(s) · ${n(rel.journal)} échange(s)</b>${c.partial ? "" : `<small>Recommandé par ${n(rel.recommandePar)} · a recommandé ${n(rel.aRecommande)}</small>`}</div>
    </div>
    ${orgs.length ? `<h3 class="sh">Rattaché à${og("contacts", "Rattaché à")}</h3><div class="chips">${orgs.map((x) => `<a class="chip" href="#/contacts/${x.id}">${esc(x.nom)}</a>`).join("")}</div>` : ""}
    <h3 class="sh">À faire ${open ? `<button class="lnk" data-csec="taches">${open.length}</button>` : ""}</h3>
    ${open === null ? `<p class="empty">Chargement des tâches…</p>` : !Array.isArray(o.tasks) ? `<p class="empty">Tâches indisponibles pour l'instant.</p>` : open.length ? `<div class="list">${open.slice(0, 3).map(taskRow).join("")}</div>${open.length > 3 ? `<p class="small muted"><button class="lnk" data-csec="taches">Voir les ${open.length} tâches ouvertes</button></p>` : ""}` : `<p class="empty">Aucune tâche ouverte.</p>`}
    ${c.syntheseAgent ? `<h3 class="sh">Synthèse agent${og("contacts", "Synthèse agent")}</h3><p class="notes">${esc(c.syntheseAgent)}</p>` : ""}
    ${c.modifie ? `<p class="small muted" style="margin-top:14px">Modifié dans Notion le ${esc(new Date(c.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}${og("contacts", "Modifié le")}. Les notes se modifient dans le panneau Mes notes.</p>` : ""}
    ${c.nature ? `<p class="small muted">Nature${og("contacts", "nature")} calculée par le cockpit : client ou partenaire si le contact est relié par une tâche à une mission en cours ou terminée, ou lié à une piste gagnée ou partenaire, réseau s'il a recommandé quelqu'un ou s'il est hors parcours, prospect sinon.</p>` : ""}`;
}

const taskRow = (x) => `<a class="row" href="#/todo/${x.id}"><div class="rm"><div class="rt ${isDone(x) ? "strike" : ""}">${esc(x.nom)}</div>
    <div class="ameta">${x.prio === "P1" && !isDone(x) ? chip("P1", "red") : ""}${etatChip(x.etat, isDone(x))}${taSpan(x.typeAction)}</div></div><div class="rr">${isDone(x) ? "" : due(x.echeance)}</div></a>`;

function tasksSection(o) {
  const t = o.tasks;
  const head = `<div class="card-h"><span class="small muted" style="flex:1">Tâches liées dans la base TO DO</span><a class="btn sm" href="#/todo/new/${o.id}">${ic("plus", "ic-sm")}Tâche</a></div>`;
  if (t === null) return `${head}<p class="empty">Chargement des tâches…</p>`;
  if (t === "error") return `${head}<p class="empty">Tâches indisponibles pour l'instant.</p>`;
  const open = t.filter((x) => !isDone(x)), done = t.filter(isDone);
  const row = taskRow;
  // Projets du contact : ceux de ses tâches (ouvertes et terminées).
  const nid = (x) => String(x).replace(/-/g, "");
  const pids = [...new Set(t.flatMap((x) => x.projets.map(nid)))];
  const pj = pids.map((p) => (o.projets || []).find((x) => nid(x.id) === p)).filter(Boolean);
  return `${head}
    ${pj.length ? `<div class="chips" style="margin-bottom:8px">${pj.map((p) => `<a class="chip pj" href="#/projets/${p.id}">${ic("folder", "ic-sm")}${esc(p.nom)}</a>`).join("")}</div>` : ""}
    ${open.length ? `<div class="list">${open.map(row).join("")}</div>` : `<p class="empty">Aucune tâche ouverte.</p>`}
    ${done.length ? `<details class="more"><summary>${done.length} terminée${done.length > 1 ? "s" : ""} ou annulée${done.length > 1 ? "s" : ""}</summary><div class="list">${done.map(row).join("")}</div></details>` : ""}`;
}

// ---------------- Pistes du contact (lot 2, suite) ----------------

function pistesSection(o) {
  const p = o.pistes;
  const head = `<div class="card-h"><span class="small muted" style="flex:1">Pistes liées dans la base Pistes/Opportunités</span></div>`;
  if (p === null) return `${head}<p class="empty">Chargement des pistes…</p>`;
  if (p === "error") return `${head}<p class="empty">Pistes indisponibles pour l'instant.</p>`;
  if (!p.length) return `${head}<p class="empty">Aucune piste liée à ce contact dans Notion.</p>`;
  return `${head}<p class="small muted" style="margin:0 0 6px">Prochaine action de chaque piste${og("contacts", "pistes")} : sa tâche ouverte liée à l'échéance la plus proche.</p><div class="list">${p.map(pisteRow).join("")}</div>`;
}

// Prochaine action de la piste : sa tâche ouverte liée à l'échéance la plus proche (26/11/2026).
const pisteRow = (x) => `<a class="row" href="#/pistes/${x.id}"><div class="rm"><div class="rt">${esc(x.nom)}</div>
    <div class="ameta">${x.etape ? `<span class="chip">${esc(x.etape)}</span>` : ""}${x.issue ? `<span class="chip">${esc(x.issue)}</span>` : ""}</div>
    ${x.prochaine ? `<div class="rs clamp2">${ic("arrow", "ic-sm")} ${esc(x.prochaine.nom)}</div>` : x.prochaineCalculee ? `<div class="rs nx-none">Aucune action planifiée</div>` : ""}</div><div class="rr">${x.prochaine?.echeance ? due(x.prochaine.echeance) : ""}</div></a>`;

// ---------------- Contacts « À créer » (C7, lot 2 suite) ----------------

async function loadACreer() {
  S.acreer = "loading"; render();
  try { S.acreer = await contactsApi.aCreer(); S.acreerAt = Date.now(); } catch (e) { S.acreer = { error: e.message }; }
  if (!S.items && !S.loading) load(); // noms pour « Rattacher un existant »
  render();
}

/** Piste active sans contact, avec les deux gestes : rattacher un existant, créer et rattacher. */
function sansContactRow(x) {
  const busy = S.scBusy === x.id;
  return `<div class="row" style="flex-wrap:wrap"><a class="rm" href="#/pistes/${x.id}"><div class="rt">${esc(x.nom)}</div><div class="ameta">${x.etape ? `<span class="chip">${esc(x.etape)}</span>` : ""}${x.issue ? `<span class="chip">${esc(x.issue)}</span>` : ""}</div></a>
    <div class="sc-acts" style="flex-basis:100%"><label class="sr" for="sc-${x.id}">Rattacher un contact existant à ${esc(x.nom)}</label>
      <input class="inp" id="sc-${x.id}" list="sc-cl" placeholder="Rattacher un existant (nom)" autocomplete="off" data-scpiste="${x.id}" ${busy ? "disabled" : ""}>
      <button class="btn sm" type="button" data-scgo="${x.id}" ${busy ? "disabled" : ""}>${busy ? "Rattachement…" : "Rattacher"}</button>
      <a class="btn sm pri" href="#/contacts/new/piste/${x.id}">${ic("plus", "ic-sm")}Créer et rattacher</a></div></div>`;
}

/** Rattache un contact existant à une piste (écrit dans Notion par la fonction pistes), puis relit la liste. */
async function rattacherExistant(pisteId) {
  const el = host?.querySelector(`[data-scpiste="${CSS.escape(pisteId)}"]`);
  const v = el?.value.trim() || "";
  const c = (S.items || []).find((x) => nrm(String(x.nom).trim()) === nrm(v));
  if (!c) { toast(v ? `Contact « ${v} » introuvable parmi les contacts actifs.` : "Choisis un contact dans la liste.", "err"); el?.focus(); return; }
  S.scBusy = pisteId; render();
  try {
    await pistesApi.update(pisteId, { "👱‍♀️ Contacts": { add: [c.id] } });
    toast(`${c.nom} rattaché à la piste dans Notion.`);
    refreshPistes();
    S.scBusy = null;
    await loadACreer();
  } catch (e) { toast(e.message, "err"); S.scBusy = null; render(); }
}

const SRC = { pistes: ["pistes", "Piste"], todo: ["todo", "Tâche"], journal: [null, "Journal"] };
function aCreerHTML() {
  const a = S.acreer;
  if (!a) { setTimeout(loadACreer, 0); return `<div class="card"><p class="empty">Chargement…</p></div>`; }
  if (a === "loading") return `<div class="card"><p class="empty">Chargement…</p></div>`;
  if (a.error) return `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(a.error)}</span></div>`;
  if (a.indisponible) return `<div class="card"><p class="empty">Le miroir des contacts et des pistes n'est pas encore rempli : rien n'est calculé.</p></div>`;
  const src = (s) => { const [v, l] = SRC[s.base] || [null, s.base]; return v ? `<a class="chip" href="#/${v}/${s.id}">${l} · ${esc(s.titre)}</a>` : `<a class="chip" href="https://www.notion.so/${esc(s.id.replace(/-/g, ""))}" target="_blank" rel="noopener">${l} · ${esc(s.titre)}</a>`; };
  return `<section class="card"><div class="card-h"><h2>À créer dans Notion</h2><span class="count">${a.aCreer.length}</span></div>
      <p class="small muted">${esc(a.regle)}</p>
      ${a.aCreer.length ? `<div class="list">${a.aCreer.map((x) => `<div class="row"><span class="av k-acreer" aria-hidden="true">?</span><div class="rm"><div class="rt">${esc(x.nom || "Fiche absente de Contacts")} <span class="chip st-attente">À créer</span></div><div class="rs">${esc(x.raison)}</div><div class="chips" style="margin-top:4px">${x.sources.map(src).join("")}</div></div></div>`).join("")}</div>`
        : `<p class="empty">Aucune personne à créer : toutes les relations Contacts des pistes, des tâches et du journal pointent vers une fiche existante, et aucune personne n'y est mentionnée (@) sans fiche.</p>`}
    </section>
    <section class="card" style="margin-top:14px"><div class="card-h"><h2>Pistes actives sans contact</h2><span class="count">${a.pistesSansContact.length}</span></div>
      <p class="small muted">Pour chaque piste, rattache un contact existant ou crée-le et rattache-le d'un geste. La liste est relue à chaque affichage et après chaque geste.${S.acreerAt ? ` Lue à ${esc(new Date(S.acreerAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))}${a.synchro ? `, ${syncSpan(a.synchro)}` : ""}.` : ""}</p>
      ${a.pistesSansContact.length ? `<div class="list">${a.pistesSansContact.map(sansContactRow).join("")}</div>
        <datalist id="sc-cl">${(S.items || []).map((c) => `<option value="${esc(String(c.nom).trim())}">`).join("")}</datalist>` : `<p class="empty">Toutes les pistes actives ont au moins un contact.</p>`}
    </section>`;
}

/** Notes du panneau : Notes contacts (personne) ou Notes entreprise (organisation, réseau), modifiables si sans mise en forme. */
function notesOf(c, o) {
  if (!c) return [];
  const m = c.notesModifiables || {};
  const mine = c.type === "Personne" ? NOTES_CONTACT : NOTES_ENTREPRISE;
  const other = mine === NOTES_CONTACT ? NOTES_ENTREPRISE : NOTES_CONTACT;
  const text = { [NOTES_CONTACT]: c.notesContact, [NOTES_ENTREPRISE]: c.notesEntreprise };
  const lab = { [NOTES_CONTACT]: "Notes contacts", [NOTES_ENTREPRISE]: "Notes entreprise" };
  const editable = (p) => !c.partial && o.values && m[p] === true && S.schema?.editable?.[p];
  const one = (p) => ({ label: lab[p], text: text[p], prop: p, editable: editable(p), locked: !c.partial && m[p] === false, saved: o.savedNote === p, og: og("contacts", p) });
  const out = [one(mine)];
  if (text[other]) out.push(one(other));
  return out;
}

setNoteSaver("contacts", async (prop, value, before) => {
  const o = S.open;
  if (!o) return;
  try {
    const r = await contactsApi.update(o.id, { [prop]: value || null }, { [prop]: before });
    if (S.open !== o) return;
    o.contact = r.contact; o.values = r.values; o.savedNote = prop;
    syncItem(r.contact);
    toast("Notes enregistrées dans Notion.");
  } catch (e) {
    if (e.code === "conflit" || e.code === "mise_en_forme") { toast(e.message, "err"); openContact(o.id); return; }
    throw e;
  }
  renderDrawer();
});

/** Répercute une fiche relue dans la liste, sans tout recharger. */
function syncItem(contact) {
  if (!S.items) return;
  const i = S.items.findIndex((c) => c.id === contact.id);
  if (i >= 0) S.items[i] = { ...S.items[i], ...contact, partial: undefined };
}

/** Contacts actifs (chargés une fois), pour les listes de choix de la fiche TO DO. */
export async function contactIndex() {
  if (!S.items && !S.loading) await load();
  else if (S.loading) await new Promise((r) => { const t = setInterval(() => { if (!S.loading) { clearInterval(t); r(); } }, 100); });
  return S.items || [];
}

function form(o) {
  const ed = S.schema?.editable || {};
  return `<form class="form" data-contact="${o.id}" onsubmit="return false">${FIELD_ORDER.filter((k) => ed[k]).map((k) => field(k, ed[k], o.values[k], o.saving.has(k))).join("")}</form>`;
}

function field(name, def, value, saving) {
  const id = "fx-" + nrm(name).replace(/[^a-z0-9]+/g, "-");
  const lab = `<label for="${id}">${esc(LABEL[name] || name)}${og("contacts", name)} <span class="fstate" data-state="${esc(name)}">${saving ? "Enregistrement…" : ""}</span></label>`;
  const attrs = `id="${id}" data-cprop="${esc(name)}" ${saving ? "disabled" : ""}`;
  const v = value ?? "";
  let input;
  if (def.options) {
    const opts = def.options.includes(v) || !v ? def.options : [v, ...def.options];
    input = `<select ${attrs}><option value="">Non renseigné</option>${opts.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  } else if (def.type === "date") input = `<input type="date" ${attrs} value="${esc(String(v).slice(0, 10))}">`;
  else if (def.type === "email") input = `<input type="email" ${attrs} value="${esc(v)}" autocomplete="off">`;
  else if (def.type === "phone_number") input = `<input type="tel" ${attrs} value="${esc(v)}" autocomplete="off">`;
  else if (def.type === "url") input = `<input type="url" ${attrs} value="${esc(v)}" placeholder="https://" autocomplete="off">`;
  else input = `<textarea ${attrs} rows="2">${esc(v)}</textarea>`;
  return `<div class="fld">${lab}${input}</div>`;
}

// Enregistrement d'un champ dès qu'il change (sélection) ou à la sortie du champ (texte).
export async function saveField(el) {
  const o = S.open, prop = el.dataset.cprop;
  if (!o || !o.values || !prop) return;
  const before = o.values[prop] ?? "";
  const val = el.value.trim();
  const cmp = (x) => String(x ?? "").slice(0, S.schema.editable[prop]?.type === "date" ? 10 : undefined);
  if (cmp(before) === val) return;
  o.saving.add(prop);
  const st = drawerHost.querySelector(`[data-state="${CSS.escape(prop)}"]`);
  if (st) st.textContent = "Enregistrement…";
  el.disabled = true;
  try {
    const r = await contactsApi.update(o.id, { [prop]: val || null });
    o.contact = r.contact; o.values = r.values;
    // Répercute dans la liste sans tout recharger.
    syncItem(r.contact);
    toast(`${LABEL[prop] || prop} enregistré dans Notion.`);
  } catch (e) {
    toast(e.message, "err");
  } finally {
    o.saving.delete(prop);
    renderDrawer(); render();
  }
}

// Délégation d'événements pour la liste.
export function bindContactEvents(root) {
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-type]");
    if (t) { S.f.type = t.dataset.type; render(); return; }
    const m = e.target.closest("[data-cmode]");
    if (m) { S.f.mode = m.dataset.cmode; if (S.f.mode === "acreer") S.acreer = null; render(); return; }
    const sc = e.target.closest("[data-scgo]");
    if (sc) { rattacherExistant(sc.dataset.scgo); return; }
    const so = e.target.closest("[data-csort]");
    if (so) { S.f.sort = so.dataset.csort; render(); return; }
    if (e.target.closest('[data-act="reload"]')) load(true);
  });
  root.addEventListener("input", (e) => { if (e.target.id === "cf-q") { S.f.q = e.target.value; render(); } });
  root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset?.scpiste) { e.preventDefault(); rattacherExistant(e.target.dataset.scpiste); } });
  root.addEventListener("change", (e) => { if (e.target.id === "cf-p") { S.f.parcours = e.target.value; render(); } });
}
export function bindDrawerEvents(root) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-csec]");
    if (b && ownsDrawer("contacts") && S.open) { S.open.sec = b.dataset.csec; renderDrawer(); root.scrollTop = 0; }
  });
  root.addEventListener("change", (e) => { if (e.target.dataset?.cprop) saveField(e.target); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.cprop && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); }
  });
}

// ---------------- Créer un contact (26/11/2026) ----------------
// Formulaire repris de la maquette (Nouveau contact) et des propriétés existantes de la base Contacts : nom,
// type, poste (Position), organisation (Rattaché à), mail, téléphone, LinkedIn, recommandé par, statut de
// prospection (Qualif Prospect), parcours réseau, notes. Aucune propriété ni option n'est créée dans Notion.
// Avant de créer, les contacts au nom proche (miroir) sont proposés. Avec une piste : « Créer et rattacher ».

async function openNewContact(pisteId) {
  S.open = { id: "new", isNew: true, piste: pisteId, pisteNom: null, f: {}, doublons: null, busy: false, err: null, force: false, saving: new Set() };
  setDrawerOwner("contacts");
  renderDrawer();
  try { if (!S.schema) S.schema = await contactsApi.schema(); } catch (e) { if (S.open?.isNew) S.open.err = e.message; }
  if (!S.items && !S.loading) load(); else if (S.loading) await contactIndex();
  if (pisteId) {
    try { const r = await pistesApi.get(pisteId); if (S.open?.isNew && S.open.piste === pisteId) S.open.pisteNom = r.piste?.nom || null; } catch { /* nom de la piste indisponible */ }
  }
  renderDrawer();
}

const NOUVEAU = [
  ["Nom", "Nom", "text"], ["Type", "Type", "select"], ["Position", "Poste", "datalist"], ["Rattaché à", "Organisation", "org"],
  ["Email", "Mail", "email"], ["Phone", "Téléphone", "tel"], ["Linkedin", "LinkedIn", "url"], ["Recommandé par", "Recommandé par", "pers"],
  ["Qualif Prospect", "Statut de prospection", "select"], ["Parcours réseau", "Parcours réseau", "select"], ["Notes", "Notes", "textarea"],
];

function renderNew(o) {
  ficheTop({ kind: "Nouveau contact", url: null, side: false });
  const ed = S.schema?.editable || {}, f = o.f;
  const orgs = (S.items || []).filter((c) => c.type === "Organisation" || c.type === "Réseau");
  const pers = (S.items || []).filter((c) => c.type === "Personne" || !c.type);
  const fld = ([k, label, kind]) => {
    const id = "nc-" + nrm(k).replace(/[^a-z0-9]+/g, "-"), v = f[k] ?? (k === "Type" ? "Personne" : "");
    const dis = o.busy ? "disabled" : "";
    const ogk = k === "Notes" ? ((f["Type"] || "Personne") === "Personne" ? NOTES_CONTACT : NOTES_ENTREPRISE) : k;
    const lab = `<label for="${id}">${esc(label)}${k === "Nom" ? " *" : ""}${og("contacts", ogk)}</label>`;
    if (kind === "select") {
      const opts = ed[k]?.options; if (!opts) return "";
      return `<div class="fld">${lab}<select id="${id}" data-nc="${esc(k)}" ${dis}>${k === "Type" ? "" : `<option value="">Non renseigné</option>`}${opts.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>`;
    }
    if (kind === "datalist") {
      const opts = ed[k]?.options || [];
      return `<div class="fld">${lab}<input id="${id}" data-nc="${esc(k)}" list="nc-pos" value="${esc(v)}" autocomplete="off" placeholder="Un poste déjà présent dans Notion" ${dis}><datalist id="nc-pos">${opts.map((x) => `<option value="${esc(x)}">`).join("")}</datalist><span class="small muted">Un poste déjà présent dans Notion, ou vide (le cockpit n'ajoute pas d'option).</span></div>`;
    }
    if (kind === "org" || kind === "pers") {
      const list = kind === "org" ? orgs : pers;
      return `<div class="fld">${lab}<input id="${id}" data-nc="${esc(k)}" list="${id}-l" value="${esc(v)}" autocomplete="off" placeholder="${kind === "org" ? "Organisation ou réseau existant" : "Qui t'a présenté cette personne"}" ${dis}><datalist id="${id}-l">${list.map((c) => `<option value="${esc(String(c.nom).trim())}">`).join("")}</datalist></div>`;
    }
    if (kind === "textarea") return `<div class="fld wide">${lab}<textarea id="${id}" data-nc="${esc(k)}" rows="3" maxlength="10000" ${dis}>${esc(v)}</textarea><span class="small muted">Rangées dans ${(f["Type"] || "Personne") === "Personne" ? "Notes contacts" : "Notes entreprise"}.</span></div>`;
    return `<div class="fld ${k === "Nom" ? "wide" : ""}">${lab}<input id="${id}" type="${kind}" data-nc="${esc(k)}" value="${esc(v)}" autocomplete="off" ${k === "Nom" ? "required" : ""} ${kind === "url" ? `placeholder="https://"` : ""} ${dis}></div>`;
  };
  const d = o.doublons;
  const dbl = d && d.length ? `<div class="dbl wide"><b>${d.length} contact${d.length > 1 ? "s" : ""} au nom proche dans Notion</b><p class="small" style="margin:4px 0 8px">Vérifie avant de créer une seconde fiche.</p>
      <div class="list">${d.map((x) => `<div class="row"><div class="rm"><div class="rt">${esc(x.nom)}</div><div class="rs">${esc([x.type, x.position, x.raison].filter(Boolean).join(" · "))}</div></div>
        <div class="rr"><a class="btn sm" href="#/contacts/${x.id}">Ouvrir</a>${o.piste ? `<button class="btn sm pri" type="button" data-ncpick="${x.id}" ${o.busy ? "disabled" : ""}>Rattacher celui-ci</button>` : ""}</div></div>`).join("")}</div>
      ${o.force ? `<p class="small" style="margin-top:8px">Aucun ne convient : <button class="btn sm" type="button" data-ncact="force" ${o.busy ? "disabled" : ""}>Créer quand même</button></p>` : ""}</div>` : "";
  swapHTML(drawerHost, `
    <div class="dh"><span class="ifmt">${ic("users")}</span><div style="flex:1;min-width:0"><h1>Nouveau contact</h1>
      <div class="sub">${o.piste ? `Créé dans Notion puis rattaché à la piste <a href="#/pistes/${o.piste}">${esc(o.pisteNom || "…")}</a>` : "Créé dans la base Contacts de Notion"}</div></div></div>
    ${o.err ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.err)}</span></div>` : ""}
    ${!S.schema ? `<p class="empty">Chargement des champs…</p>` : `<form class="form" id="nc-form" onsubmit="return false">${NOUVEAU.map(fld).join("")}${dbl}
      <div class="mfoot wide"><a class="btn sm" href="${o.piste ? `#/pistes/${o.piste}` : "#/contacts"}">Annuler</a><button class="btn sm pri" type="button" data-ncact="create" ${o.busy ? "disabled" : ""}>${o.busy ? "Création dans Notion…" : o.piste ? "Créer et rattacher" : "Créer le contact"}</button></div></form>
      <p class="small muted" style="margin-top:10px">Seules les propriétés existantes de la base Contacts sont remplies. Les contacts au nom proche sont cherchés dans le miroir pendant la saisie du nom.</p>`}`);
}

/** Lit le formulaire dans o.f (valeurs telles que saisies). */
function readNew(o) {
  for (const el of drawerHost.querySelectorAll("#nc-form [data-nc]")) o.f[el.dataset.nc] = el.value;
}

let dblTimer = null;
function watchDoublons(o) {
  clearTimeout(dblTimer);
  dblTimer = setTimeout(async () => {
    const nom = String(o.f["Nom"] || "").trim();
    if (nom.length < 3) { o.doublons = null; renderDrawer(); return; }
    try { const r = await contactsApi.doublons(nom); if (S.open === o && String(o.f["Nom"] || "").trim() === nom) { o.doublons = r.doublons || []; o.force = false; renderDrawer(); } } catch { /* recherche indisponible : la création la refera */ }
  }, 350);
}

/** Valeurs envoyées à la fonction, sous les noms Notion. Null (et message) si une saisie ne correspond à rien. */
function valuesOf(o) {
  const f = o.f, v = {};
  const byName = (list, n) => list.find((c) => nrm(String(c.nom).trim()) === nrm(String(n).trim()));
  for (const k of ["Nom", "Type", "Position", "Email", "Phone", "Linkedin", "Qualif Prospect", "Parcours réseau"]) if (String(f[k] ?? "").trim()) v[k] = String(f[k]).trim();
  if (!v["Type"]) v["Type"] = "Personne";
  if (v["Position"] && !(S.schema?.editable?.Position?.options || []).includes(v["Position"])) { o.err = `« ${v["Position"]} » n'est pas un poste de Notion : choisis-en un dans la liste ou laisse vide (le cockpit ne crée pas de nouvelle option).`; return null; }
  for (const [k, what] of [["Rattaché à", "organisation"], ["Recommandé par", "personne"]]) {
    if (!String(f[k] ?? "").trim()) continue;
    const c = byName(S.items || [], f[k]);
    if (!c) { o.err = `${what === "organisation" ? "Organisation" : "Personne"} « ${f[k]} » introuvable parmi les contacts actifs : choisis-la dans la liste.`; return null; }
    v[k] = [c.id];
  }
  if (String(f["Notes"] ?? "").trim()) v[v["Type"] === "Personne" ? NOTES_CONTACT : NOTES_ENTREPRISE] = String(f["Notes"]).trim();
  return v;
}

async function createNew(o, force = false) {
  readNew(o); o.err = null;
  const v = valuesOf(o);
  if (!v || !v["Nom"]) { if (v) o.err = "Donne le nom du contact."; renderDrawer(); return; }
  o.busy = true; renderDrawer();
  try {
    const r = await contactsApi.create(v, { piste: o.piste, confirmerDoublon: force });
    if (S.open !== o) return;
    S.acreer = null;
    load(true);
    if (o.piste) {
      if (r.rattachementErreur) toast(r.rattachementErreur, "err"); else toast(`${r.contact.nom} créé dans Notion et rattaché à la piste.`);
      refreshPistes(); pisteSection(o.piste, "contacts");
      location.hash = `#/pistes/${o.piste}`;
    } else {
      toast(`${r.contact.nom} créé dans Notion.`);
      location.hash = `#/contacts/${r.contact.id}`;
    }
  } catch (e) {
    if (S.open !== o) return;
    o.busy = false;
    if (e.code === "doublon") { o.doublons = e.details?.doublons || o.doublons || []; o.force = true; o.err = e.message; }
    else o.err = e.message;
    renderDrawer();
  }
}

/** Rattache à la piste un contact existant proposé comme doublon, au lieu d'en créer un. */
async function pickExisting(o, id) {
  o.busy = true; renderDrawer();
  try {
    await pistesApi.update(o.piste, { "👱‍♀️ Contacts": { add: [id] } });
    toast("Contact existant rattaché à la piste dans Notion.");
    S.acreer = null; refreshPistes(); pisteSection(o.piste, "contacts");
    location.hash = `#/pistes/${o.piste}`;
  } catch (e) { o.busy = false; o.err = e.message; renderDrawer(); }
}

export function bindNewContactEvents(root) {
  root.addEventListener("input", (e) => {
    const o = S.open; if (!o?.isNew || !ownsDrawer("contacts") || !e.target.dataset?.nc) return;
    o.f[e.target.dataset.nc] = e.target.value;
    if (e.target.dataset.nc === "Nom") watchDoublons(o);
  });
  root.addEventListener("change", (e) => {
    const o = S.open; if (!o?.isNew || !ownsDrawer("contacts") || e.target.dataset?.nc !== "Type") return;
    o.f["Type"] = e.target.value; readNew(o); renderDrawer();
  });
  root.addEventListener("click", (e) => {
    const o = S.open; if (!o?.isNew || !ownsDrawer("contacts")) return;
    const a = e.target.closest("[data-ncact]")?.dataset.ncact;
    if (a === "create") { createNew(o, false); return; }
    if (a === "force") { createNew(o, true); return; }
    const pk = e.target.closest("[data-ncpick]");
    if (pk) pickExisting(o, pk.dataset.ncpick);
  });
}

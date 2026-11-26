// Vue « Contacts » : liste des contacts actifs et fiche modifiable.
// Chaque vue du cockpit expose la même interface : { id, label, icon, render(), open(id) }.
import { contactsApi, todoApi, projetsIndex, pistesApi } from "./api.js";
import { $, esc, ic, av, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip, isDone, ficheTop, renderSide, sideHTML, ficheTabs, parcChip, taSpan, syncOf, syncSpan, staleBanner, natureChip, setNoteSaver , swapHTML } from "./ui.js";

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
    render();
    if (!S.items) await load();
  },
  open: openContact,
  close: () => { S.open = null; },
  reload: () => load(true),
};

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
  const mseg = (v, lab) => `<button class="${f.mode === v ? "on" : ""}" data-cmode="${v}" aria-pressed="${f.mode === v}">${lab}</button>`;
  const head = `
    <div class="bar">
      <div class="seg" role="group" aria-label="Affichage">${mseg("liste", ic("list", "ic-sm") + " Liste")}${mseg("cartes", ic("grid", "ic-sm") + " Cartes")}${mseg("acreer", ic("plus", "ic-sm") + " À créer")}</div>
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
    ? `<div><span>Recommandé par</span><b>${c.partial || !c.recommandeParNoms ? "…" : c.recommandeParNoms.length ? names(c.recommandeParNoms) : "Contact direct"}</b></div>`
    : `<div><span>Rattachements</span><b>${c.partial ? "…" : (c.rattacheANoms || []).length ? names(c.rattacheANoms) : orgs.length ? orgs.map((x) => esc(x.nom)).join(", ") : "Aucun"}</b></div>`;
  return `<div class="sfacts">
      ${c.type === "Personne" || !c.type ? `<div><span>Statut</span><b>${c.parcours ? esc(c.parcours) : "Non renseigné"}</b></div>` : ""}
      ${c.nature == null && !c.partial ? `<div><span>Dernier échange</span><b>${c.dernierEchange ? esc(fd(c.dernierEchange)) : "Aucun"}</b><small>Propriété de la fiche (journal non lu)</small></div>` : `<div><span>Dernier échange direct</span><b>${ld ? esc(fd(ld.date)) : c.partial ? "…" : "Aucun au Journal de bord"}</b>${ld ? `<small><a href="https://www.notion.so/${esc(String(ld.id).replace(/-/g, ""))}" target="_blank" rel="noopener">${esc(ld.titre)}</a></small>` : c.dernierEchange ? `<small>Propriété Dernier échange : ${esc(fd(c.dernierEchange))}</small>` : ""}</div>`}
      <div><span>Prochaine étape</span>${next ? `<b><a href="#/todo/${next.id}">${esc(next.nom)}</a></b>${next.echeance ? `<small>${due(next.echeance)}</small>` : ""}`
        : c.prochaineAction ? `<b>${esc(c.prochaineAction)}</b><small>Prochaine action de la fiche ${due(c.dateProchaineAction)}</small>` : `<b>${open === null ? "…" : "Rien de prévu"}</b>`}</div>
      ${c.prochaineEtapePiste ? `<div><span>Prochaine étape d'une piste</span><b><a href="#/pistes/${esc(c.prochaineEtapePiste.piste)}">${esc(c.prochaineEtapePiste.action || c.prochaineEtapePiste.nom)}</a></b><small>${c.prochaineEtapePiste.action ? esc(c.prochaineEtapePiste.nom) + " " : ""}${c.prochaineEtapePiste.date ? due(c.prochaineEtapePiste.date) : "sans date"}</small></div>` : ""}
      ${people}
      <div><span>Liens dans Notion</span><b class="small">${n(rel.opportunites)} opportunité(s) · ${n(rel.todo)} tâche(s) · ${n(rel.journal)} échange(s)</b>${c.partial ? "" : `<small>Recommandé par ${n(rel.recommandePar)} · a recommandé ${n(rel.aRecommande)}</small>`}</div>
    </div>
    ${orgs.length ? `<h3 class="sh">Rattaché à</h3><div class="chips">${orgs.map((x) => `<a class="chip" href="#/contacts/${x.id}">${esc(x.nom)}</a>`).join("")}</div>` : ""}
    <h3 class="sh">À faire ${open ? `<button class="lnk" data-csec="taches">${open.length}</button>` : ""}</h3>
    ${open === null ? `<p class="empty">Chargement des tâches…</p>` : !Array.isArray(o.tasks) ? `<p class="empty">Tâches indisponibles pour l'instant.</p>` : open.length ? `<div class="list">${open.slice(0, 3).map(taskRow).join("")}</div>${open.length > 3 ? `<p class="small muted"><button class="lnk" data-csec="taches">Voir les ${open.length} tâches ouvertes</button></p>` : ""}` : `<p class="empty">Aucune tâche ouverte.</p>`}
    ${c.syntheseAgent ? `<h3 class="sh">Synthèse agent</h3><p class="notes">${esc(c.syntheseAgent)}</p>` : ""}
    ${c.modifie ? `<p class="small muted" style="margin-top:14px">Modifié dans Notion le ${esc(new Date(c.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}. Les notes se modifient dans le panneau Mes notes.</p>` : ""}
    ${c.nature ? `<p class="small muted">Nature calculée par le cockpit : client ou partenaire si le contact est relié par une tâche à une mission en cours ou terminée, ou lié à une piste gagnée ou partenaire, réseau s'il a recommandé quelqu'un ou s'il est hors parcours, prospect sinon.</p>` : ""}`;
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
  return `${head}<div class="list">${p.map(pisteRow).join("")}</div>`;
}

const pisteRow = (x) => `<a class="row" href="#/pistes/${x.id}"><div class="rm"><div class="rt">${esc(x.nom)}</div>
    <div class="ameta">${x.etape ? `<span class="chip">${esc(x.etape)}</span>` : ""}${x.issue ? `<span class="chip">${esc(x.issue)}</span>` : ""}</div>
    ${x.prochaineAction ? `<div class="rs clamp2">${ic("arrow", "ic-sm")} ${esc(x.prochaineAction)}</div>` : ""}</div><div class="rr">${x.dateProchaineAction ? due(x.dateProchaineAction) : ""}</div></a>`;

// ---------------- Contacts « À créer » (C7, lot 2 suite) ----------------

async function loadACreer() {
  S.acreer = "loading"; render();
  try { S.acreer = await contactsApi.aCreer(); } catch (e) { S.acreer = { error: e.message }; }
  render();
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
      <p class="small muted">Rattache un contact existant depuis l'onglet Contacts de la fiche piste, ou crée-le avec « Contact recommandé » dans la vue Réseau.</p>
      ${a.pistesSansContact.length ? `<div class="list">${a.pistesSansContact.map((x) => `<a class="row" href="#/pistes/${x.id}"><div class="rm"><div class="rt">${esc(x.nom)}</div><div class="ameta">${x.etape ? `<span class="chip">${esc(x.etape)}</span>` : ""}${x.issue ? `<span class="chip">${esc(x.issue)}</span>` : ""}</div></div></a>`).join("")}</div>` : `<p class="empty">Toutes les pistes actives ont au moins un contact.</p>`}
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
  const one = (p) => ({ label: lab[p], text: text[p], prop: p, editable: editable(p), locked: !c.partial && m[p] === false, saved: o.savedNote === p });
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
  const lab = `<label for="${id}">${esc(LABEL[name] || name)} <span class="fstate" data-state="${esc(name)}">${saving ? "Enregistrement…" : ""}</span></label>`;
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
    if (m) { S.f.mode = m.dataset.cmode; render(); return; }
    const so = e.target.closest("[data-csort]");
    if (so) { S.f.sort = so.dataset.csort; render(); return; }
    if (e.target.closest('[data-act="reload"]')) load(true);
  });
  root.addEventListener("input", (e) => { if (e.target.id === "cf-q") { S.f.q = e.target.value; render(); } });
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

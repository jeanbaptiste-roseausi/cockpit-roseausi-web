// Vue « Contacts » : liste des contacts actifs et fiche modifiable.
// Chaque vue du cockpit expose la même interface : { id, label, icon, render(), open(id) }.
import { contactsApi, todoApi, projetsIndex, pistesApi, reseauApi, googleApi } from "./api.js";
import { $, esc, ic, av, nrm, fd, due, chip, toast, setDrawerOwner, ownsDrawer, etatChip, isDone, ficheTop, renderSide, sideHTML, ficheTabs, parcChip, taSpan, syncOf, syncSpan, staleBanner, natureChip, setNoteSaver , swapHTML, toastUndo, fmtIcon, initials } from "./ui.js";
import { invalidateReseau, pLab, pCol, lab, toastLien } from "./reseau.js";
import { jetonsHTML } from "./jetons.js";
import { contenuHTML, bindContenu } from "./contenu.js";
import { gread, gstate, gsrc, filRow } from "./google.js";
import { og } from "./origines.js";
import { ppOpts, ppSel, ppTxt, ppLink, ppBand, saFold, nextLine } from "./props.js";
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
  // « Rattacher un existant » (27/11/2026) : une relecture de la liste qui se termine pendant la saisie réécrit la
  // vue ; les noms déjà tapés sont repris, sinon le clic partait avec un champ vide (échec intermittent du banc).
  const tapes = new Map([...host.querySelectorAll("[data-scpiste]")].filter((i) => i.value).map((i) => [i.dataset.scpiste, i.value]));
  host.innerHTML = head + body;
  for (const [id, v] of tapes) { const i = host.querySelector(`[data-scpiste="${CSS.escape(id)}"]`); if (i) i.value = v; }
  if (active === "cf-q") { const i = $("#cf-q", host); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
  else if (active?.startsWith("sc-")) { const i = host.querySelector(`#${CSS.escape(active)}`); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } } }
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
  S.open = { id, contact: fromList ? { ...fromList, partial: true } : null, values: null, saving: new Set(), error: null, tasks: null, pistes: null, sec, echanges: undefined, rz: undefined, memoire: undefined };
  setDrawerOwner("contacts");
  renderDrawer();
  // Fiche alignée sur l'artefact (26/11/2026) : échanges du contact et mises en lien, en parallèle.
  contactsApi.echanges(id).then((r) => { if (S.open?.id === id) { S.open.echanges = r; renderDrawer(); } })
    .catch(() => { if (S.open?.id === id) { S.open.echanges = "error"; renderDrawer(); } });
  reseauData().then((r) => { if (S.open?.id === id) { S.open.rz = r; renderDrawer(); } })
    .catch(() => { if (S.open?.id === id) { S.open.rz = null; renderDrawer(); } });
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

// ---------------- Fiche contact alignée sur l'artefact (26/11/2026) ----------------
// Artefact « Pilotage RoseauSI » 1795698879-79f6, dContact : en-tête « + Échange », « Mise en lien », « Piste »,
// « Action », puis nom, organisation et nature ; onglets Synthèse, Parcours réseau, Échanges, Mails, Pistes,
// Actions, Mises en lien (Membres pour une organisation ou un réseau), Fiche, Mémoire.
const SECS = { synthese: "Synthèse", parcours: "Parcours réseau", echanges: "Échanges", mails: "Mails", pistes: "Pistes", taches: "Actions", liens: "Mises en lien", membres: "Membres", fiche: "Fiche", memoire: "Mémoire" };
const ME_ID = "3dea08ac-5597-811f-b68d-ca88babc6dd9"; // « moi, réseau perso » (fonction reseau)
const isPerson = (c) => !c?.type || c.type === "Personne";
const nidC = (x) => String(x || "").replace(/-/g, "").toLowerCase();

// Réseau (recommandations dans les deux sens, parcours des contacts) : lu une fois par minute au plus.
let RZ = null, RZat = 0;
function reseauData(force = false) {
  if (!RZ || force || Date.now() - RZat > 60_000) { RZat = Date.now(); RZ = reseauApi.list().catch((e) => { RZ = null; throw e; }); }
  return RZ;
}
const rzOf = (o, id) => o.rz?.contacts?.find((x) => nidC(x.id) === nidC(id));

function secsOf(c, o) {
  const openN = Array.isArray(o.tasks) ? o.tasks.filter((x) => !isDone(x)).length : null;
  const s = [["synthese", SECS.synthese]];
  if (isPerson(c)) s.push(["parcours", SECS.parcours]);
  s.push(["echanges", SECS.echanges, Array.isArray(o.echanges?.echanges) ? o.echanges.echanges.length : null]);
  if (c.type !== "Réseau") s.push(["mails", SECS.mails]);
  s.push(["pistes", SECS.pistes, Array.isArray(o.pistes) ? o.pistes.length : null], ["taches", SECS.taches, openN]);
  if (isPerson(c)) { const z = rzOf(o, c.id); s.push(["liens", SECS.liens, z ? z.recommandePar.length + z.aRecommande.length : null]); }
  else s.push(["membres", SECS.membres, S.items ? membresOf(c).length : null]);
  s.push(["fiche", SECS.fiche], ["memoire", SECS.memoire]);
  return s;
}
const membresOf = (c) => (S.items || []).filter((x) => (x.rattacheA || []).some((id) => nidC(id) === nidC(c.id))).sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.nom).localeCompare(String(b.nom), "fr"));

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
  const secs = secsOf(c, o);
  const cur = secs.some((x) => x[0] === o.sec) ? o.sec : "synthese";
  if (cur === "memoire" && o.memoire === undefined) loadMemoire(o);
  // En-tête de l'artefact : + Échange (lot 6, pas encore porté), Mise en lien (personne), Piste, Action.
  const acts = [
    `<button class="btn sm pri" disabled title="Créer un échange depuis le cockpit : lot 6, pas encore porté">${ic("plus", "ic-sm")}Échange</button>`,
    isPerson(c) ? `<button class="btn sm" data-csec="liens">${ic("link", "ic-sm")}Mise en lien</button>` : "",
    `<a class="btn sm" href="#/pistes/new/contact/${o.id}">${ic("target", "ic-sm")}Piste</a>`,
    `<a class="btn sm" href="#/todo/new/${o.id}">${ic("todo", "ic-sm")}Action</a>`,
  ].join("");
  const sub = [subOf(c), c.type !== "Personne" ? c.segmentation : null].filter(Boolean).join(" · ");
  const body = {
    synthese: () => synthese(o), parcours: () => parcoursSec(o), echanges: () => echangesSec(o, 400), mails: () => mailsSec(o),
    pistes: () => pistesSection(o), taches: () => tasksSection(o), liens: () => liensSec(o), membres: () => membresSec(c),
    fiche: () => o.values ? form(o) : `<p class="empty">Chargement des champs…</p>`, memoire: () => memoireSec(o),
  }[cur]();
  swapHTML(drawerHost, `
    <div class="dh"><div class="dact">${acts}</div>${av(c, "lg")}<div style="flex:1;min-width:0"><h1>${esc(c.nom)}</h1><div class="sub">${esc(sub)}</div>
      ${band(o)}</div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${ficheTabs(secs, cur, "data-csec")}
    <section class="cbody" aria-label="${SECS[cur]}">${body}</section>`);
}

// Classe de couleur d'une pastille d'option Notion, reprise pour la chip de la bande.
const clsOf = (prop, val) => (chip("x", colorOf(prop, val)).match(/class="chip ([^"]*)"/) || [])[1] || "";

/**
 * Bande de propriétés du contact (fiches compactes, 27/11/2026). Parcours réseau se modifie sur place avec la même
 * écriture que l'onglet Parcours réseau (setParcours, Annuler compris). Qualification et priorité suivent saveField.
 */
function band(o) {
  const c = o.contact, ed = S.schema?.editable || {}, ready = !!(o.values && !c.partial);
  const can = (k) => ready && !!ed[k];
  const opts = (k, cur) => ppOpts([["", "Non renseigné"], ...(ed[k]?.options || []).map((x) => [x, lab(x) || x])], cur ?? "");
  const ld = c.dernierEchangeDirect;
  const last = ld ? ld.date : c.nature == null ? c.dernierEchange : null;
  const nat = natureChip(c.nature);
  const chips = [
    nat ? nat.replace('class="chip', 'class="chip pp pp-calc dash') : c.type ? ppTxt(esc(c.type)) : "",
    isPerson(c) && can("Parcours réseau") ? ppSel(`data-cparcsel="1"`, opts("Parcours réseau", c.parcours), c.parcours ? `<i class="dot" style="background:${pCol(c.parcours)}"></i>${esc(pLab(c.parcours))}` : "+ Parcours réseau", "Étape du parcours réseau", c.parcours ? "" : "pp-add dash", o.saving.has("parcours"))
      : isPerson(c) && c.parcours ? ppTxt(`<i class="dot" style="background:${pCol(c.parcours)}"></i>${esc(pLab(c.parcours))}`) : "",
    can("Qualif Prospect") && isPerson(c) ? ppSel(`data-cprop="Qualif Prospect"`, opts("Qualif Prospect", o.values["Qualif Prospect"]), c.qualif ? esc(c.qualif) : "+ Qualification", "Qualification", c.qualif ? clsOf("Qualif Prospect", c.qualif) : "pp-add dash", o.saving.has("Qualif Prospect"))
      : c.qualif ? ppTxt(esc(c.qualif), clsOf("Qualif Prospect", c.qualif)) : "",
    can("Prio") ? ppSel(`data-cprop="Prio"`, opts("Prio", o.values["Prio"]), c.prio ? esc(c.prio) : "+ Priorité", "Priorité", c.prio ? clsOf("Prio", c.prio) : "pp-add dash", o.saving.has("Prio"))
      : c.prio ? ppTxt(esc(c.prio), clsOf("Prio", c.prio)) : "",
    c.partial ? "" : ppTxt(last ? `Dernier échange ${esc(fd(last))}` : "Aucun échange", "pp-calc dash", ld ? `Dernier échange direct, lu au Journal de bord : ${ld.titre}` : "Calculé depuis le journal"),
    ...(isPerson(c) && !c.partial ? (c.recommandeParNoms || []).map((x) => nidC(x.id) === nidC(ME_ID) ? ppTxt("Réseau perso", "", "Recommandé par moi, réseau perso") : x.nom ? ppLink(`#/contacts/${x.id}`, `Par ${esc(String(x.nom).trim())}`, "", "Recommandé par") : "") : []),
  ];
  return ppBand(chips);
}

function synthese(o) {
  const c = o.contact;
  const open = Array.isArray(o.tasks) ? o.tasks.filter((x) => !isDone(x)).sort((a, b) => (a.echeance || "9").localeCompare(b.echeance || "9")) : null;
  // Prochaine étape (artefact) : celle d'une piste ouverte d'abord, sinon la première action ouverte, sinon la
  // prochaine action notée sur la fiche du contact.
  const pp = c.prochaineEtapePiste, next = open?.[0];
  const nx = pp ? `<a href="#/pistes/${esc(pp.piste)}">${esc(pp.action || pp.nom)}</a>${pp.action ? `<span class="small muted">${esc(pp.nom)}</span>` : ""}${pp.date ? due(pp.date) : `<span class="small muted">sans date</span>`}`
    : next ? `<a href="#/todo/${next.id}">${esc(next.nom)}</a>${next.echeance ? due(next.echeance) : ""}`
    : c.prochaineAction ? `<span>${esc(c.prochaineAction)}</span>${due(c.dateProchaineAction)}` : "";
  const tel = c.phone ? c.phone.replace(/\s/g, "") : "";
  const coords = [
    tel ? `<a class="btn sm" href="tel:${esc(tel)}">${ic("call", "ic-sm")}Appeler</a>` : "",
    c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}">${ic("mail", "ic-sm")}Écrire</a>` : "",
    c.linkedin ? `<a class="btn sm" href="${esc(c.linkedin)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}LinkedIn</a>` : "",
  ].join("");
  const ech = Array.isArray(o.echanges?.echanges) ? o.echanges.echanges : null;
  const openPs = Array.isArray(o.pistes) ? o.pistes.filter((p) => /En cours/.test(p.issue || "")) : null;
  const orgs = !isPerson(c) && !c.partial && (c.rattacheANoms || []).length ? (c.rattacheANoms || []).map((x) => x.nom ? `<a class="chip pp" href="#/contacts/${x.id}">${esc(x.nom)}</a>` : "").join("") : "";
  return `${nx ? nextLine("Prochaine étape", nx) : open === null ? `<p class="empty">Chargement des actions…</p>` : ""}
    ${coords ? `<div class="dact" style="margin:10px 0 4px">${coords}</div>` : ""}
    ${orgs ? `<h3 class="sh">Rattachements</h3><div class="chips">${orgs}</div>` : ""}
    ${open && open.length ? `<h3 class="sh">À faire <button class="lnk" data-csec="taches">${open.length}</button></h3><div class="list">${open.slice(0, 3).map(taskRow).join("")}</div>` : ""}
    ${openPs && openPs.length ? `<h3 class="sh">Pistes ouvertes</h3><div class="list">${openPs.slice(0, 3).map(pisteRow).join("")}</div>` : ""}
    <h3 class="sh">Derniers échanges ${ech ? `<button class="lnk" data-csec="echanges">${ech.length}</button>` : ""}</h3>${echangesSec(o, 3, true)}
    ${saFold(c.syntheseAgent)}
    ${c.modifie ? `<p class="small muted" style="margin-top:14px">Modifié dans Notion le ${esc(new Date(c.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}. Les notes se modifient dans le panneau Mes notes.</p>` : ""}`;
}

// ---- Parcours réseau (artefact, parcoursSec) ----
const P_MAIN = ["Recommandé", "À contacter", "Contacté", "À relancer", "Échange fait"];
const P_SIDE = ["Relais", "Opportunité créée", "Nurturing", "Pas pertinent", "Contact"];

function parcoursSec(o) {
  const c = o.contact, opts = S.schema?.editable?.["Parcours réseau"]?.options || [];
  const opt = (l) => opts.find((v) => lab(v) === l);
  const curL = lab(c.parcours), busy = o.saving.has("parcours"), dis = busy || !o.values ? "disabled" : "";
  const idx = P_MAIN.indexOf(curL);
  const frise = `<nav class="pfrise cfrise" aria-label="Étape du parcours réseau">${P_MAIN.map((l, i) => { const v = opt(l); return v ? `<button type="button" class="${i === idx ? "on" : i < idx ? "done" : ""}" data-cparc="${esc(v)}" aria-pressed="${i === idx}" ${dis}><span><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))}</span></button>` : ""; }).join("")}</nav>
    <div class="pexits"><span>Sorties</span><button type="button" class="${!c.parcours ? "on" : ""}" data-cparc="" aria-pressed="${!c.parcours}" ${dis}>Non suivi</button>${P_SIDE.map((l) => { const v = opt(l); return v ? `<button type="button" class="${["Relais", "Opportunité créée"].includes(l) ? "win " : ""}${curL === l ? "on" : ""}" data-cparc="${esc(v)}" aria-pressed="${curL === l}" ${dis}><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))}</button>` : ""; }).join("")}</div>`;
  const ld = c.dernierEchangeDirect;
  const late = c.dateProchaineAction && String(c.dateProchaineAction).slice(0, 10) < new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const pBusy = o.saving.has("pa");
  const z = rzOf(o, c.id);
  return `${frise}${busy ? `<p class="small muted">Enregistrement dans Notion…</p>` : ""}
    <form class="form" id="cp-form" onsubmit="return false" style="margin-top:6px">
      <div class="fld wide"><span class="lb">Dernier échange</span><b>${ld ? `<a href="#/journal/${esc(ld.id)}">${esc(fd(ld.date))}</a> · ${esc(ld.titre)}` : c.dernierEchange ? esc(fd(c.dernierEchange)) : "Aucun noté"}</b></div>
      <div class="fld"><label for="cp-pa">Prochaine action${og("contacts", "Prochaine action")}</label><input id="cp-pa" value="${esc(o.paDraft?.pa ?? c.prochaineAction ?? "")}" placeholder="Appeler, envoyer un mail, proposer un café…" autocomplete="off" ${pBusy ? "disabled" : ""}></div>
      <div class="fld"><label for="cp-dpa">Date${og("contacts", "Date prochaine action")} ${late ? `<span class="chip c-crit">en retard</span>` : ""}</label><input type="date" id="cp-dpa" value="${esc(String(o.paDraft?.dpa ?? c.dateProchaineAction ?? "").slice(0, 10))}" ${pBusy ? "disabled" : ""}></div>
      <div class="mfoot wide"><button class="btn sm pri" type="button" data-cpact="pa" ${pBusy || !o.values ? "disabled" : ""}>${pBusy ? "Enregistrement…" : "Enregistrer dans Notion"}</button>${lab(c.parcours) !== "Opportunité créée" ? `<a class="btn sm" href="#/pistes/new/contact/${o.id}">${ic("target", "ic-sm")}Créer la piste</a>` : ""}</div></form>
    ${recoBlocks(o, z, true)}`;
}

/** Recommandé par, A recommandé, gestes de mise en lien et carte : communs à Parcours réseau et Mises en lien. */
function recoBlocks(o, z, carte) {
  const c = o.contact;
  if (o.rz === undefined) return `<p class="empty">Chargement des mises en lien…</p>`;
  if (!o.rz) return `<p class="empty">Mises en lien indisponibles pour l'instant.</p>`;
  if (!z) return `<p class="small muted">Ce contact n'est pas dans les contacts actifs du réseau : mises en lien à voir dans Notion.</p>`;
  const busy = o.saving.has("lien");
  const chipC = (id) => nidC(id) === nidC(ME_ID) ? `<span class="chip c-acc">${ic("home", "ic-sm")} Moi, réseau perso</span>` : (() => { const x = rzOf(o, id); return x ? `<a class="chip" href="#/contacts/${x.id}">${esc(x.nom.trim())}</a>` : `<span class="chip">Contact</span>`; })();
  const pers = (o.rz.contacts || []).filter((x) => x.type !== "Organisation" && x.type !== "Réseau" && nidC(x.id) !== nidC(c.id));
  const choices = (excl) => pers.filter((x) => !excl.some((e) => nidC(e) === nidC(x.id))).map((x) => ({ id: x.id, nom: x.nom.trim(), sub: x.parcours ? pLab(x.parcours) : "" }));
  const toRows = z.aRecommande.map((id) => rzOf(o, id)).filter(Boolean);
  return `<h3 class="sh">Recommandé par${og("contacts", "Recommandé par")}</h3>${z.recommandePar.length ? `<div class="chips">${z.recommandePar.map(chipC).join("")}</div>` : `<p class="muted">Contact direct</p>`}
    <div class="fld" style="margin-top:8px"><span class="lb">Ajouter qui te l'a recommandé</span><div class="recoby-row">${z.recommandePar.some((id) => nidC(id) === nidC(ME_ID)) ? "" : `<button type="button" class="btn sm" data-cpact="moi" ${busy ? "disabled" : ""}>${ic("home", "ic-sm")}Moi, réseau perso</button>`}
      ${jetonsHTML({ id: "cp-recoby", label: "Qui te l'a recommandé", placeholder: "Chercher une personne", busy, items: [], choices: choices(z.recommandePar), onAdd: (id) => relier(o, id, c.id) })}</div></div>
    <h3 class="sh">A recommandé${og("contacts", "A recommandé")}</h3>${toRows.length ? `<div class="list">${toRows.map((t) => `<a class="row" href="#/contacts/${t.id}"><div class="rm"><div class="rt">${esc(t.nom.trim())}</div></div><div class="rr">${t.parcours ? parcPill(t.parcours) : ""}</div></a>`).join("")}</div>` : `<p class="muted">Personne pour l'instant</p>`}
    <div class="fld" style="margin-top:8px"><span class="lb">Ajouter un contact qu'il ou elle t'a donné</span>${jetonsHTML({ id: "cp-reco", label: "Contact recommandé", placeholder: "Chercher le contact recommandé", busy, items: [], choices: choices(z.aRecommande), onAdd: (id) => relier(o, c.id, id) })}</div>
    <p class="small muted" style="margin-top:6px">Une mise en lien s'enregistre aussitôt dans Notion (« Recommandé par » du contact recommandé). Le recommandé passe à Recommandé s'il n'a pas d'étape ou s'il est en Contact. Le recommandeur passe à Relais, sauf s'il y est déjà ou s'il a une piste créée. « Annuler » dans le message retire le lien et remet les deux étapes d'avant.</p>
    ${carte && (z.recommandePar.length || z.aRecommande.length) ? `<h3 class="sh">Carte</h3>${egoSVG(o, z)}` : ""}`;
}
const parcPill = (v) => `<span class="chip parc"><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))}</span>`;

async function relier(o, recommandeur, recommande) {
  if (o.saving.has("lien")) return;
  o.saving.add("lien"); renderDrawer();
  try {
    const r = await reseauApi.relier(recommandeur, recommande);
    const relire = async () => {
      o.rz = await reseauData(true).catch(() => o.rz);
      invalidateReseau();
      const d = await contactsApi.get(o.id).catch(() => null);
      if (d && S.open === o) { o.contact = d.contact; o.values = d.values; }
      if (S.open === o) renderDrawer();
    };
    toastLien(r, recommandeur, recommande, relire);
    await relire();
  } catch (e) { toast(e.message, "err"); }
  finally { o.saving.delete("lien"); renderDrawer(); }
}

async function setParcours(o, v, undoable = true) {
  const c = o.contact, was = c.parcours || "";
  if (was === v || o.saving.has("parcours")) return;
  o.saving.add("parcours"); renderDrawer();
  try {
    const r = await contactsApi.update(o.id, { "Parcours réseau": v || null });
    if (S.open === o) { o.contact = r.contact; o.values = r.values; }
    syncItem(r.contact); invalidateReseau(); RZ = null;
    const n = String(c.nom).trim(), l = v ? pLab(v) : "Non suivi";
    if (undoable) toastUndo(`${n}, ${l}. Enregistré dans Notion.`, () => setParcours(o, was, false));
    else toast(`${n} revient à ${was ? pLab(was) : "Non suivi"}.`);
  } catch (e) { toast(e.message, "err"); }
  finally { o.saving.delete("parcours"); renderDrawer(); }
}

async function saveProchaine(o) {
  const pa = $("#cp-pa", drawerHost)?.value.trim() ?? "", dpa = $("#cp-dpa", drawerHost)?.value ?? "";
  const c = o.contact;
  if (pa === (c.prochaineAction || "") && dpa === String(c.dateProchaineAction || "").slice(0, 10)) { toast("Rien à enregistrer."); return; }
  o.saving.add("pa"); o.paDraft = { pa, dpa }; renderDrawer();
  try {
    const r = await contactsApi.update(o.id, { "Prochaine action": pa || null, "Date prochaine action": dpa || null });
    if (S.open === o) { o.contact = r.contact; o.values = r.values; o.paDraft = null; }
    syncItem(r.contact); invalidateReseau();
    toast("Prochaine action enregistrée dans Notion.");
  } catch (e) { toast(e.message, "err"); }
  finally { o.saving.delete("pa"); renderDrawer(); }
}

// ---- Échanges (artefact, timeline : directs, puis via la piste) ----
function echangesSec(o, max, court = false) {
  const e = o.echanges;
  if (e === undefined) return `<p class="empty">Chargement des échanges…</p>`;
  if (e === "error" || !e.lu) return `<p class="empty">Échanges indisponibles pour l'instant (miroir du Journal).</p>`;
  if (!e.echanges.length) return `<p class="empty">Aucun échange rattaché.</p>`;
  const list = e.echanges.slice(0, max);
  return `<div class="list">${list.map((x) => `<a class="row" href="#/journal/${x.id}">${fmtIcon(x.format)}<div class="rm"><div class="rt">${esc(x.titre)}</div><div class="rs">${esc(fd(x.date))}${x.format ? " · " + esc(String(x.format).replace(/^[^\p{L}\p{N}]+/u, "")) : ""}</div></div>
    <div class="rr">${x.via === "piste" ? `<span class="chip dash" title="Contact déduit via la piste${x.piste && e.pistesNoms[x.piste] ? " « " + esc(e.pistesNoms[x.piste]) + " »" : ""}">via la piste</span>` : ""}</div></a>`).join("")}</div>
    ${!court && e.echanges.length > max ? `<p class="small muted" style="margin-top:6px">Et ${e.echanges.length - max} échanges plus anciens.</p>` : ""}`;
}

// ---- Mails : fils Gmail du contact, par son adresse, six mois (lot 5b) ----
function mailsSec(o) {
  const rerender = () => { if (S.open?.id === o.id && ownsDrawer("contacts") && o.sec === "mails") renderDrawer(); };
  const gm = gread(`contact:${o.id}`, () => googleApi.contact(o.id), rerender);
  const st = gstate(gm, { quoi: "Gmail" });
  if (st) return st;
  if (gm.data.sansAdresse) return `<p class="empty">Pas d'adresse mail sur la fiche Notion : aucun fil Gmail ne peut lui être relié.</p>`;
  return `<p class="small muted" style="margin:0 0 6px">${esc(gm.data.regle)} ${gsrc(gm.data)}</p><div class="list">${gm.data.fils.map((f) => filRow(f)).join("") || `<p class="empty">Aucun fil Gmail avec ${esc(gm.data.contact.emails.join(", "))} sur six mois.</p>`}</div>`;
}

// ---- Mises en lien (personne) et Membres (organisation, réseau) ----
const liensSec = (o) => recoBlocks(o, rzOf(o, o.contact.id), true);
function membresSec(c) {
  if (!S.items) return `<p class="empty">Chargement des contacts…</p>`;
  const m = membresOf(c);
  return m.length ? `<div class="list">${m.map(row).join("")}</div>` : `<p class="empty">Aucune personne rattachée.</p>`;
}

// ---- Mémoire : corps de la page Notion du contact (artefact, pageInline), en lecture seule ----
async function loadMemoire(o, frais = false) {
  o.memoire = null; o.memErr = null;
  try { const r = await contactsApi.memoire(o.id, frais); if (S.open === o) o.memoire = r; }
  catch (e) { if (S.open === o) { o.memoire = false; o.memErr = e.message; } }
  if (S.open === o && o.sec === "memoire") renderDrawer();
}
function memoireSec(o) {
  const c = o.contact;
  return `<p class="small muted" style="margin:0 0 8px">Corps de la page Notion du contact (lecture seule) : ce qu'on y a noté et ce que les agents y écrivent. <button class="lnk" data-cpact="memoire-frais">Relire dans Notion</button></p>
    ${contenuHTML(o.memoire || null, { entree: o.id, url: c.url, erreur: o.memoire === false ? (o.memErr || "Notion n'a pas répondu.") : null, vide: "Rien dans la page Notion de ce contact.", src: "contacts" })}`;
}

// ---- Carte des mises en lien (artefact, egoSVG) ----
function egoSVG(o, z) {
  const c = o.contact;
  const nat = (id) => S.items?.find((x) => nidC(x.id) === nidC(id))?.nature || "prospect";
  const by = z.recommandePar.slice(0, 4), to = z.aRecommande.slice(0, 5);
  const orgs = (c.rattacheA || []).slice(0, 4).map((id) => ({ id, nom: orgName(id) })).filter((x) => x.nom);
  const W = 520, H = 250, cx = W / 2, cy = 128;
  const css = getComputedStyle(document.documentElement);
  const colk = (k) => css.getPropertyValue({ client: "--n-client", reseau: "--n-reseau", prospect: "--n-prospect", org: "--n-org", res: "--n-res" }[k] || "--n-prospect").trim();
  const col = (arr, x, y0, y1) => arr.map((id, i) => ({ id, x, y: arr.length === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * i / (arr.length - 1) }));
  const L = col(by, 150, 50, 200), R = col(to, W - 150, 40, 215);
  const T = orgs.map((x, i) => ({ ...x, x: orgs.length === 1 ? cx : cx - 70 + 140 * i / (orgs.length - 1), y: 34 }));
  const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  const nm = (id) => nidC(id) === nidC(ME_ID) ? "Moi, réseau perso" : (rzOf(o, id)?.nom || "Contact").trim();
  const ln = (x1, y1, x2, y2, reco, sh = 0) => { let ex = x2, ey = y2; if (sh) { const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy); ex = x2 - dx / l * sh; ey = y2 - dy / l * sh; } return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${reco ? "var(--edge-reco)" : "var(--edge)"}" stroke-width="${reco ? 2 : 1.3}" ${reco ? `marker-end="url(#ea)"` : ""}/>`; };
  let s = `<svg class="ego" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mises en lien de ${esc(c.nom)}"><defs><marker id="ea" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--edge-reco)"/></marker></defs>`;
  L.forEach((n) => s += ln(n.x, n.y, cx, cy, true, 26)); R.forEach((n) => s += ln(cx, cy, n.x, n.y, true, 12)); T.forEach((n) => s += ln(cx, cy, n.x, n.y, false));
  if (L.length) s += `<text class="eg-t" x="150" y="16" text-anchor="end">Recommandé par</text>`;
  if (R.length) s += `<text class="eg-t" x="${W - 150}" y="16" text-anchor="start">A présenté</text>`;
  const pnode = (n, a) => `<a href="#/contacts/${n.id}"><circle cx="${n.x}" cy="${n.y}" r="9" fill="${colk(nidC(n.id) === nidC(ME_ID) ? "reseau" : nat(n.id))}"/><text x="${n.x + (a === "end" ? -14 : 14)}" y="${n.y + 4}" text-anchor="${a}">${esc(cut(nm(n.id), 20))}</text></a>`;
  L.forEach((n) => s += pnode(n, "end")); R.forEach((n) => s += pnode(n, "start"));
  T.forEach((n) => s += `<a href="#/contacts/${n.id}"><rect x="${n.x - 8}" y="${n.y - 8}" width="16" height="16" rx="3" fill="${colk("org")}"/><text x="${n.x}" y="${n.y - 13}" text-anchor="middle">${esc(cut(n.nom, 22))}</text></a>`);
  s += `<circle cx="${cx}" cy="${cy}" r="22" fill="${colk(c.nature || "prospect")}"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" style="font-size:12px">${esc(initials(c.nom))}</text></svg>`;
  return s;
}

const taskRow = (x) => `<a class="row" href="#/todo/${x.id}"><div class="rm"><div class="rt ${isDone(x) ? "strike" : ""}">${esc(x.nom)}</div>
    <div class="ameta">${x.prio === "P1" && !isDone(x) ? chip("P1", "red") : ""}${etatChip(x.etat, isDone(x))}${taSpan(x.typeAction)}</div></div><div class="rr">${isDone(x) ? "" : due(x.echeance)}</div></a>`;

function tasksSection(o) {
  const t = o.tasks;
  const head = `<div class="card-h"><span class="small muted" style="flex:1">Actions liées dans la base TO DO</span><a class="btn sm" href="#/todo/new/${o.id}">${ic("plus", "ic-sm")}Action</a></div>`;
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
    if (!ownsDrawer("contacts") || !S.open || S.open.isNew) return;
    const o = S.open;
    const b = e.target.closest("[data-csec]");
    if (b) { o.sec = b.dataset.csec; renderDrawer(); root.scrollTop = 0; return; }
    const p = e.target.closest("[data-cparc]");
    if (p && !p.disabled) { setParcours(o, p.dataset.cparc); return; }
    const a = e.target.closest("[data-cpact]")?.dataset.cpact;
    if (a === "pa") saveProchaine(o);
    else if (a === "moi") relier(o, ME_ID, o.id);
    else if (a === "memoire-frais") loadMemoire(o, true);
  });
  // Mémoire : bascules et sous-pages lues à l'ouverture (même rendu que le compte rendu du Journal).
  bindContenu(root, () => { if (ownsDrawer("contacts") && S.open?.sec === "memoire") renderDrawer(); }, "contacts");
  root.addEventListener("input", (e) => {
    if (!ownsDrawer("contacts") || !S.open || (e.target.id !== "cp-pa" && e.target.id !== "cp-dpa")) return;
    S.open.paDraft = { pa: $("#cp-pa", root)?.value ?? "", dpa: $("#cp-dpa", root)?.value ?? "" };
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset?.cprop) { saveField(e.target); return; }
    // Bande de propriétés : parcours réseau, même écriture que l'onglet Parcours réseau.
    if (e.target.dataset?.cparcsel && ownsDrawer("contacts") && S.open && !S.open.isNew) setParcours(S.open, e.target.value);
  });
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

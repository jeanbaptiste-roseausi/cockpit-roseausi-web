// Vue « Prospection » (lot 2) : pilotage (entonnoir par étape et par origine, relances dues, pistes sans
// prochaine action, effort commercial 2027), tableau par étape avec glisser-déposer, liste, et fiche piste
// plein écran. Les chiffres viennent de la fonction pistes : la pondération est celle des formules Notion.
import { pistesApi, todoApi, projetsIndex } from "./api.js";
import { contactIndex, invalidateACreer, refreshContacts } from "./contacts.js";
import { invalidateReseau } from "./reseau.js";
import { setTaskEtat } from "./todo.js";
import { $, esc, ic, nrm, fd, due, toast, toastUndo, setDrawerOwner, ownsDrawer, etatChip, isDone, ficheTop, renderSide, sideHTML, ficheTabs, fmtIcon, taSpan, chip, syncOf, syncSpan, staleBanner, initials, setNoteSaver, swapHTML } from "./ui.js";
import { og } from "./origines.js";
import { ppOpts, ppSel, ppTxt, ppLink, ppBtn, ppBand, saFold, nextLine } from "./props.js";
import { jetonsHTML } from "./jetons.js";

const S = {
  items: null, etapes: [], origines: [], issues: [], synthese: null, regles: null, pn: {}, cn: {},
  loading: false, error: null, synchro: null,
  f: { mode: "pilotage", vue: "actives", prio: "", src: "", q: "", st: "", ent: "actives" },
  open: null, busy: new Set(),
};
let host = null, drawerHost = null;

export const pistesView = {
  id: "pistes",
  label: "Pistes",
  short: "Pistes",
  icon: "target",
  async mount(container, drawer) {
    host = container; drawerHost = drawer;
    render();
    if (!S.items) await load();
  },
  open: openPiste,
  // #/pistes/new (bouton « + Piste ») et #/pistes/new/contact/<id> (bouton « Piste » du parcours réseau).
  openNew: (kind, id) => openNewPiste(kind === "contact" ? id : null),
  close: () => { S.open = null; },
  reload: () => load(),
};

/** Relit les pistes (après un geste fait ailleurs : contact créé et rattaché, tâche créée). */
export const refreshPistes = () => { if (S.items) load(true); };
/** Section à ouvrir à la prochaine ouverture de cette fiche (retour après « Créer et rattacher »). */
let nextSec = null;
export const pisteSection = (id, sec) => { nextSec = { id, sec }; };

// ---------------- Prochaine action calculée depuis TO DO (26/11/2026) ----------------
// La prochaine action d'une piste est sa tâche ouverte liée à l'échéance la plus proche (fonction pistes).
// Le texte libre de Notion vient en second, comme note qui peut être périmée.
const nxDate = (p) => p.prochaine?.echeance || "";
/** Dernier contact : Dernière interaction ou dernier échange au Journal, le plus récent (fonction pistes, 28/11/2026). */
const contactDe = (p) => p.dernierContact || p.derniereInteraction || "";
/** Tri des pistes (_shared/regles.ts) : prio décroissante, prochaine action croissante, dernier contact du plus récent au plus ancien. */
export const ordrePistes = (a, b) => (starsN(b.prio) ?? -1) - (starsN(a.prio) ?? -1)
  || String(nxDate(a) || "9").localeCompare(String(nxDate(b) || "9"))
  || String(contactDe(b)).localeCompare(String(contactDe(a)));
const autres = (p) => p.autresTaches ? ` <span class="small muted">+ ${p.autresTaches} autre${p.autresTaches > 1 ? "s" : ""} tâche${p.autresTaches > 1 ? "s" : ""} ouverte${p.autresTaches > 1 ? "s" : ""}</span>` : "";
/** Ligne courte (listes, cartes) : intitulé de la prochaine tâche, ou l'alerte. */
function nxLine(p) {
  if (!p.prochaineCalculee) return `<div class="rs clamp2 small muted">Prochaine action non calculée (TO DO illisible)</div>`;
  if (!p.prochaine) return `<div class="rs nx-none">${ic("alert", "ic-sm")} Aucune action planifiée</div>`;
  return `<div class="rs clamp2">${ic("arrow", "ic-sm")} ${esc(p.prochaine.nom)}${autres(p)}</div>`;
}
const nxDue = (p) => p.prochaine ? (p.prochaine.echeance ? due(p.prochaine.echeance) : `<span class="chip dash">Sans échéance</span>`) : "";
/** Note libre de Notion (texte « Prochaine action » et sa date), jamais modifiée par le cockpit. */
function noteLibre(p) {
  if (!p.noteLibre && !p.noteLibreDate) return "";
  const m = p.modifie ? new Date(p.modifie).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
  return `<div class="note-libre"><div class="nl-h">Note libre (Notion)${og("pistes", "Prochaine action")}</div>
    ${p.noteLibre ? `<p>${esc(p.noteLibre)}</p>` : ""}${p.noteLibreDate ? `<p class="small">Date notée : ${esc(fd(p.noteLibreDate))}</p>` : ""}
    <p class="small muted">Texte de la propriété « Prochaine action » de Notion${m ? `, piste modifiée le ${esc(m)}` : ""}. Il peut être périmé : la prochaine action est désormais la tâche TO DO liée.</p></div>`;
}
/** Petit formulaire « Planifier » : crée une tâche TO DO liée à la piste (intitulé, échéance). */
const planForm = (id, busy, idp = "pl") => `<form class="planf" data-plform="${id}" onsubmit="return false">
  <label class="sr" for="${idp}-n-${id}">Intitulé de la tâche</label><input class="inp" id="${idp}-n-${id}" data-pln placeholder="Prochaine action (ex. Appeler pour fixer un rendez-vous)" autocomplete="off" ${busy ? "disabled" : ""}>
  <label class="sr" for="${idp}-d-${id}">Échéance</label><input type="date" id="${idp}-d-${id}" data-pld ${busy ? "disabled" : ""}>
  <button class="btn sm pri" type="button" data-plgo="${id}" ${busy ? "disabled" : ""}>${busy ? "Création…" : `${ic("plus", "ic-sm")}Planifier`}</button></form>`;

async function load(silent = false) {
  if (S.loading) return;
  S.loading = true; if (!silent) { S.error = null; render(); }
  try {
    const r = await pistesApi.list();
    Object.assign(S, { items: r.pistes, etapes: r.etapes, origines: r.origines, issues: r.issues, synthese: r.synthese, regles: r.regles, pn: r.projetsNoms || {}, cn: r.contactsNoms || {}, synchro: syncOf(r), error: null });
  } catch (e) { if (!silent || !S.items) S.error = e.message; }
  finally { S.loading = false; render(); }
}

/** Index léger des pistes pour la recherche globale. */
export async function pisteIndex() {
  if (!S.items) await load(true);
  return S.items || [];
}

// ---------------- Libellés et pastilles ----------------

/** Libellé Notion sans l'emoji de tête (« 🔁Qualification » → « Qualification »). */
export const lab = (v) => (v == null ? "" : String(v).replace(/^[^\p{L}\p{N}]+/u, "").trim());
const ST_COL = ["#bfbfbf", "#9aa5a3", "#6fb8b2", "#3d9e97", "#008078", "#006b64"];
const stCol = (e) => { const i = S.etapes.indexOf(e); return i < 0 ? "#9aa5a3" : ST_COL[Math.min(i, ST_COL.length - 1)]; };
const stChip = (e) => e ? `<span class="chip"><i class="dot" style="background:${stCol(e)}"></i>${esc(lab(e))}</span>` : `<span class="chip dash">Étape absente</span>`;
const ISS_CL = { "En cours": "st-encours", "Gagné": "c-good", "Perdu": "c-crit", "Pas de réponse": "", "Partenaire": "st-termine", "Pas maintenant": "st-attente", "Nurturing": "st-relire" };
const issChip = (i, always = false) => i && (always || lab(i) !== "En cours") ? `<span class="chip ${ISS_CL[lab(i)] ?? ""}">${esc(lab(i))}</span>` : "";
const starsN = (p) => !p ? null : /🧊/u.test(p) ? 0 : ((String(p).match(/⭐/gu) || []).length || null);
const stars = (p) => { const n = starsN(p); return n == null ? "" : n === 0 ? `<span class="chip st-encours" title="Priorité froide">Froide</span>` : `<span class="stars" title="Priorité ${n} sur 3">${"★".repeat(n)}${"☆".repeat(3 - n)}</span>`; };
const j1 = (x) => x == null ? "–" : `${String(Math.round(x * 10) / 10).replace(".", ",")} j`;
const eur = (x) => x == null ? "–" : `${Math.round(x).toLocaleString("fr-FR")} €`;
const pct = (x) => x == null ? "–" : `${Math.round(x * 100)} %`;
const today = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
function ago(iso) {
  const d = Math.round((new Date(today()) - new Date(String(iso).slice(0, 10))) / 86_400_000);
  return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : d < 60 ? `il y a ${d} j` : `il y a ${Math.round(d / 30)} mois`;
}
const isActive = (p) => ["En cours", "Nurturing", ""].includes(lab(p.issue)) && lab(p.etape) !== "Gagné";
const mobile = () => window.matchMedia("(max-width: 900px)").matches;
const byId = (id) => (S.items || []).find((x) => x.id === id);
const avs = (ids) => `<span class="avs">${ids.slice(0, 3).map((id) => S.cn[id] ? `<span class="av" title="${esc(S.cn[id])}" aria-hidden="true">${esc(initials(S.cn[id]))}</span>` : "").join("")}</span>`;

// ---------------- Vue ----------------

function filtered(ignoreSt) {
  const f = S.f, q = nrm(f.q.trim());
  return (S.items || []).filter((p) => {
    const iss = lab(p.issue);
    if (f.vue === "actives" && !isActive(p)) return false;
    if (f.vue === "gagnees" && iss !== "Gagné") return false;
    if (f.vue === "partenaires" && iss !== "Partenaire") return false;
    if (f.vue === "pause" && !["Pas maintenant", "Pas de réponse", "Perdu"].includes(iss)) return false;
    if (f.prio !== "" && String(starsN(p.prio)) !== f.prio) return false;
    if (f.src && !p.tags.includes(f.src)) return false;
    if (!ignoreSt && f.st && p.etape !== f.st) return false;
    if (q && !nrm([p.nom, p.prochaine?.nom, p.noteLibre, ...p.contacts.map((id) => S.cn[id] || "")].join(" ")).includes(q)) return false;
    return true;
  }).sort(ordrePistes);
}

function render() {
  if (!host) return;
  const f = S.f;
  const seg = (key, val, lbl) => `<button class="${f[key] === val ? "on" : ""}" data-pif="${key}:${val}">${lbl}</button>`;
  const filters = f.mode === "pilotage" ? "" : `<div class="seg" role="group" aria-label="Pistes">${seg("vue", "actives", "Actives")}${seg("vue", "gagnees", "Gagnées")}${seg("vue", "partenaires", "Partenaires")}${seg("vue", "pause", "En pause")}${seg("vue", "toutes", "Toutes")}</div>
    <label class="sr" for="pi-prio">Priorité</label><select class="sel" id="pi-prio" data-pisel="prio"><option value="">Toutes priorités</option>${[3, 2, 1, 0].map((n) => `<option value="${n}" ${f.prio === String(n) ? "selected" : ""}>${n ? "★".repeat(n) : "Froide"}</option>`).join("")}</select>
    <label class="sr" for="pi-src">Origine</label><select class="sel" id="pi-src" data-pisel="src"><option value="">Toutes origines</option>${S.origines.map((t) => `<option value="${esc(t)}" ${f.src === t ? "selected" : ""}>${esc(lab(t))}</option>`).join("")}</select>
    <label class="sr" for="pi-q">Filtrer les pistes</label><input class="inp grow" id="pi-q" type="search" placeholder="Filtrer par nom, contact, action…" value="${esc(f.q)}" autocomplete="off">`;
  const head = `<div class="bar"><a class="btn sm pri" href="#/pistes/new">${ic("plus", "ic-sm")}Piste</a><div class="seg" role="group" aria-label="Affichage">${seg("mode", "pilotage", ic("layers", "ic-sm") + " Pilotage")}${seg("mode", "tableau", ic("board", "ic-sm") + " Tableau")}${seg("mode", "liste", ic("list", "ic-sm") + " Liste")}</div>${filters}</div>`;
  let body;
  if (S.error) body = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`;
  else if (!S.items) body = `<div class="card"><p class="empty">Chargement des pistes depuis Notion…</p></div>`;
  else body = `${staleBanner(S.synchro)}` + (f.mode === "pilotage" ? pilotage() : f.mode === "tableau" && !mobile() ? tableau() : liste());
  const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  host.innerHTML = head + body;
  if (active === "pi-q") { const i = $("#pi-q", host); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
}

const syncLine = (extra = "") => `<p class="small muted" style="margin:-4px 0 12px">${syncSpan(S.synchro, true)}${S.loading ? ", mise à jour…" : ""}.${extra}</p>`;

function pisteRow(p, { plan = false } = {}) {
  const busy = S.busy.has("plan:" + p.id);
  return `<div class="row pi-row ${plan ? "pi-plan-row" : ""}"><a class="rm" href="#/pistes/${p.id}"><div class="rt">${esc(p.nom)}</div>
    ${nxLine(p)}
    <div class="chips" style="margin-top:6px">${stChip(p.etape)}${issChip(p.issue)}${p.tags.slice(0, 1).map((t) => `<span class="chip">${esc(lab(t))}</span>`).join("")}</div></a>
    <div class="rr">${nxDue(p)}${stars(p.prio)}</div>${plan ? planForm(p.id, busy) : ""}</div>`;
}

function pilotage() {
  const sy = S.synthese, e = sy.effort;
  const rel = sy.relancesDues.map(byId).filter(Boolean), sans = sy.sansProchaineAction.map(byId).filter(Boolean);
  const pond = e.joursPonderes + e.joursPonderesSansDate + e.joursPonderesAutreAnnee;
  return syncLine(` ${esc(S.regles?.ponderation || "")}`) + `
  <div class="kpis">
    <div class="kpi"><b>${sy.actives}</b><span>Pistes actives</span><small>sur ${sy.total} pistes</small></div>
    <div class="kpi ${rel.length ? "alert" : ""}"><b>${rel.length}</b><span>Relances dues</span><small>prochaine tâche échue</small></div>
    <div class="kpi ${sans.length ? "alert" : ""}"><b>${sans.length}</b><span>Sans prochaine action</span><small>pistes actives sans tâche ouverte</small></div>
    <div class="kpi"><b>${j1(pond).replace(" j", "")}<small> j</small></b><span>Jours pondérés</span><small>pipe ouvert, formule Notion</small></div>
  </div>
  <div class="grid2 pi-top">${entonnoir()}${effort(e)}</div>
  <div class="grid2">
    <section class="card"><div class="card-h"><h2>Relances dues</h2><span class="count">${rel.length}</span></div>
      <p class="small muted" style="margin-bottom:6px">${esc(S.regles.relance)} ${esc(S.regles.prochaine || "")}</p>
      <div class="list">${rel.map((p) => pisteRow(p)).join("") || `<p class="empty">Aucune relance due.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Pistes sans prochaine action</h2><span class="count">${sans.length}</span></div>
      <p class="small muted" style="margin-bottom:6px">${esc(S.regles.sansAction)} « Planifier » crée une tâche TO DO liée à la piste, avec son intitulé et son échéance.</p>
      <div class="list">${sans.map((p) => pisteRow(p, { plan: true })).join("") || `<p class="empty">Toutes les pistes actives ont une tâche ouverte liée.</p>`}</div></section>
  </div>
`;
}

function entonnoir() {
  const f = S.f, rows = S.synthese.entonnoir[f.ent].filter((r) => r.etape || r.total);
  const cols = S.origines.filter((o) => rows.some((r) => r.parOrigine[o])).concat(rows.some((r) => r.parOrigine[""]) ? [""] : []);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const seg = (v, l) => `<button class="${f.ent === v ? "on" : ""}" data-pif="ent:${v}">${l}</button>`;
  const name = (o) => o ? esc(lab(o)) : "Sans origine";
  return `<section class="card"><div class="card-h"><h2>Entonnoir par étape et par origine</h2><div class="seg" style="margin-left:auto" role="group" aria-label="Pistes comptées">${seg("actives", "Actives")}${seg("toutes", "Toutes")}</div></div>
    <p class="small muted" style="margin-bottom:10px">Nombre de pistes à chaque étape (propriété Status), réparties selon l'origine (Tags). Une piste à plusieurs origines compte dans chacune.</p>
    <div class="funnel">${rows.map((r) => `<div class="fn-row">
      <div class="fn-h"><span class="fn-l"><i class="dot" style="background:${stCol(r.etape)}"></i>${r.etape ? esc(lab(r.etape)) : "Étape absente"}</span><b>${r.total}</b>${r.joursPonderes ? `<span class="small muted">${j1(r.joursPonderes)} pondérés</span>` : ""}</div>
      <div class="fn-bar"><i style="width:${Math.round((r.total / max) * 100)}%;background:${stCol(r.etape)}"></i></div>
      <div class="chips">${cols.filter((o) => r.parOrigine[o]).map((o) => `<button class="chip" data-pient="${esc(r.etape)}|${esc(o)}">${name(o)} · ${r.parOrigine[o]}</button>`).join("")}</div></div>`).join("")}</div>
  </section>`;
}

function effort(e) {
  return `<section class="card"><div class="card-h"><h2>Effort commercial ${e.annee}</h2></div>
    <div class="pkpis eff">
      <div class="pk"><span>Jours signés</span><b>${j1(e.joursSignes)}</b><small>${e.signees.length} piste${e.signees.length > 1 ? "s" : ""} gagnée${e.signees.length > 1 ? "s" : ""} à signature prévue en ${e.annee}</small></div>
      <div class="pk"><span>Jours pondérés</span><b>${j1(e.joursPonderes)}</b><small>signature prévue en ${e.annee}${e.joursPonderesSansDate ? ` ; ${j1(e.joursPonderesSansDate)} sans date de signature` : ""}${e.joursPonderesAutreAnnee ? ` ; ${j1(e.joursPonderesAutreAnnee)} sur une autre année` : ""}</small></div>
      <div class="pk"><span>Restant à vendre</span><b>–</b><small>Indisponible. ${esc(e.restantRaison)}</small></div>
    </div>
    <ul class="nr-list small muted">
      ${e.gagneesSansDate ? `<li>${e.gagneesSansDate} pistes gagnées n'ont pas de date de signature prévue (${j1(e.gagneesSansDateJours)} estimés) : leur année est inconnue, elles ne sont pas comptées.</li>` : ""}
      ${e.sansTaille ? `<li>${e.sansTaille} pistes actives n'ont ni taille ni CA estimé : Notion leur donne 0 jour estimé, donc 0 jour pondéré. Choisis une taille dans la fiche.</li>` : ""}
      <li>Jours vendus et période d'une piste gagnée : propriétés absentes de la base Pistes, non suivies.</li>
      <li>Repère hors Notion : l'expression de besoin du 06/11 cite environ 106 jours à vendre en ${e.annee} (prévisionnel du 20/10), non utilisé dans le calcul.</li>
    </ul>
    <p class="small muted">${esc(S.regles.signes)} ${esc(S.regles.ponderes)}</p></section>`;
}

function pisteCard(p, drag) {
  return `<a class="pcard picard" href="#/pistes/${p.id}" ${drag ? `draggable="true" data-pidrag="${p.id}"` : ""}>
    <div class="pc-top">${stars(p.prio)}${p.tags.slice(0, 1).map((t) => `<span class="chip">${esc(lab(t))}</span>`).join("")}${issChip(p.issue)}${/Opportunit/.test(p.leadOpportunite || "") ? `<span class="chip st-relire" title="Qualifiée en opportunité">Opportunité</span>` : ""}</div>
    <h3>${esc(p.nom)}</h3>
    <div class="pc-pa">${nxLine(p)}</div>
    <div class="pc-meta">${p.prochaine ? nxDue(p) : ""}${contactDe(p) ? `<span title="Dernier contact : Dernière interaction ou échange au Journal">Échange ${esc(ago(contactDe(p)))}</span>` : ""}${p.caEstime ? `<span class="num">${eur(p.caEstime)}</span>` : ""}${p.joursPonderes ? `<span class="num">${j1(p.joursPonderes)} pond.</span>` : ""}${avs(p.contacts)}</div>
  </a>`;
}

function tableau() {
  const list = filtered(true);
  const cols = S.etapes.map((st) => {
    const items = list.filter((p) => p.etape === st);
    return `<section class="col" data-pidrop="${esc(st)}"><div class="col-h"><i class="dot" style="background:${stCol(st)}"></i>${esc(lab(st))}<span class="n">${items.length}</span></div>${items.map((p) => pisteCard(p, true)).join("") || `<p class="small muted" style="padding:6px">Glisser une piste ici</p>`}</section>`;
  }).join("");
  return syncLine(` ${list.length} pistes. Glisse une carte d'une colonne à l'autre pour changer son étape dans Notion.`) + `<div class="board piboard">${cols}</div>`;
}

function liste() {
  const f = S.f, list = filtered(true);
  const shown = f.st ? list.filter((p) => p.etape === f.st) : list;
  return syncLine(mobile() && f.mode === "tableau" ? " Sur téléphone, le tableau s'affiche en liste ; l'étape se change dans la fiche." : "") + `<div class="chips" style="margin-bottom:12px"><button class="chip ${!f.st ? "st-encours" : ""}" data-pif="st:">Toutes les étapes · ${list.length}</button>${S.etapes.map((st) => `<button class="chip ${f.st === st ? "st-encours" : ""}" data-pif="st:${esc(st)}"><i class="dot" style="background:${stCol(st)}"></i>${esc(lab(st))} · ${list.filter((p) => p.etape === st).length}</button>`).join("")}</div>
    <div class="plist">${shown.map((p) => pisteCard(p, false)).join("") || `<p class="empty">Aucune piste pour ces filtres.</p>`}</div>`;
}

// ---------------- Écriture ----------------

/** Modifie une piste dans Notion, puis met à jour la liste, la fiche et la synthèse. */
async function update(id, changes, msg, avant) {
  const r = await pistesApi.update(id, changes, avant);
  if (S.items) { const i = S.items.findIndex((x) => x.id === id); if (i >= 0) S.items[i] = { ...S.items[i], ...pickList(r.piste) }; }
  if (S.open?.id === id) { S.open.p = r.piste; S.open.values = r.values; S.open.synchro = syncOf(r); }
  if (msg) toast(msg);
  if (changes["👱‍♀️ Contacts"]) invalidateACreer(); // « Pistes actives sans contact » relue au prochain affichage
  load(true); // synthèse recalculée par la fonction
  return r;
}
const LIST_KEYS = ["nom", "etape", "issue", "prio", "taille", "tags", "leadOpportunite", "caEstime", "caReel", "joursEstimes", "probabilite", "joursPonderes", "noteLibre", "noteLibreDate", "prochaine", "autresTaches", "prochaineCalculee", "dateSignature", "derniereInteraction", "contacts", "projets", "modifie"];
const pickList = (p) => Object.fromEntries(LIST_KEYS.map((k) => [k, p[k]]));

async function withBusy(key, fn) {
  if (S.busy.has(key)) return;
  S.busy.add(key); render(); renderDrawer();
  try { await fn(); } catch (e) { toast(e.message, "err"); }
  finally { S.busy.delete(key); render(); renderDrawer(); }
}

// ---------------- Fiche ----------------

const SECS = { synthese: "Synthèse", suivi: "Suivi", echanges: "Échanges", actions: "Actions", contacts: "Contacts", reperes: "Repères" };

async function openPiste(id) {
  const fromList = byId(id);
  const sec = nextSec?.id === id ? nextSec.sec : S.open?.id === id ? S.open.sec : "synthese";
  nextSec = null;
  S.open = { id, p: fromList ? { ...fromList, partial: true } : null, values: null, error: null, sec, gagne: false, plan: false, done: new Map() };
  if (sec === "contacts") loadContacts();
  setDrawerOwner("pistes");
  renderDrawer();
  try {
    const r = await pistesApi.get(id);
    if (S.open?.id !== id) return;
    S.open.p = r.piste; S.open.values = r.values; S.open.editable = r.editable; S.open.synchro = syncOf(r);
  } catch (e) { if (S.open?.id === id) S.open.error = e.message; }
  renderDrawer();
}

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost || !ownsDrawer("pistes")) return;
  if (o.isNew) { renderNew(o); return; }
  const p = o.p;
  ficheTop({ kind: "Piste", url: p?.url || null, side: true });
  // Mes notes de la piste : modifiables ici comme pour les autres fiches (même garde-fous), si Notion les donne sans mise en forme.
  renderSide("pistes", sideHTML({
    notes: [{ label: "Mes notes", text: p?.mesNotes, prop: "Mes notes", editable: !!(p && !p.partial && o.values && p.notesModifiables?.["Mes notes"] && o.editable?.["Mes notes"]), locked: p?.notesModifiables?.["Mes notes"] === false, saved: o.savedNote === "Mes notes", og: og("pistes", "Mes notes") }],
    notesMissing: !p || p.partial ? "Chargement…" : "",
  }));
  if (!p) { drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement de la piste…</p>`; return; }
  const full = !p.partial, iss = lab(p.issue), won = iss === "Gagné";
  const tasks = full ? (p.taches || []).map((t) => o.done.get(t.id) || t) : [];
  const open = tasks.filter((t) => !isDone(t));
  const cur = o.sec;
  const secs = [["synthese", SECS.synthese], ["suivi", SECS.suivi], ["echanges", SECS.echanges, full && p.echanges ? p.echanges.length : null], ["actions", SECS.actions, full && p.taches ? open.length : null], ["contacts", SECS.contacts, p.contacts.length], ["reperes", SECS.reperes]];
  const body = !full && cur !== "synthese" ? `<p class="empty">Chargement…</p>` : {
    synthese: () => synthese(o, p, open),
    suivi: () => suivi(o, p),
    echanges: () => echanges(p, 400),
    actions: () => p.taches == null ? `<p class="empty">Tâches non lues : le miroir TO DO n'est pas prêt.</p>` : tasks.length ? `<div class="list">${tasks.map((t) => taskRow(t, S.busy.has("t:" + t.id))).join("")}</div>` : `<p class="empty">Aucune tâche liée.</p>`,
    contacts: () => contacts(o, p),
    reperes: () => reperes(p),
  }[cur]();
  drawerHost.innerHTML = `
    <div class="dh"><div class="dact">
      ${won ? `<span class="chip c-good">${ic("win", "ic-sm")}Gagnée</span>` : `<button class="btn sm pri" data-piact="gagne" ${o.values ? "" : "disabled"}>${ic("win", "ic-sm")}Marquer gagnée</button>`}
      ${iss === "Perdu" ? `<button class="btn sm" data-piact="rouvrir" ${o.values ? "" : "disabled"}>${ic("reset", "ic-sm")}Rouvrir</button>` : !won ? `<button class="btn sm danger" data-piact="perdu" ${o.values ? "" : "disabled"}>${ic("close", "ic-sm")}Perdue</button>` : ""}
      <button class="btn sm" data-piact="plan" aria-expanded="${o.plan ? "true" : "false"}" title="Crée une tâche TO DO liée à la piste">${ic("flag", "ic-sm")}Planifier</button>
      <a class="btn sm" href="#/todo/new/piste/${p.id}" title="Nouvelle tâche liée à cette piste, créée dans la base TO DO">${ic("todo", "ic-sm")}Action</a>
      <button class="btn sm" disabled title="Échanges au lot 6">${ic("plus", "ic-sm")}Échange</button></div>
      <span class="ifmt">${ic("target")}</span><div style="flex:1;min-width:0"><h1>${esc(p.nom)}</h1>
      ${band(o, p)}</div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${o.gagne ? gagneBox(o, p) : ""}
    ${o.plan ? `<div class="banner info">${ic("flag", "ic-sm")}<div style="flex:1;min-width:0"><b>Planifier la prochaine action.</b> Une tâche TO DO liée à la piste est créée dans Notion, avec son intitulé et son échéance. Le texte libre de Notion n'est pas modifié.${planForm(p.id, S.busy.has("plan:" + p.id), "pf")}<div class="dact" style="margin-top:6px"><button class="btn sm" data-piact="plan-non">Fermer</button></div></div></div>` : ""}
    ${ficheTabs(secs, cur, "data-pisec")}
    <section class="cbody" aria-label="${SECS[cur]}">${body}</section>
    <p class="small muted" style="margin-top:14px">${o.synchro ? syncSpan(o.synchro, true) : "Lu dans Notion"}. Fiche modifiée dans Notion le ${esc(new Date(p.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}${og("pistes", "Modifié le")}.</p>`;
}

// ---------------- Nouvelle piste (26/11/2026) ----------------
// Reprise du formulaire de l'artefact (new-piste) : nom, étape, priorité, origine, contacts, projet. La prochaine
// action n'est pas écrite sur la piste (règle du 26/11) : « Première action » crée une tâche TO DO liée.
// Les pistes proches sont cherchées pendant la saisie et redemandées par la fonction avant de créer.

async function openNewPiste(contactId) {
  S.open = { id: "new", isNew: true, contact: contactId, f: { nom: "", etape: "", prio: "", tag: "", contacts: contactId ? [contactId] : [], projets: [], action: "", ech: "", parcours: true },
    schema: null, contactsList: null, projets: null, doublons: null, force: false, busy: false, err: null };
  const o = S.open;
  setDrawerOwner("pistes");
  renderDrawer();
  const [sc, cl, pj] = await Promise.allSettled([pistesApi.schema(), contactIndex(), projetsIndex()]);
  if (S.open !== o) return;
  if (sc.status === "fulfilled") o.schema = sc.value; else o.err = sc.reason?.message || "Champs de la base Pistes illisibles.";
  o.contactsList = cl.status === "fulfilled" ? cl.value : [];
  o.projets = pj.status === "fulfilled" ? pj.value : [];
  // Depuis le parcours réseau : piste préremplie au nom du contact (et de son organisation), origine Réseau.
  if (contactId) {
    const c = o.contactsList.find((x) => x.id === contactId);
    const orgC = o.contactsList.find((x) => (c?.rattacheA || []).includes(x.id) && x.type === "Organisation");
    const org = orgC ? String(orgC.nom).trim() : "";
    if (c && !o.f.nom) o.f.nom = [String(c.nom).trim(), org].filter(Boolean).join(" - ");
  }
  if (o.schema) {
    o.f.etape = o.f.etape || o.schema.etapes?.[0] || "";
    if (!o.f.tag) o.f.tag = (o.schema.origines || []).find((t) => lab(t) === "Réseau") || "";
  }
  renderDrawer();
  if (o.f.nom) watchPisteDoublons(o, 0);
}

const cName = (o, id) => String((o.contactsList || []).find((c) => c.id === id)?.nom ?? "Contact").trim();
const pName = (o, id) => String((o.projets || []).find((p) => p.id === id)?.nom ?? "Projet").trim();

function renderNew(o) {
  ficheTop({ kind: "Nouvelle piste", url: null, side: false });
  const f = o.f, sc = o.schema, dis = o.busy ? "disabled" : "";
  const opt = (list, cur, empty) => `${empty != null ? `<option value="">${esc(empty)}</option>` : ""}${(list || []).map((x) => `<option value="${esc(x)}" ${x === cur ? "selected" : ""}>${esc(lab(x))}</option>`).join("")}`;
  const d = o.doublons;
  const dbl = d && d.length ? `<div class="dbl wide"><b>${d.length} piste${d.length > 1 ? "s" : ""} proche${d.length > 1 ? "s" : ""} dans Notion</b><p class="small" style="margin:4px 0 8px">Vérifie avant de créer une seconde piste.</p>
      <div class="list">${d.map((x) => `<div class="row"><div class="rm"><div class="rt">${esc(x.nom)}</div><div class="rs">${esc([lab(x.etape), lab(x.issue), x.raison].filter(Boolean).join(" · "))}</div></div>
        <div class="rr"><a class="btn sm" href="#/pistes/${x.id}">Ouvrir</a></div></div>`).join("")}</div>
      ${o.force ? `<p class="small" style="margin-top:8px">Aucune ne convient : <button class="btn sm" type="button" data-npact="force" ${dis}>Créer quand même</button></p>` : ""}</div>` : "";
  const pers = f.contacts.filter((id) => { const c = (o.contactsList || []).find((x) => x.id === id); return c && (c.type === "Personne" || !c.type); });
  swapHTML(drawerHost, `
    <div class="dh"><span class="ifmt">${ic("target")}</span><div style="flex:1;min-width:0"><h1>Nouvelle piste</h1>
      <div class="sub">Créée dans la base Pistes/Opportunités de Notion${o.contact ? `, rattachée à <a href="#/contacts/${o.contact}">${esc(cName(o, o.contact))}</a>` : ""}</div></div></div>
    ${o.err ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.err)}</span></div>` : ""}
    ${!sc ? `<p class="empty">${o.err ? "" : "Chargement des champs…"}</p>` : `<form class="form" id="np-form" onsubmit="return false">
      <div class="fld wide"><label for="np-n">Nom</label><input id="np-n" data-np="nom" value="${esc(f.nom)}" required autocomplete="off" placeholder="Structure ou personne, sujet" ${dis}></div>
      <div class="fld"><label for="np-st">Étape${og("pistes", "Status")}</label><select class="sel" id="np-st" data-np="etape" ${dis}>${opt(sc.etapes, f.etape)}</select></div>
      <div class="fld"><label for="np-prio">Priorité${og("pistes", "Prio")}</label><select class="sel" id="np-prio" data-np="prio" ${dis}>${opt(sc.editable?.Prio?.options, f.prio, "Non renseignée")}</select></div>
      <div class="fld"><label for="np-tag">Origine${og("pistes", "Tags")}</label><select class="sel" id="np-tag" data-np="tag" ${dis}>${opt(sc.origines, f.tag, "Non renseignée")}</select></div>
      <div class="fld wide"><span class="lb">Contacts${og("pistes", "👱‍♀️ Contacts")}</span>${jetonsHTML({
        id: "np-c", label: "Contacts de la nouvelle piste", placeholder: "Ajouter un contact", busy: o.busy,
        items: f.contacts.map((id) => ({ id, nom: cName(o, id), href: `#/contacts/${id}` })),
        choices: (o.contactsList || []).map((c) => ({ id: c.id, nom: String(c.nom).trim(), sub: c.type && c.type !== "Personne" ? c.type : "" })),
        onAdd: (id) => { if (f.contacts.length < 10 && !f.contacts.includes(id)) f.contacts.push(id); renderDrawer(); watchPisteDoublons(o); },
        onRemove: (id) => { f.contacts = f.contacts.filter((x) => x !== id); renderDrawer(); watchPisteDoublons(o); },
      })}</div>
      <div class="fld wide"><span class="lb">Projet${og("pistes", "Projets")}</span>${jetonsHTML({
        id: "np-pj", label: "Projet de la nouvelle piste", placeholder: "Rattacher à un projet (facultatif)", busy: o.busy,
        items: f.projets.map((id) => ({ id, nom: pName(o, id), href: `#/projets/${id}`, icon: "folder", cls: "pj" })),
        choices: (o.projets || []).filter((p) => p.etat !== "Annulé" && p.etat !== "Terminé").map((p) => ({ id: p.id, nom: p.nom, sub: p.etat === "Prospect" ? "prospect" : "" })),
        onAdd: (id) => { if (f.projets.length < 5 && !f.projets.includes(id)) f.projets.push(id); renderDrawer(); },
        onRemove: (id) => { f.projets = f.projets.filter((x) => x !== id); renderDrawer(); },
      })}</div>
      <div class="fld"><label for="np-a">Première action (facultatif)</label><input id="np-a" data-np="action" value="${esc(f.action)}" autocomplete="off" placeholder="Appeler, envoyer une proposition…" ${dis}></div>
      <div class="fld"><label for="np-e">Échéance</label><input id="np-e" type="date" data-np="ech" value="${esc(f.ech)}" ${dis}></div>
      <p class="small muted wide" style="margin-top:-4px">La première action est créée comme tâche TO DO liée à la piste : elle devient sa prochaine action.</p>
      ${pers.length ? `<label class="chk-l wide"><input type="checkbox" data-np="parcours" ${f.parcours ? "checked" : ""} ${dis}>Passer ${pers.length > 1 ? "ces personnes" : esc(cName(o, pers[0]))} à « Opportunité créée » dans le parcours réseau (si ${pers.length > 1 ? "elles le suivent" : "elle le suit"})</label>` : ""}
      ${dbl}
      <div class="mfoot wide"><a class="btn sm" href="${o.contact ? `#/contacts/${o.contact}` : "#/pistes"}">Annuler</a><button class="btn sm pri" type="button" data-npact="create" ${dis}>${o.busy ? "Création dans Notion…" : "Créer la piste"}</button></div></form>
      <p class="small muted" style="margin-top:10px">Piste créée « en cours », nature « Piste ». Seules les propriétés et options existantes de Notion sont utilisées. Les pistes proches (nom, ou piste ouverte avec le même contact) sont cherchées pendant la saisie.</p>`}`);
}

let npTimer = null;
function watchPisteDoublons(o, delay = 350) {
  clearTimeout(npTimer);
  npTimer = setTimeout(async () => {
    const nom = o.f.nom.trim(), cs = [...o.f.contacts];
    if (nom.length < 3 && !cs.length) { o.doublons = null; renderDrawer(); return; }
    try {
      const r = await pistesApi.doublons(nom, cs);
      if (S.open === o && o.f.nom.trim() === nom && o.f.contacts.join() === cs.join()) { o.doublons = r.doublons || []; o.force = false; renderDrawer(); }
    } catch { /* recherche indisponible : la création la refera */ }
  }, delay);
}

async function createPiste(o, force) {
  const f = o.f;
  if (!f.nom.trim()) { o.err = "Donne un nom à la piste."; renderDrawer(); return; }
  if (f.ech && !f.action.trim()) { o.err = "Donne un intitulé à la première action, ou retire l'échéance."; renderDrawer(); return; }
  const values = { "Nom": f.nom.trim(), "Status": f.etape || undefined, ...(f.prio ? { "Prio": f.prio } : {}), ...(f.tag ? { "Tags": [f.tag] } : {}),
    "👱‍♀️ Contacts": f.contacts, "Projets": f.projets };
  o.busy = true; o.err = null; renderDrawer();
  let r;
  try { r = await pistesApi.create(values, { confirmerDoublon: force, parcours: f.parcours }); }
  catch (e) {
    o.busy = false;
    if (e.code === "doublon") { o.doublons = e.details?.doublons || o.doublons || []; o.force = true; o.err = e.message; }
    else o.err = e.message;
    renderDrawer(); return;
  }
  const id = r.piste.id, msgs = [`Piste « ${r.piste.nom} » créée dans Notion.`];
  if (r.parcours?.length) msgs.push(`${r.parcours.map((x) => x.nom).join(", ")} : parcours passé à « Opportunité créée ».`);
  if (r.parcoursErreur) msgs.push(r.parcoursErreur);
  if (f.action.trim()) {
    try { await todoApi.create({ "Nom": f.action.trim(), ...(f.ech ? { "Échéance": f.ech } : {}), "Pistes/Opportunités": [id], ...(f.contacts.length ? { "👱‍♀️ Contacts": f.contacts.slice(0, 1) } : {}) }); msgs.push("Première action créée dans TO DO."); }
    catch (e) { msgs.push(`La première action n'a pas pu être créée : ${e.message} Planifie-la depuis la fiche.`); }
  }
  toast(msgs.join(" "), r.parcoursErreur ? "err" : "");
  invalidateReseau(); refreshContacts(); invalidateACreer();
  load(true);
  location.hash = `#/pistes/${id}`;
}

function gagneBox(o, p) {
  const busy = S.busy.has("gagne");
  return `<div class="banner info pi-win">${ic("win", "ic-sm")}<div style="flex:1;min-width:0"><b>Marquer « ${esc(p.nom)} » gagnée.</b> L'étape et l'issue passent à Gagné dans Notion ; la probabilité passe alors à 100 % (formule Notion).
    <p class="small" style="margin-top:6px">Jours vendus et période : <b>indisponible</b>, ces propriétés n'existent pas dans la base Pistes. Le CA réel se saisit dans Notion.</p>
    <div class="dact" style="margin-top:8px"><button class="btn sm pri" data-piact="gagne-ok" ${busy ? "disabled" : ""}>${busy ? "Enregistrement…" : "Confirmer dans Notion"}</button><button class="btn sm" data-piact="gagne-non">Annuler</button></div></div></div>`;
}

/**
 * Bande de propriétés de la piste (fiches compactes, 27/11/2026). Étape, issue et priorité se modifient sur place
 * (data-piprop, même écriture que l'onglet Suivi). La prochaine action reste la tâche TO DO liée (règle du 26/11),
 * affichée en chip calculée. La pondération (formules Notion) tient en une chip qui ouvre Repères.
 */
function band(o, p) {
  const ed = o.editable || {}, ready = !!(o.values && !p.partial);
  const can = (k) => ready && !!ed[k];
  const busy = (k) => S.busy.has("f:" + k);
  const opts = (k, empty) => ppOpts([...(empty ? [["", empty]] : []), ...(ed[k]?.options || []).map((x) => [x, lab(x) || x])], o.values?.[k] ?? "");
  const n = starsN(p.prio);
  const prioShown = n == null ? "+ Priorité" : n === 0 ? "Froide" : "★".repeat(n) + "☆".repeat(3 - n);
  const last = p.dernierContact || p.echanges?.[0]?.date || p.derniereInteraction;
  const nx = p.prochaine;
  const nxLate = nx?.echeance && nx.echeance.slice(0, 10) < today();
  const opp = /Opportunit/.test(p.leadOpportunite || "");
  const chips = [
    can("Status") ? ppSel(`data-piprop="Status"`, opts("Status"), p.etape ? `<i class="dot" style="background:${stCol(p.etape)}"></i>${esc(lab(p.etape))}` : "+ Étape", "Étape de la piste", p.etape ? "" : "pp-add dash", busy("Status")) : stChip(p.etape).replace('class="chip', 'class="chip pp'),
    can("Gagné/Perdu") ? ppSel(`data-piprop="Gagné/Perdu"`, opts("Gagné/Perdu"), p.issue ? esc(lab(p.issue)) : "+ Issue", "Issue", p.issue ? ISS_CL[lab(p.issue)] ?? "" : "pp-add dash", busy("Gagné/Perdu")) : issChip(p.issue, true).replace('class="chip', 'class="chip pp'),
    can("Prio") ? ppSel(`data-piprop="Prio"`, opts("Prio", "Non définie"), prioShown, "Priorité", n == null ? "pp-add dash" : "pp-stars", busy("Prio")) : n != null ? ppTxt(prioShown, "pp-stars") : "",
    opp ? ppTxt("Opportunité", "st-relire") : "",
    !p.prochaineCalculee ? "" : nx ? ppLink(`#/todo/${nx.id}`, `${nxLate ? ic("alert", "ic-sm") : ic("flag", "ic-sm")}${nx.echeance ? esc(fd(nx.echeance)) : "Sans échéance"}`, `pp-calc dash ${nxLate ? "c-crit" : ""}`, `Prochaine action, tâche TO DO liée : ${nx.nom}`) : "",
    ppTxt(last ? `Dernier échange ${esc(ago(last))}` : "Aucun échange", "pp-calc dash", last ? `${fd(last)}, calculé depuis le journal` : "Calculé depuis le journal"),
    ppBtn(`data-pisec="reperes"`, `${esc(pct(p.probabilite))} · ${esc(j1(p.joursPonderes))} pondéré${p.joursPonderes > 1 ? "s" : ""}`, "pp-calc dash", "Pondération, formules Notion. Le détail est dans Repères"),
    ...p.projets.map((id) => ppLink(`#/projets/${id}`, `${ic("folder", "ic-sm")}${esc(p.projetsNoms?.[id] ?? S.pn[id] ?? "Projet")}`, "pj", "Ouvrir le projet")),
  ];
  return ppBand(chips);
}

function synthese(o, p, open) {
  const nx = p.prochaine;
  return `<h3 class="sh">Résumé</h3>${p.resume ? `<p class="rec">${esc(p.resume)}</p>` : `<p class="empty">Pas de résumé dans Notion.</p>`}
    ${!p.prochaineCalculee ? `<p class="small muted">Prochaine action non calculée, les tâches TO DO n'ont pas pu être lues.</p>`
      : nx ? nextLine("Prochaine action", `<a href="#/todo/${esc(nx.id)}">${esc(nx.nom)}</a>${nx.echeance ? due(nx.echeance) : `<span class="small muted">sans échéance</span>`}${p.autresTaches ? `<span class="small muted">et ${p.autresTaches} autre${p.autresTaches > 1 ? "s" : ""} tâche${p.autresTaches > 1 ? "s" : ""}</span>` : ""}`)
      : isActive(p) ? `<div class="banner dashed" style="margin-top:12px">${ic("alert", "ic-sm")}<span>Aucune action planifiée. Le bouton Planifier, en haut de la fiche, crée la tâche liée.</span></div>` : ""}
    ${noteLibre(p)}
    ${open.length ? `<h3 class="sh">À faire <button class="lnk" data-pisec="actions">${open.length}</button></h3><div class="list">${open.slice(0, 3).map((t) => taskRow(t, S.busy.has("t:" + t.id))).join("")}</div>` : ""}
    ${p.echanges ? `<h3 class="sh">Derniers échanges <button class="lnk" data-pisec="echanges">${p.echanges.length}</button></h3>${echanges(p, 3)}` : ""}
    ${saFold(p.syntheseAgent)}`;
}

// « Prochaine action » et « Date prochaine action » ne se modifient plus ici (26/11/2026) : la prochaine
// action est la tâche TO DO liée, créée par « Planifier ». Le texte de Notion reste affiché en note libre.
const FIELDS = [["Status", "Étape"], ["Gagné/Perdu", "Issue"], ["Prio", "Priorité"], ["Taille", "Taille"], ["Date de signature prévue", "Date de signature prévue"]];

function suivi(o, p) {
  if (!o.values) return `<p class="empty">Chargement des champs…</p>`;
  const ed = o.editable || {};
  const fld = ([name, label]) => {
    const def = ed[name]; if (!def) return `<div class="fld"><label>${esc(label)}</label><p class="small muted">Propriété absente de Notion, indisponible.</p></div>`;
    const id = "pi-" + nrm(name).replace(/[^a-z0-9]+/g, "-"), v = o.values[name] ?? "", saving = S.busy.has("f:" + name);
    const attrs = `id="${id}" data-piprop="${esc(name)}" ${saving ? "disabled" : ""}`;
    let input;
    if (def.options) input = `<select ${attrs}><option value="">Non renseigné</option>${def.options.map((x) => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(lab(x) || x)}</option>`).join("")}</select>`;
    else if (def.type === "date") input = `<input type="date" ${attrs} value="${esc(String(v).slice(0, 10))}">`;
    else input = `<textarea ${attrs} rows="2" placeholder="Appeler, envoyer la proposition, proposer un café…">${esc(v)}</textarea>`;
    return `<div class="fld ${def.type === "rich_text" ? "wide" : ""}"><label for="${id}">${esc(label)}${og("pistes", name)} <span class="fstate">${saving ? "Enregistrement…" : ""}</span></label>${input}</div>`;
  };
  return `<form class="form" onsubmit="return false">${FIELDS.map(fld).join("")}</form>
    <h3 class="sh">Prochaine action${og("pistes", "prochaine")}</h3>
    ${p.prochaine ? `<p><a href="#/todo/${esc(p.prochaine.id)}">${esc(p.prochaine.nom)}</a> ${nxDue(p)}${autres(p)}</p>` : `<p class="nx-none">Aucune action planifiée</p>`}
    ${planForm(p.id, S.busy.has("plan:" + p.id), "ps")}
    ${noteLibre(p)}
    <p class="small muted" style="margin-top:10px">Chaque champ est écrit dans Notion dès qu'il change. Les jours estimés, la probabilité et les jours pondérés se recalculent dans Notion. Mes notes se modifient dans le panneau de droite. CA et résumé se modifient dans Notion.</p>`;
}

function echanges(p, n) {
  if (p.echanges == null) return `<p class="empty">Échanges non lus : le miroir du journal n'est pas prêt.</p>`;
  const list = p.echanges.slice(0, n);
  return list.length ? `<div class="list">${list.map((e) => `<a class="row" href="${esc(e.url)}" target="_blank" rel="noopener">${fmtIcon(e.format)}<div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(fd(e.date))}${e.format ? " · " + esc(lab(e.format)) : ""}</div></div>${ic("ext", "ic-sm")}</a>`).join("")}</div>` : `<p class="empty">Aucun échange au journal.</p>`;
}

function contacts(o, p) {
  const busy = S.busy.has("f:👱‍♀️ Contacts"), locked = p.contactsMore;
  const nom = (id) => p.contactsNoms?.[id] ?? (o.contactsList || []).find((c) => c.id === id)?.nom ?? "Contact illisible";
  return `<p class="small muted" style="margin:0 0 8px">Contacts de la piste${og("pistes", "👱‍♀️ Contacts")}</p>
    ${jetonsHTML({
      id: "pi-addc", label: "Contacts de la piste", placeholder: "Rattacher un contact existant (nom)", busy, locked,
      items: p.contacts.map((id) => ({ id, nom: nom(id), href: `#/contacts/${id}` })),
      choices: (o.contactsList || []).map((c) => ({ id: c.id, nom: String(c.nom).trim() })),
      onAdd: (id) => relContact(o.id, "add", id), onRemove: (id) => relContact(o.id, "remove", id),
    })}
    ${locked ? `<p class="small muted">Trop de contacts pour être modifiés ici, passe par Notion.</p>` : `<p class="small muted" style="margin-top:6px">Chaque ajout ou retrait part tout de suite dans Notion. Une erreur ? La croix retire le lien, et « Annuler » le remet.</p>
      <div class="dact" style="margin-top:10px"><a class="btn sm" href="#/contacts/new/piste/${p.id}">${ic("plus", "ic-sm")}Créer et rattacher</a><span class="small muted">Nouveau contact dans Notion, rattaché aussitôt à cette piste.</span></div>`}`;
}

/** Ajout ou retrait d'un contact de la piste, enregistré aussitôt, avec « Annuler » pendant 6 secondes. */
function relContact(pid, op, cid, undoable = true) {
  const o = S.open;
  const n = String(o?.p?.contactsNoms?.[cid] ?? (o?.contactsList || []).find((c) => c.id === cid)?.nom ?? "Contact").trim();
  return withBusy("f:👱‍♀️ Contacts", async () => {
    await update(pid, { "👱‍♀️ Contacts": { [op]: [cid] } }, undoable ? null : op === "add" ? `${n} remis sur la piste.` : `${n} retiré de nouveau.`);
    if (undoable) toastUndo(op === "add" ? `${n} rattaché à la piste dans Notion.` : `${n} retiré de la piste dans Notion.`, () => relContact(pid, op === "add" ? "remove" : "add", cid, false));
  });
}

// Pondération (formules Notion), sortie de la Synthèse le 27/11/2026. La taille se modifie ici.
function ponderation(p) {
  const o = S.open, ed = o?.editable || {}, def = ed["Taille"], busy = S.busy.has("f:Taille");
  const taille = def && o.values ? `<select class="sel" id="pi-taille" data-piprop="Taille" ${busy ? "disabled" : ""} aria-label="Taille">${ppOpts([["", "Non choisie"], ...def.options.map((x) => [x, lab(x) || x])], o.values["Taille"] ?? "")}</select>` : `<b>${p.taille ? esc(p.taille) : "Non choisie"}</b>`;
  return `<h3 class="sh" style="margin-top:0">Pondération <span class="small muted" style="font-weight:400">formules Notion</span></h3>
    <dl class="kv">
      <dt>Taille</dt><dd>${taille} <span class="small muted">S 1 j, M 5 j, L 14 j</span></dd>
      <dt>Jours estimés</dt><dd>${j1(p.joursEstimes)} <span class="small muted">${p.caEstime ? `CA estimé ${eur(p.caEstime)} ÷ 650 €` : p.taille ? `taille ${esc(p.taille)}` : "ni taille ni CA estimé"}</span></dd>
      <dt>Probabilité</dt><dd>${pct(p.probabilite)} <span class="small muted">selon l'étape et l'issue</span></dd>
      <dt>Jours pondérés</dt><dd>${j1(p.joursPonderes)} <span class="small muted">${p.dateSignature ? `signature prévue ${esc(fd(p.dateSignature))}` : "date de signature prévue absente"}</span></dd>
    </dl>
    <h3 class="sh">Repères</h3>`;
}

function reperes(p) {
  const rows = [], miss = [];
  const line = (l, v, k) => rows.push(`<dt>${l}${k ? og("pistes", k) : ""}</dt><dd>${v}</dd>`);
  if (p.caEstime != null) line("CA estimé", eur(p.caEstime), "CA estimé "); else miss.push("CA estimé");
  if (p.caReel != null) line("CA réel", eur(p.caReel), "CA réel"); else miss.push("CA réel");
  if (p.tags.length) line("Origine", p.tags.map((t) => esc(lab(t))).join(", "), "Tags"); else miss.push("origine (Tags)");
  if (p.dateSignature) line("Signature prévue", esc(fd(p.dateSignature)), "Date de signature prévue"); else miss.push("date de signature prévue");
  if (p.derniereInteraction) line("Dernière interaction", `${esc(fd(p.derniereInteraction))} <span class="small muted">(tenue par l'agent)</span>`, "Dernière interaction"); else miss.push("dernière interaction");
  line("Lead ou opportunité", p.leadOpportunite ? esc(lab(p.leadOpportunite)) : "Non renseigné", "Lead→Opportunité");
  line("Responsable", p.responsables?.length ? p.responsables.map(esc).join(", ") : `Jean-Baptiste <span class="small muted">(champ vide, valeur par défaut)</span>`, "Responsable");
  if (p.projets.length) line("Projet", `<div class="chips">${p.projets.map((id) => `<a class="chip pj" href="#/projets/${id}">${ic("folder", "ic-sm")}${esc(p.projetsNoms?.[id] ?? "Projet")}</a>`).join("")}</div>`, "Projets"); else miss.push("projet");
  if (p.idOdoo) line("ID Odoo", esc(p.idOdoo), "ID Odoo");
  if (p.derniereSession) line("Dernière session de l'agent", esc(new Date(p.derniereSession).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })), "Dernière session");
  line("Créée le", esc(fd(p.cree)), "Date de création");
  return `${ponderation(p)}<dl class="kv">${rows.join("")}</dl>${miss.length ? `<p class="nr">Non renseigné dans Notion : ${miss.join(", ")}.</p>` : ""}`;
}

const taskRow = (t, busy) => { const d = isDone(t); return `<div class="arow ${d ? "done" : ""}">
  <button class="chk ${d ? "done" : ""}" data-pitdone="${t.id}" ${busy ? "disabled" : ""} aria-label="${d ? "Rouvrir la tâche" : "Marquer comme terminée"}">${d ? ic("check", "ic-sm") : ""}</button>
  <a class="am" href="#/todo/${t.id}"><div class="an">${esc(t.nom)}</div><div class="ameta">${!d && t.prio ? chip(t.prio, t.prio === "P1" ? "red" : "") : ""}${etatChip(t.etat, d)}${taSpan(t.typeAction)}</div></a>
  ${d ? "" : due(t.echeance)}</div>`; };

// ---------------- Événements ----------------

export function bindPistesEvents(root) {
  root.addEventListener("click", (e) => {
    if (!host || !root.contains(host)) return;
    const f = e.target.closest("[data-pif]");
    if (f) { const [k, ...v] = f.dataset.pif.split(":"); S.f[k] = v.join(":"); render(); return; }
    const en = e.target.closest("[data-pient]");
    if (en) { const [st, o] = en.dataset.pient.split("|"); Object.assign(S.f, { mode: "liste", st, src: o, vue: S.f.ent === "actives" ? "actives" : "toutes" }); render(); }
  });
  root.addEventListener("input", (e) => { if (e.target.id === "pi-q") { S.f.q = e.target.value; render(); } });
  root.addEventListener("change", (e) => {
    const s = e.target.dataset?.pisel;
    if (s) { S.f[s] = e.target.value; render(); return; }
  });
  root.addEventListener("click", (e) => { const b = e.target.closest?.("[data-plgo]"); if (b && host && host.contains(b)) planifier(b); });
  // Glisser-déposer du tableau (souris, ordinateur) : changement d'étape.
  let dragId = null;
  root.addEventListener("dragstart", (e) => { const c = e.target.closest?.("[data-pidrag]"); if (!c) return; dragId = c.dataset.pidrag; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
  root.addEventListener("dragend", (e) => { e.target.closest?.("[data-pidrag]")?.classList.remove("dragging"); root.querySelectorAll(".col.over").forEach((c) => c.classList.remove("over")); dragId = null; });
  root.addEventListener("dragover", (e) => { const col = e.target.closest?.("[data-pidrop]"); if (!col || !dragId) return; e.preventDefault(); root.querySelectorAll(".col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); });
  root.addEventListener("drop", (e) => {
    const col = e.target.closest?.("[data-pidrop]"); if (!col || !dragId) return;
    e.preventDefault(); col.classList.remove("over");
    const id = dragId, st = col.dataset.pidrop; dragId = null;
    const p = byId(id); if (!p || p.etape === st) return;
    p.etape = st; render(); // affichage immédiat, remis à la valeur de Notion en cas de refus
    withBusy(id, () => update(id, { "Status": st }, `Étape : ${lab(st)}.`).catch((err) => { load(true); throw err; }));
  });
}

export function bindPistesDrawerEvents(root) {
  // Nouvelle piste : champs lus à la saisie, pistes proches cherchées quand le nom change.
  const newOpen = () => ownsDrawer("pistes") && S.open?.isNew ? S.open : null;
  root.addEventListener("input", (e) => {
    const o = newOpen(), k = e.target.dataset?.np; if (!o || !k || k === "parcours") return;
    o.f[k] = e.target.value;
    if (k === "nom") watchPisteDoublons(o);
  });
  root.addEventListener("change", (e) => {
    const o = newOpen(), k = e.target.dataset?.np; if (!o || !k) return;
    o.f[k] = k === "parcours" ? e.target.checked : e.target.value;
  });
  root.addEventListener("click", (e) => {
    const o = newOpen(); if (!o) return;
    const a = e.target.closest("[data-npact]")?.dataset.npact;
    if (a === "create" || a === "force") createPiste(o, a === "force");
  });
  root.addEventListener("keydown", (e) => {
    const o = newOpen(); if (!o || e.key !== "Enter" || !e.target.dataset?.np || e.target.tagName !== "INPUT" || e.target.type === "checkbox") return;
    e.preventDefault(); createPiste(o, false);
  });
  root.addEventListener("click", (e) => {
    if (!ownsDrawer("pistes") || !S.open || S.open.isNew) return;
    const o = S.open;
    const sec = e.target.closest("[data-pisec]");
    if (sec) { o.sec = sec.dataset.pisec; if (o.sec === "contacts") loadContacts(); renderDrawer(); root.scrollTop = 0; return; }
    const a = e.target.closest("[data-piact]")?.dataset.piact;
    if (a === "gagne") { o.gagne = true; renderDrawer(); return; }
    if (a === "plan") { o.plan = true; renderDrawer(); setTimeout(() => drawerHost?.querySelector(`#pf-n-${CSS.escape(o.id)}`)?.focus(), 0); return; }
    if (a === "plan-non") { o.plan = false; renderDrawer(); return; }
    const pg = e.target.closest("[data-plgo]");
    if (pg) { planifier(pg); return; }
    if (a === "gagne-non") { o.gagne = false; renderDrawer(); return; }
    if (a === "gagne-ok") {
      const ch = optionChanges({ "Status": "Gagné", "Gagné/Perdu": "Gagné" });
      if (!ch) return;
      withBusy("gagne", () => update(o.id, ch, "Piste gagnée, enregistrée dans Notion.").then(() => { o.gagne = false; }));
      return;
    }
    if (a === "perdu") {
      if (!confirm(`Marquer la piste « ${o.p.nom} » perdue ?`)) return;
      const ch = optionChanges({ "Gagné/Perdu": "Perdu" }); if (ch) withBusy("gagne", () => update(o.id, ch, "Piste marquée perdue."));
      return;
    }
    if (a === "rouvrir") { const ch = optionChanges({ "Gagné/Perdu": "En cours" }); if (ch) withBusy("gagne", () => update(o.id, ch, "Piste rouverte.")); return; }
    const td = e.target.closest("[data-pitdone]");
    if (td) { e.preventDefault(); toggleTask(td.dataset.pitdone); }
  });
  root.addEventListener("change", (e) => {
    if (!ownsDrawer("pistes") || !S.open?.values) return;
    const el = e.target, prop = el.dataset?.piprop;
    if (prop) {
      const v = el.value.trim();
      if (String(S.open.values[prop] ?? "").slice(0, 10) === v.slice(0, 10) && (S.open.editable?.[prop]?.type === "date" || String(S.open.values[prop] ?? "") === v)) return;
      withBusy("f:" + prop, () => update(S.open.id, { [prop]: v || null }, "Enregistré dans Notion."));
      return;
    }
  });
}

/**
 * « Planifier » (26/11/2026) : crée une tâche TO DO liée à la piste (intitulé, échéance), au lieu de modifier
 * le texte libre de Notion. La piste et la synthèse sont relues ensuite (prochaine action recalculée).
 */
function planifier(btn) {
  const id = btn.dataset.plgo, f = btn.closest("[data-plform]");
  const nom = f?.querySelector("[data-pln]")?.value.trim() || "", ech = f?.querySelector("[data-pld]")?.value || "";
  if (!nom) { toast("Donne un intitulé à la prochaine action.", "err"); f?.querySelector("[data-pln]")?.focus(); return; }
  withBusy("plan:" + id, async () => {
    await todoApi.create({ Nom: nom, "État": "A faire", ...(ech ? { "Échéance": ech } : {}), "Pistes/Opportunités": [id] });
    toast(`Tâche créée dans TO DO${ech ? ` pour le ${fd(ech)}` : ""}, liée à la piste.`);
    if (S.open?.id === id) { S.open.plan = false; await reloadOpen(id); }
    await load(true);
  });
}

/** Relit la fiche ouverte (tâches et prochaine action). */
async function reloadOpen(id) {
  try { const r = await pistesApi.get(id); if (S.open?.id === id) { S.open.p = r.piste; S.open.values = r.values; S.open.editable = r.editable; S.open.synchro = syncOf(r); } } catch { /* fiche relue à la prochaine ouverture */ }
}

setNoteSaver("pistes", async (prop, value, before) => {
  const o = S.open;
  if (!o) return;
  try {
    await update(o.id, { [prop]: value || null }, "Notes enregistrées dans Notion.", { [prop]: before });
    if (S.open === o) o.savedNote = prop;
  } catch (e) {
    if (e.code === "conflit" || e.code === "mise_en_forme") { toast(e.message, "err"); openPiste(o.id); return; }
    throw e;
  }
  renderDrawer();
});

/** Options Notion exactes (avec leur emoji) à partir des libellés. Null si une option manque. */
function optionChanges(wanted) {
  const ed = S.open?.editable || {}, out = {};
  for (const [prop, l] of Object.entries(wanted)) {
    const opt = (ed[prop]?.options || []).find((x) => lab(x) === l);
    if (!opt) { toast(`L'option « ${l} » de « ${prop} » est absente de Notion : geste indisponible.`, "err"); return null; }
    out[prop] = opt;
  }
  return out;
}

async function loadContacts() {
  const o = S.open; if (!o || o.contactsList) return;
  try { o.contactsList = await contactIndex(); renderDrawer(); } catch { /* liste indisponible : saisie impossible, affichée vide */ }
}

async function toggleTask(id) {
  const o = S.open; const t = o?.done.get(id) || o?.p?.taches?.find((x) => x.id === id);
  if (!t) return;
  await withBusy("t:" + id, async () => { const r = await setTaskEtat(id, isDone(t) ? "A faire" : "Terminé"); o.done.set(id, { ...t, etat: r.etat }); });
}

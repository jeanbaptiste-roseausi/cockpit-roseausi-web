// Vue « Prospection » (lot 2) : pilotage (entonnoir par étape et par origine, relances dues, pistes sans
// prochaine action, effort commercial 2027), tableau par étape avec glisser-déposer, liste, et fiche piste
// plein écran. Les chiffres viennent de la fonction pistes : la pondération est celle des formules Notion.
import { pistesApi } from "./api.js";
import { contactIndex } from "./contacts.js";
import { setTaskEtat } from "./todo.js";
import { $, esc, ic, nrm, fd, due, toast, setDrawerOwner, ownsDrawer, etatChip, isDone, ficheTop, renderSide, sideHTML, ficheTabs, fmtIcon, taSpan, chip, syncOf, syncSpan, staleBanner, initials } from "./ui.js";

const S = {
  items: null, etapes: [], origines: [], issues: [], synthese: null, regles: null, pn: {}, cn: {},
  loading: false, error: null, synchro: null,
  f: { mode: "pilotage", vue: "actives", prio: "", src: "", q: "", st: "", ent: "actives" },
  open: null, busy: new Set(),
};
let host = null, drawerHost = null;

export const pistesView = {
  id: "pistes",
  label: "Prospection",
  short: "Pistes",
  icon: "target",
  async mount(container, drawer) {
    host = container; drawerHost = drawer;
    render();
    if (!S.items) await load();
  },
  open: openPiste,
  close: () => { S.open = null; },
  reload: () => load(),
};

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
    if (q && !nrm([p.nom, p.prochaineAction, ...p.contacts.map((id) => S.cn[id] || "")].join(" ")).includes(q)) return false;
    return true;
  }).sort((a, b) => (starsN(b.prio) ?? -1) - (starsN(a.prio) ?? -1) || String(a.dateProchaineAction || "9").localeCompare(String(b.dateProchaineAction || "9")));
}

function render() {
  if (!host) return;
  const f = S.f;
  const seg = (key, val, lbl) => `<button class="${f[key] === val ? "on" : ""}" data-pif="${key}:${val}">${lbl}</button>`;
  const filters = f.mode === "pilotage" ? "" : `<div class="seg" role="group" aria-label="Pistes">${seg("vue", "actives", "Actives")}${seg("vue", "gagnees", "Gagnées")}${seg("vue", "partenaires", "Partenaires")}${seg("vue", "pause", "En pause")}${seg("vue", "toutes", "Toutes")}</div>
    <label class="sr" for="pi-prio">Priorité</label><select class="sel" id="pi-prio" data-pisel="prio"><option value="">Toutes priorités</option>${[3, 2, 1, 0].map((n) => `<option value="${n}" ${f.prio === String(n) ? "selected" : ""}>${n ? "★".repeat(n) : "Froide"}</option>`).join("")}</select>
    <label class="sr" for="pi-src">Origine</label><select class="sel" id="pi-src" data-pisel="src"><option value="">Toutes origines</option>${S.origines.map((t) => `<option value="${esc(t)}" ${f.src === t ? "selected" : ""}>${esc(lab(t))}</option>`).join("")}</select>
    <label class="sr" for="pi-q">Filtrer les pistes</label><input class="inp grow" id="pi-q" type="search" placeholder="Filtrer par nom, contact, action…" value="${esc(f.q)}" autocomplete="off">`;
  const head = `<div class="bar"><div class="seg" role="group" aria-label="Affichage">${seg("mode", "pilotage", ic("layers", "ic-sm") + " Pilotage")}${seg("mode", "tableau", ic("board", "ic-sm") + " Tableau")}${seg("mode", "liste", ic("list", "ic-sm") + " Liste")}</div>${filters}</div>`;
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
  const busy = S.busy.has(p.id);
  return `<div class="row pi-row"><a class="rm" href="#/pistes/${p.id}"><div class="rt">${esc(p.nom)}</div>
    ${p.prochaineAction ? `<div class="rs clamp2">${esc(p.prochaineAction)}</div>` : ""}
    <div class="chips" style="margin-top:6px">${stChip(p.etape)}${issChip(p.issue)}${p.tags.slice(0, 1).map((t) => `<span class="chip">${esc(lab(t))}</span>`).join("")}</div></a>
    <div class="rr">${plan ? `<label class="pi-plan"><span class="small muted">Prochaine action le</span><input type="date" data-piplan="${p.id}" ${busy ? "disabled" : ""} aria-label="Date de la prochaine action pour ${esc(p.nom)}"></label>` : due(p.dateProchaineAction)}${stars(p.prio)}</div></div>`;
}

function pilotage() {
  const sy = S.synthese, e = sy.effort;
  const rel = sy.relancesDues.map(byId).filter(Boolean), sans = sy.sansProchaineAction.map(byId).filter(Boolean);
  const pond = e.joursPonderes + e.joursPonderesSansDate + e.joursPonderesAutreAnnee;
  return syncLine(` ${esc(S.regles?.ponderation || "")}`) + `
  <div class="kpis">
    <div class="kpi"><b>${sy.actives}</b><span>Pistes actives</span><small>sur ${sy.total} pistes</small></div>
    <div class="kpi ${rel.length ? "alert" : ""}"><b>${rel.length}</b><span>Relances dues</span><small>date passée ou du jour</small></div>
    <div class="kpi ${sans.length ? "alert" : ""}"><b>${sans.length}</b><span>Sans prochaine action</span><small>pistes actives sans date</small></div>
    <div class="kpi"><b>${j1(pond).replace(" j", "")}<small> j</small></b><span>Jours pondérés</span><small>pipe ouvert, formule Notion</small></div>
  </div>
  <div class="grid2 pi-top">${entonnoir()}${effort(e)}</div>
  <div class="grid2">
    <section class="card"><div class="card-h"><h2>Relances dues</h2><span class="count">${rel.length}</span></div>
      <p class="small muted" style="margin-bottom:6px">${esc(S.regles.relance)}</p>
      <div class="list">${rel.map((p) => pisteRow(p)).join("") || `<p class="empty">Aucune relance due.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Pistes sans prochaine action</h2><span class="count">${sans.length}</span></div>
      <p class="small muted" style="margin-bottom:6px">${esc(S.regles.sansAction)} Choisis une date pour la planifier, l'action se précise dans la fiche.</p>
      <div class="list">${sans.map((p) => pisteRow(p, { plan: true })).join("") || `<p class="empty">Toutes les pistes actives ont une date de prochaine action.</p>`}</div></section>
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
    ${p.prochaineAction ? `<p class="pc-pa clamp2">${esc(p.prochaineAction)}</p>` : ""}
    <div class="pc-meta">${p.dateProchaineAction ? due(p.dateProchaineAction) : `<span class="chip dash">Sans date</span>`}${p.derniereInteraction ? `<span>Échange ${esc(ago(p.derniereInteraction))}</span>` : ""}${p.caEstime ? `<span class="num">${eur(p.caEstime)}</span>` : ""}${p.joursPonderes ? `<span class="num">${j1(p.joursPonderes)} pond.</span>` : ""}${avs(p.contacts)}</div>
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
async function update(id, changes, msg) {
  const r = await pistesApi.update(id, changes);
  if (S.items) { const i = S.items.findIndex((x) => x.id === id); if (i >= 0) S.items[i] = { ...S.items[i], ...pickList(r.piste) }; }
  if (S.open?.id === id) { S.open.p = r.piste; S.open.values = r.values; S.open.synchro = syncOf(r); }
  if (msg) toast(msg);
  load(true); // synthèse recalculée par la fonction
  return r;
}
const LIST_KEYS = ["nom", "etape", "issue", "prio", "taille", "tags", "leadOpportunite", "caEstime", "caReel", "joursEstimes", "probabilite", "joursPonderes", "prochaineAction", "dateProchaineAction", "dateSignature", "derniereInteraction", "contacts", "projets", "modifie"];
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
  S.open = { id, p: fromList ? { ...fromList, partial: true } : null, values: null, error: null, sec: "synthese", gagne: false, done: new Map() };
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
  const p = o.p;
  ficheTop({ kind: "Piste", url: p?.url || null, side: true });
  renderSide("pistes", sideHTML({ notes: [{ label: "Mes notes", text: p?.mesNotes }], notesHint: "Lues dans Notion, modifiables dans Notion", notesMissing: p && p.partial ? "Chargement…" : "" }));
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
      <button class="btn sm" data-pisec="suivi">${ic("flag", "ic-sm")}Planifier</button>
      <button class="btn sm" disabled title="Créer une tâche liée à une piste demande la relation Pistes dans la fonction todo (après le lot 1 bis)">${ic("todo", "ic-sm")}Action</button>
      <button class="btn sm" disabled title="Échanges au lot 6">${ic("plus", "ic-sm")}Échange</button></div>
      <span class="ifmt">${ic("target")}</span><div style="flex:1;min-width:0"><h1>${esc(p.nom)}</h1>
      <div class="chips" style="margin-top:8px">${stChip(p.etape)}${issChip(p.issue, true)}${/Opportunit/.test(p.leadOpportunite || "") ? `<span class="chip st-relire">Opportunité</span>` : `<span class="chip">Piste</span>`}${stars(p.prio)}${p.taille ? `<span class="chip">Taille ${esc(p.taille)}</span>` : ""}</div></div></div>
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    ${o.gagne ? gagneBox(o, p) : ""}
    ${ficheTabs(secs, cur, "data-pisec")}
    <section class="cbody" aria-label="${SECS[cur]}">${body}</section>
    <p class="small muted" style="margin-top:14px">${o.synchro ? syncSpan(o.synchro, true) : "Lu dans Notion"}. Fiche modifiée dans Notion le ${esc(new Date(p.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}.</p>`;
}

function gagneBox(o, p) {
  const busy = S.busy.has("gagne");
  return `<div class="banner info pi-win">${ic("win", "ic-sm")}<div style="flex:1;min-width:0"><b>Marquer « ${esc(p.nom)} » gagnée.</b> L'étape et l'issue passent à Gagné dans Notion ; la probabilité passe alors à 100 % (formule Notion).
    <p class="small" style="margin-top:6px">Jours vendus et période : <b>indisponible</b>, ces propriétés n'existent pas dans la base Pistes. Le CA réel se saisit dans Notion.</p>
    <div class="dact" style="margin-top:8px"><button class="btn sm pri" data-piact="gagne-ok" ${busy ? "disabled" : ""}>${busy ? "Enregistrement…" : "Confirmer dans Notion"}</button><button class="btn sm" data-piact="gagne-non">Annuler</button></div></div></div>`;
}

function synthese(o, p, open) {
  const last = p.echanges?.[0]?.date || p.derniereInteraction;
  return `<div class="sfacts">
      <div><span>Étape</span><b>${esc(lab(p.etape) || "Absente")}</b><small>${esc(lab(p.issue) || "Issue absente")}</small></div>
      <div><span>Dernier échange</span><b>${last ? esc(fd(last)) : "Aucun"}</b>${last ? `<small>${esc(ago(last))}</small>` : ""}</div>
      <div><span>Prochaine action</span><b>${p.prochaineAction ? esc(p.prochaineAction) : "Rien de prévu"}</b>${p.dateProchaineAction ? `<small>${due(p.dateProchaineAction)}</small>` : `<small><button class="lnk" data-pisec="suivi">Planifier</button></small>`}</div>
      <div><span>Priorité</span><b>${starsN(p.prio) == null ? "Non définie" : starsN(p.prio) === 0 ? "Froide" : "★".repeat(starsN(p.prio))}</b><small>${/Opportunit/.test(p.leadOpportunite || "") ? "Opportunité" : "Piste"}</small></div>
    </div>
    ${!p.dateProchaineAction && isActive(p) ? `<div class="banner dashed">${ic("alert", "ic-sm")}<span>Piste active sans date de prochaine action.</span><button class="btn sm" data-pisec="suivi">Planifier</button></div>` : ""}
    <h3 class="sh">Pondération <span class="small muted" style="font-weight:400">formules Notion</span></h3>
    <div class="sfacts">
      <div><span>Taille</span><b>${p.taille ? esc(p.taille) : "Non choisie"}</b><small>S 1 j, M 5 j, L 14 j</small></div>
      <div><span>Jours estimés</span><b>${j1(p.joursEstimes)}</b><small>${p.caEstime ? `CA estimé ${eur(p.caEstime)} ÷ 650 €` : p.taille ? `taille ${esc(p.taille)}` : "ni taille ni CA estimé"}</small></div>
      <div><span>Probabilité</span><b>${pct(p.probabilite)}</b><small>selon l'étape et l'issue</small></div>
      <div><span>Jours pondérés</span><b>${j1(p.joursPonderes)}</b><small>${p.dateSignature ? `signature prévue ${esc(fd(p.dateSignature))}` : "date de signature prévue absente"}</small></div>
    </div>
    ${p.resume ? `<h3 class="sh">Résumé</h3><p class="notes">${esc(p.resume)}</p>` : ""}
    ${p.syntheseAgent ? `<h3 class="sh">Synthèse agent</h3><p class="notes">${esc(p.syntheseAgent)}</p>` : ""}
    ${open.length ? `<h3 class="sh">À faire <button class="lnk" data-pisec="actions">${open.length}</button></h3><div class="list">${open.slice(0, 3).map((t) => taskRow(t, S.busy.has("t:" + t.id))).join("")}</div>` : ""}
    ${p.echanges ? `<h3 class="sh">Derniers échanges <button class="lnk" data-pisec="echanges">${p.echanges.length}</button></h3>${echanges(p, 3)}` : ""}
    ${p.projets.length ? `<h3 class="sh">Projet</h3><div class="chips">${p.projets.map((id) => `<a class="chip pj" href="#/projets/${id}">${ic("folder", "ic-sm")}${esc(p.projetsNoms?.[id] ?? S.pn[id] ?? "Projet")}</a>`).join("")}</div>` : ""}`;
}

const FIELDS = [["Status", "Étape"], ["Gagné/Perdu", "Issue"], ["Prio", "Priorité"], ["Taille", "Taille"], ["Date prochaine action", "Date de la prochaine action"], ["Prochaine action", "Prochaine action"], ["Date de signature prévue", "Date de signature prévue"]];

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
    return `<div class="fld ${def.type === "rich_text" ? "wide" : ""}"><label for="${id}">${esc(label)} <span class="fstate">${saving ? "Enregistrement…" : ""}</span></label>${input}</div>`;
  };
  return `<form class="form" onsubmit="return false">${FIELDS.map(fld).join("")}</form>
    <p class="small muted" style="margin-top:10px">Chaque champ est écrit dans Notion dès qu'il change. Les jours estimés, la probabilité et les jours pondérés se recalculent dans Notion. CA, résumé et notes se modifient dans Notion.</p>`;
}

function echanges(p, n) {
  if (p.echanges == null) return `<p class="empty">Échanges non lus : le miroir du journal n'est pas prêt.</p>`;
  const list = p.echanges.slice(0, n);
  return list.length ? `<div class="list">${list.map((e) => `<a class="row" href="${esc(e.url)}" target="_blank" rel="noopener">${fmtIcon(e.format)}<div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(fd(e.date))}${e.format ? " · " + esc(lab(e.format)) : ""}</div></div>${ic("ext", "ic-sm")}</a>`).join("")}</div>` : `<p class="empty">Aucun échange au journal.</p>`;
}

function contacts(o, p) {
  const busy = S.busy.has("f:👱‍♀️ Contacts"), locked = p.contactsMore;
  return `<div class="chips">${p.contacts.map((id) => { const n = p.contactsNoms?.[id]; return `<span class="chip pers"><a href="#/contacts/${id}">${esc(n ?? "Contact illisible")}</a>${locked ? "" : `<button class="x" data-pirm="${id}" aria-label="Retirer ${esc(n || "ce contact")}" ${busy ? "disabled" : ""}>×</button>`}</span>`; }).join("") || `<p class="empty">Aucun contact rattaché.</p>`}</div>
    ${locked ? `<p class="small muted">Trop de contacts pour être modifiés ici, passe par Notion.</p>` : `<div class="fld" style="margin-top:12px"><label for="pi-addc">Rattacher un contact</label><input class="inp" id="pi-addc" list="pi-cl" placeholder="Nom du contact" autocomplete="off" ${busy ? "disabled" : ""}><datalist id="pi-cl">${(o.contactsList || []).filter((c) => !p.contacts.includes(c.id)).map((c) => `<option value="${esc(String(c.nom).trim())}">`).join("")}</datalist></div>`}`;
}

function reperes(p) {
  const rows = [], miss = [];
  const line = (l, v) => rows.push(`<dt>${l}</dt><dd>${v}</dd>`);
  if (p.caEstime != null) line("CA estimé", eur(p.caEstime)); else miss.push("CA estimé");
  if (p.caReel != null) line("CA réel", eur(p.caReel)); else miss.push("CA réel");
  if (p.tags.length) line("Origine", p.tags.map((t) => esc(lab(t))).join(", ")); else miss.push("origine (Tags)");
  if (p.dateSignature) line("Signature prévue", esc(fd(p.dateSignature))); else miss.push("date de signature prévue");
  if (p.derniereInteraction) line("Dernière interaction", `${esc(fd(p.derniereInteraction))} <span class="small muted">(tenue par l'agent)</span>`); else miss.push("dernière interaction");
  line("Lead ou opportunité", p.leadOpportunite ? esc(lab(p.leadOpportunite)) : "Non renseigné");
  line("Responsable", p.responsables?.length ? p.responsables.map(esc).join(", ") : `Jean-Baptiste <span class="small muted">(champ vide, valeur par défaut)</span>`);
  if (p.projets.length) line("Projet", `<div class="chips">${p.projets.map((id) => `<a class="chip pj" href="#/projets/${id}">${ic("folder", "ic-sm")}${esc(p.projetsNoms?.[id] ?? "Projet")}</a>`).join("")}</div>`); else miss.push("projet");
  if (p.idOdoo) line("ID Odoo", esc(p.idOdoo));
  if (p.derniereSession) line("Dernière session de l'agent", esc(new Date(p.derniereSession).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })));
  line("Créée le", esc(fd(p.cree)));
  return `<dl class="kv">${rows.join("")}</dl>${miss.length ? `<p class="nr">Non renseigné dans Notion : ${miss.join(", ")}.</p>` : ""}`;
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
    const plan = e.target.dataset?.piplan;
    if (plan && e.target.value) { const v = e.target.value; withBusy(plan, () => update(plan, { "Date prochaine action": v }, `Prochaine action planifiée le ${fd(v)}.`)); }
  });
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
  root.addEventListener("click", (e) => {
    if (!ownsDrawer("pistes") || !S.open) return;
    const o = S.open;
    const sec = e.target.closest("[data-pisec]");
    if (sec) { o.sec = sec.dataset.pisec; if (o.sec === "contacts") loadContacts(); renderDrawer(); root.scrollTop = 0; return; }
    const a = e.target.closest("[data-piact]")?.dataset.piact;
    if (a === "gagne") { o.gagne = true; renderDrawer(); return; }
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
    const rm = e.target.closest("[data-pirm]");
    if (rm) { const id = rm.dataset.pirm; withBusy("f:👱‍♀️ Contacts", () => update(o.id, { "👱‍♀️ Contacts": { remove: [id] } }, "Contact retiré de la piste dans Notion.")); return; }
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
    if (el.id === "pi-addc" && el.value.trim()) {
      const c = (S.open.contactsList || []).find((x) => nrm(String(x.nom).trim()) === nrm(el.value.trim()));
      if (!c) { toast(`Contact « ${el.value} » introuvable parmi les contacts actifs.`, "err"); return; }
      withBusy("f:👱‍♀️ Contacts", () => update(S.open.id, { "👱‍♀️ Contacts": { add: [c.id] } }, "Contact rattaché à la piste dans Notion."));
    }
  });
}

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

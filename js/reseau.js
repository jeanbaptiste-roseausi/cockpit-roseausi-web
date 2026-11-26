// Vue « Réseau » (lot 2) : parcours des membres du réseau, carte des mises en lien
// (qui a recommandé qui, rattachements aux organisations et réseaux), création d'un contact recommandé,
// mise en lien de deux contacts. Lecture et écriture par la fonction reseau (base Contacts).
// Règle : Jean-Baptiste change lui-même les statuts ; rien ne les change d'office.
// 26/11/2026 : parcours en lignes par défaut, repris de l'artefact 1795698879-79f6 (vParcours, parcRow, parcGo) :
// frise des étapes en cours cliquable, sorties réussies et sorties, tri par étape ou par échéance, menu « ⋯ »,
// kanban toujours disponible, « Annuler » 6 secondes après chaque changement d'étape.
import { reseauApi } from "./api.js";
import { $, esc, ic, nrm, fd, toast, toastUndo, initials, syncOf, syncSpan, staleBanner } from "./ui.js";
import { modeDemande, modesSeg } from "./modes.js";

const S = {
  items: null, parcours: [], couleurs: {}, moi: null, parcoursDefaut: null, clientsLus: true,
  loading: false, error: null, synchro: null,
  f: { mode: "parcours", q: "", pst: "", pall: false, pview: "lignes", psort: "", orgs: true, reseaux: true, tous: false },
  form: null, busy: new Set(), sel: null,
};
let host = null;

export const reseauView = {
  id: "reseau",
  label: "Réseau",
  icon: "net",
  async mount(container) {
    host = container;
    if (modeDemande.reseau) { S.f.mode = modeDemande.reseau; modeDemande.reseau = null; S.sel = null; }
    render();
    if (!S.items) await load();
  },
  // Pas de fiche propre : les personnes s'ouvrent dans la fiche Contact.
  open: (id) => { location.replace(`#/contacts/${id}`); },
  close: () => {},
  reload: () => load(),
};

async function load(silent = false) {
  if (S.loading) return;
  S.loading = true; if (!silent) { S.error = null; render(); }
  try {
    const r = await reseauApi.list();
    Object.assign(S, { items: r.contacts, parcours: r.parcours, couleurs: r.couleurs || {}, moi: r.moi, parcoursDefaut: r.parcoursDefaut, clientsLus: r.clientsLus !== false, synchro: syncOf(r), error: null });
    index();
  } catch (e) { if (!silent || !S.items) S.error = e.message; }
  finally { S.loading = false; render(); }
}

// ---------------- Index et règles (POC) ----------------

const nid = (id) => String(id || "").replace(/-/g, "").toLowerCase();
let IX = { C: new Map() };
function index() {
  const C = new Map((S.items || []).map((c) => [nid(c.id), c]));
  IX = { C };
}
const C = (id) => IX.C.get(nid(id));
const isMe = (id) => nid(id) === nid(S.moi);
/** Liste à relire au prochain affichage (piste créée ailleurs, parcours changé par la fonction pistes). */
export const invalidateReseau = () => { if (host && document.body.contains(host) && S.items) load(true); else S.items = null; };
export const lab = (v) => (v == null ? "" : String(v).replace(/^[^\p{L}\p{N}]+/u, "").trim());
const isOrg = (c) => c?.type === "Organisation";
const isRes = (c) => c?.type === "Réseau";
const isPers = (c) => c && !isOrg(c) && !isRes(c);
const HORS = (v) => lab(v) === "Contact"; // « 👨‍👩‍👧‍👦Contact » = hors parcours
/** Étapes suivies dans le parcours (toutes sauf « hors parcours »), dans l'ordre de Notion. */
const PARC = () => S.parcours.filter((v) => !HORS(v));
// Étapes en cours, puis sorties réussies (Relais, Piste créée) et sorties (Nurturing, Sans suite), comme l'artefact.
const P_ACT = ["Recommandé", "À contacter", "Contacté", "À relancer", "Échange fait"];
const P_WIN = ["Relais", "Opportunité créée"];
const P_OUT = ["Nurturing", "Pas pertinent"];
const NEXT = { "Recommandé": "À contacter", "À contacter": "Contacté", "Contacté": "Échange fait", "À relancer": "Échange fait", "Échange fait": "Relais" };
const optOf = (l) => S.parcours.find((v) => lab(v) === l);
// « Sans suite » passe du rouge au gris (artefact) : le rouge reste réservé aux échéances.
const PARC_COL = { "Recommandé": "#8a6a4a", "À contacter": "#7a7a7a", "Contacté": "#b8902a", "À relancer": "#7b5aa6", "Échange fait": "#c0702a", "Relais": "#2e8b6a", "Opportunité créée": "#1f7a5a", "Nurturing": "#3a6fa8", "Pas pertinent": "#8a9291", "Contact": "#b0567a" };
const pCol = (v) => PARC_COL[lab(v)] || "#7a7a7a";
// Libellés de l'artefact ; la valeur enregistrée dans Notion ne change pas (donnée au survol).
const DISP = { "Opportunité créée": "Piste créée", "Pas pertinent": "Sans suite", "Contact": "Hors parcours" };
export const pLab = (v) => DISP[lab(v)] || lab(v);
const parcChip = (v) => v ? `<span class="chip parc" title="Notion : ${esc(lab(v))}"><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))}</span>` : "";
/** Nature sur la carte (règle du POC) : client ou partenaire (piste gagnée ou partenaire), réseau (hors parcours ou a recommandé), prospect. */
function kindOf(c) {
  if (isMe(c.id)) return "me";
  if (isOrg(c)) return "org";
  if (isRes(c)) return "res";
  if (c.client) return "client";
  if (HORS(c.parcours) || c.aRecommande.length) return "reseau";
  return "prospect";
}
const KIND = { me: "Toi", client: "Client ou partenaire", reseau: "Réseau", prospect: "Prospect", org: "Organisation", res: "Réseau thématique" };
const av = (c) => `<span class="av k-${kindOf(c)}" aria-hidden="true">${esc(initials(c.nom))}</span>`;
const orgsOf = (c) => (c.rattacheA || []).map(C).filter(Boolean);
const today = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
const name = (c) => (isMe(c.id) ? "moi, réseau perso" : c.nom.trim());

// ---------------- Vue ----------------

function render() {
  if (!host) return;
  const f = S.f;
  const head = `<div class="bar">${modesSeg("reseau", f.mode, (m) => `data-rzf="mode:${m}"`)}
    ${f.mode === "carte" ? `<button class="btn sm pri" data-rzact="new">${ic("plus", "ic-sm")}Contact recommandé</button>` : ""}<button class="btn sm" data-rzact="lien">${ic("link", "ic-sm")}Relier deux contacts</button></div>`;
  let body;
  if (S.error) body = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`;
  else if (!S.items) body = `<div class="card"><p class="empty">Chargement du réseau depuis Notion…</p></div>`;
  else body = staleBanner(S.synchro) + formBox() + (f.mode === "carte" ? carte() : parcours());
  const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  host.innerHTML = head + body;
  if (active === "rz-q") { const i = $("#rz-q", host); i?.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
  else if (focusAfter && !S.busy.size) { const el = host.querySelector(focusAfter); focusAfter = null; el?.focus(); }
  if (f.mode === "carte" && S.items) drawNet();
}

const syncLine = (t = "") => `<p class="small muted" style="margin:0 0 12px">${syncSpan(S.synchro, true)}${S.loading ? ", mise à jour…" : ""}.${t}</p>`;

let focusAfter = null; // sélecteur à refocaliser après le rendu (geste au clavier)

const late = (c) => !!c.dateProchaineAction && c.dateProchaineAction.slice(0, 10) < today();
const isToday = (c) => !!c.dateProchaineAction && c.dateProchaineAction.slice(0, 10) === today();
const byOf = (c) => c.recommandePar.map((id) => (isMe(id) ? { nom: "moi, réseau perso" } : C(id))).filter(Boolean);
const toOf = (c) => c.aRecommande.length;

/** Bouton vers l'étape suivante et menu « ⋯ » des autres étapes, communs aux lignes et aux cartes. */
function parcGo(c) {
  const busy = S.busy.has(c.id), cur = lab(c.parcours);
  const nx = NEXT[cur] && optOf(NEXT[cur]);
  // Relais : bouton « Piste » (artefact), qui ouvre la création d'une piste préremplie et rattachée à ce contact.
  const main = nx ? `<button class="btn sm" data-rznext="${c.id}" data-v="${esc(nx)}" ${busy ? "disabled" : ""} title="Passer à ${esc(pLab(nx))}">${esc(pLab(nx))} ›</button>`
    : cur === "Relais" ? `<a class="btn sm ghost" href="#/pistes/new/contact/${c.id}" data-rzpiste="${c.id}" title="Créer une piste rattachée à ${esc(c.nom.trim())}">${ic("target", "ic-sm")}Piste</a>` : "";
  const grp = (l, ks) => { const opts = ks.map(optOf).filter(Boolean); return opts.length ? `<span class="pm-g">${l}</span>${opts.map((v) => `<button type="button" class="${c.parcours === v ? "on" : ""}" data-rzset="${c.id}" data-v="${esc(v)}" ${busy ? "disabled" : ""} ${c.parcours === v ? 'aria-current="true"' : ""}><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))}</button>`).join("")}` : ""; };
  return `<div class="pgo">${main}<details class="pmenu" data-rzmenu="${c.id}"><summary aria-label="Changer l'étape de ${esc(c.nom.trim())}" title="Autre étape">⋯</summary><div class="pm-pop">${grp("Étapes", P_ACT)}${grp("Sorties réussies", P_WIN)}${grp("Sorties", [...P_OUT, "Contact"])}</div></details></div>`;
}

function parcCard(c) {
  const by = byOf(c), to = toOf(c), org = orgsOf(c).find(isOrg);
  return `<div class="pcard rzcard"><a class="pc-main" href="#/contacts/${c.id}"><span class="pc-n">${esc(c.nom.trim())}</span>${org ? `<span class="pc-s">${esc(org.nom)}</span>` : c.position ? `<span class="pc-s">${esc(c.position)}</span>` : ""}
    ${by.length ? `<span class="pc-s">${ic("link", "ic-sm")}Par ${esc(by.map((b) => b.nom.trim()).join(", "))}</span>` : ""}
    ${c.prochaineAction || c.dateProchaineAction ? `<span class="pc-s ${late(c) ? "late" : ""}">${ic("todo", "ic-sm")}${esc(c.prochaineAction || "Prochaine action")}${c.dateProchaineAction ? ", " + esc(fd(c.dateProchaineAction)) : ""}</span>` : ""}
    ${to ? `<span class="pc-s">${ic("users", "ic-sm")}A recommandé ${to} contact${to > 1 ? "s" : ""}</span>` : ""}</a>
    <div class="pc-act">${parcGo(c)}</div></div>`;
}

function parcRow(c, withStage) {
  const by = byOf(c), to = toOf(c), org = orgsOf(c).find(isOrg);
  const sub = [org ? org.nom : c.position, by.length ? "par " + by.map((b) => b.nom.trim()).join(", ") : "", to ? `a recommandé ${to} contact${to > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
  const lt = late(c), td = isToday(c);
  return `<div class="prow" data-rzrow="${c.id}">
    <a class="pr-who" href="#/contacts/${c.id}"><span class="pr-n">${esc(c.nom.trim())}</span>${sub ? `<span class="pr-s">${esc(sub)}</span>` : ""}</a>
    <a class="pr-act ${c.prochaineAction ? "" : "vide"}" href="#/contacts/${c.id}">${withStage ? parcChip(c.parcours) : ""}<span>${c.prochaineAction ? esc(c.prochaineAction) : "Prochaine action à définir"}</span></a>
    <span class="pr-dt ${lt ? "late" : td ? "today" : ""}">${c.dateProchaineAction ? (lt ? "En retard, " : td ? "Aujourd'hui, " : "") + esc(fd(c.dateProchaineAction)) : ""}</span>
    ${parcGo(c)}</div>`;
}

function parcours() {
  const f = S.f, q = nrm(f.q.trim());
  let list = S.items.filter((c) => isPers(c) && c.parcours && !HORS(c.parcours));
  // La recherche porte aussi sur la prochaine action (artefact).
  if (q) list = list.filter((c) => nrm(c.nom + " " + (orgsOf(c)[0]?.nom || "") + " " + (c.prochaineAction || "")).includes(q));
  const byDate = (a, b) => String(a.dateProchaineAction || "9").localeCompare(String(b.dateProchaineAction || "9")) || a.nom.trim().localeCompare(b.nom.trim(), "fr");
  const by = Object.fromEntries(PARC().map((v) => [v, list.filter((c) => c.parcours === v).sort(byDate)]));
  const n = (l) => { const v = optOf(l); return v ? by[v].length : 0; };
  const ACT = P_ACT.map(optOf).filter(Boolean);
  const act = list.filter((c) => ACT.includes(c.parcours));
  const due = act.filter((c) => c.dateProchaineAction && c.dateProchaineAction.slice(0, 10) <= today()).length;
  const nopa = act.filter((c) => !c.prochaineAction).length;
  const st = f.pst && PARC().includes(f.pst) ? f.pst : null;
  const kanban = f.pview === "kanban", sortEch = f.psort === "ech";
  const segv = (v, l) => `<button class="${(kanban ? "kanban" : "lignes") === v ? "on" : ""}" data-rzf="pview:${v}" aria-pressed="${(kanban ? "kanban" : "lignes") === v}">${l}</button>`;
  const exit = (l, win) => { const v = optOf(l); return v ? `<button class="${win ? "win " : ""}${st === v ? "on" : ""}" data-rzf="pst:${st === v ? "" : esc(v)}" aria-pressed="${st === v}" title="Notion : ${esc(lab(v))}"><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))} <b>${n(l)}</b></button>` : ""; };
  const frise = `<nav class="pfrise" aria-label="Étapes du parcours">${ACT.map((v) => `<button class="${st === v ? "on" : ""} ${by[v].length ? "" : "z"}" data-rzf="pst:${st === v ? "" : esc(v)}" aria-pressed="${st === v}"><b>${by[v].length}</b><span><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))}</span></button>`).join("")}</nav>
    <div class="pexits"><span>Sorties réussies</span>${P_WIN.map((l) => exit(l, true)).join("")}<span>Sorties</span>${P_OUT.map((l) => exit(l, false)).join("")}${st ? `<button class="lnk" data-rzf="pst:">Revenir aux étapes en cours</button>` : ""}</div>`;
  let body;
  if (kanban) {
    const cols = st ? [st] : f.pall ? PARC() : ACT;
    body = `<div class="parc-board ${cols.length === 1 ? "one" : ""}">${cols.map((v) => `<section class="pcol"><h3><i class="dot" style="background:${pCol(v)}"></i>${esc(pLab(v))}<span class="cnt">${by[v].length}</span></h3>${by[v].map(parcCard).join("") || `<p class="empty">Personne à cette étape.</p>`}</section>`).join("")}</div>
    ${!st ? `<p class="small muted" style="margin-top:10px"><button class="lnk" data-rzf="pall:${f.pall ? "" : "1"}">${f.pall ? "Masquer" : "Afficher aussi"} les sorties</button></p>` : ""}`;
  } else {
    const keys = st ? [st] : ACT;
    const sortBar = `<div class="psort"><span>Trier par</span><button class="${sortEch ? "" : "on"}" data-rzf="psort:" aria-pressed="${!sortEch}">étape</button><button class="${sortEch ? "on" : ""}" data-rzf="psort:ech" aria-pressed="${sortEch}">échéance</button></div>`;
    if (sortEch) { const flat = keys.flatMap((k) => by[k]).sort(byDate); body = sortBar + `<div class="prlist">${flat.map((c) => parcRow(c, !st)).join("") || `<p class="empty">Personne ici.</p>`}</div>`; }
    else body = sortBar + `<div class="prlist">${keys.filter((k) => by[k].length).map((k) => `<h3 class="psec"><i class="dot" style="background:${pCol(k)}"></i>${esc(pLab(k))}<span class="cnt">${by[k].length}</span></h3>${by[k].map((c) => parcRow(c, false)).join("")}`).join("") || `<p class="empty">Personne à cette étape.</p>`}</div>`;
  }
  return syncLine(" Parcours réseau des personnes (propriété « Parcours réseau » de Contacts). Hors parcours : non affichés ici.") + `
    <div class="bar"><label class="sr" for="rz-q">Chercher</label><input class="inp grow" id="rz-q" type="search" value="${esc(f.q)}" placeholder="Chercher une personne, une organisation, une action…" autocomplete="off"></div>
    <div class="parc-sum"><span><b>${act.length}</b> en cours</span><span class="${due ? "alert" : ""}"><b>${due}</b> action${due > 1 ? "s" : ""} due${due > 1 ? "s" : ""}</span><span><b>${nopa}</b> sans prochaine action</span>
      <div class="seg" role="group" aria-label="Affichage du parcours">${segv("lignes", ic("list", "ic-sm") + " Lignes")}${segv("kanban", ic("board", "ic-sm") + " Kanban")}</div>
      <button class="btn sm pri" data-rzact="new">${ic("plus", "ic-sm")}Contact recommandé</button></div>
    ${frise}${body}`;
}

// ---------------- Formulaires : contact recommandé, mise en lien ----------------

/** Choix de contacts pour les listes : libellé unique → identifiant. */
function choices(filter) {
  const seen = new Map(), out = [];
  for (const c of S.items.filter(filter).sort((a, b) => a.nom.trim().localeCompare(b.nom.trim(), "fr"))) {
    let l = c.nom.trim();
    if (seen.has(nrm(l))) l = `${l} (${orgsOf(c)[0]?.nom || c.position || c.id.slice(0, 4)})`;
    seen.set(nrm(l), c.id); out.push([l, c.id]);
  }
  return out;
}
const idOf = (list, v) => list.find(([l]) => nrm(l) === nrm(String(v || "").trim()))?.[1] ?? null;

function formBox() {
  const fm = S.form;
  if (!fm) return "";
  const busy = S.busy.has("form");
  if (fm.kind === "lien") {
    const pers = choices((c) => !isOrg(c) && !isRes(c));
    return `<section class="card rzform"><div class="card-h"><h2>Relier deux contacts</h2><button class="iconbtn" data-rzact="fermer" aria-label="Fermer">${ic("close")}</button></div>
      <p class="small muted" style="margin-bottom:8px">Le premier « A recommandé » le second (propriété « A recommandé », ex-« Mise en lien avec »). Notion ajoute aussitôt « Recommandé par » sur la fiche du second.</p>
      <form class="form" id="rz-lien"><div class="fld"><label for="rz-a">Qui a recommandé</label><input class="inp" id="rz-a" list="rz-pl" value="${esc(fm.a || "")}" required autocomplete="off" placeholder="Nom du contact"></div>
        <div class="fld"><label for="rz-b">Contact recommandé</label><input class="inp" id="rz-b" list="rz-pl" value="${esc(fm.b || "")}" required autocomplete="off" placeholder="Nom du contact"></div>
        <datalist id="rz-pl">${pers.map(([l]) => `<option value="${esc(l)}">`).join("")}</datalist>
        <div class="mfoot"><button class="btn sm pri" type="submit" ${busy ? "disabled" : ""}>${busy ? "Enregistrement…" : "Relier dans Notion"}</button></div></form>
      ${fm.err ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(fm.err)}</span></div>` : ""}</section>`;
  }
  const pers = choices((c) => isPers(c)), orgs = choices((c) => isOrg(c));
  return `<section class="card rzform"><div class="card-h"><h2>Contact recommandé</h2><button class="iconbtn" data-rzact="fermer" aria-label="Fermer">${ic("close")}</button></div>
    <p class="small muted" style="margin-bottom:8px">Crée une personne dans Contacts, à l'étape choisie du parcours, avec qui te l'a recommandée.</p>
    <form class="form" id="rz-new">
      <div class="fld wide"><label for="rz-n">Nom</label><input class="inp" id="rz-n" required autocomplete="off" value="${esc(fm.nom || "")}" placeholder="Prénom Nom"></div>
      <div class="fld"><label for="rz-r">Recommandé par</label><input class="inp" id="rz-r" list="rz-rl" autocomplete="off" value="${esc(fm.reco || "")}" placeholder="Nom du contact, ou « moi, réseau perso »"><datalist id="rz-rl">${pers.map(([l, id]) => `<option value="${esc(isMe(id) ? "moi, réseau perso" : l)}">`).join("")}</datalist></div>
      <div class="fld"><label for="rz-o">Organisation</label><input class="inp" id="rz-o" list="rz-ol" autocomplete="off" value="${esc(fm.org || "")}" placeholder="Facultatif"><datalist id="rz-ol">${orgs.map(([l]) => `<option value="${esc(l)}">`).join("")}</datalist></div>
      <div class="fld"><label for="rz-e">Mail</label><input class="inp" id="rz-e" type="email" autocomplete="off" value="${esc(fm.email || "")}" placeholder="Facultatif"></div>
      <div class="fld"><label for="rz-s">Étape</label><select class="sel" id="rz-s">${PARC().map((v) => `<option value="${esc(v)}" ${v === (fm.parcours || S.parcoursDefaut) ? "selected" : ""}>${esc(lab(v))}</option>`).join("")}</select></div>
      <div class="fld"><label for="rz-pa">Prochaine action</label><input class="inp" id="rz-pa" autocomplete="off" value="${esc(fm.pa || "")}" placeholder="Facultatif"></div>
      <div class="fld"><label for="rz-d">Date</label><input type="date" id="rz-d" value="${esc(fm.dpa || "")}"></div>
      <div class="mfoot"><button class="btn sm pri" type="submit" ${busy ? "disabled" : ""}>${busy ? "Enregistrement…" : "Créer dans Notion"}</button></div></form>
    ${fm.doublon ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(fm.err)} <a href="#/contacts/${fm.doublon}">Ouvrir la fiche existante</a> ou <button class="lnk" data-rzact="force">créer quand même</button>.</span></div>` : fm.err ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(fm.err)}</span></div>` : ""}</section>`;
}

function readNewForm() {
  const v = (id) => $(id, host)?.value?.trim() || "";
  return { nom: v("#rz-n"), reco: v("#rz-r"), org: v("#rz-o"), email: v("#rz-e"), parcours: v("#rz-s"), pa: v("#rz-pa"), dpa: v("#rz-d") };
}

async function submitNew(force = false) {
  const fm = { ...S.form, ...readNewForm(), err: null, doublon: null };
  S.form = fm;
  const pers = choices((c) => isPers(c)), orgs = choices((c) => isOrg(c));
  const reco = !fm.reco ? null : nrm(fm.reco) === nrm("moi, réseau perso") ? S.moi : idOf(pers, fm.reco);
  const org = fm.org ? idOf(orgs, fm.org) : null;
  if (fm.reco && !reco) { fm.err = `« ${fm.reco} » n'est pas une personne des contacts actifs.`; render(); return; }
  if (fm.org && !org) { fm.err = `« ${fm.org} » n'est pas une organisation des contacts.`; render(); return; }
  S.busy.add("form"); render();
  try {
    const r = await reseauApi.creer({ nom: fm.nom, recommandePar: reco, rattacheA: org, email: fm.email || null, parcours: fm.parcours || S.parcoursDefaut, prochaineAction: fm.pa || null, dateProchaineAction: fm.dpa || null, confirmerDoublon: force });
    toast(`Contact « ${r.contact.nom} » créé dans Notion.`);
    S.form = null;
    S.items.push(r.contact); index();
    load(true);
  } catch (e) {
    fm.err = e.message; if (e.code === "doublon") fm.doublon = e.details?.id || null;
  } finally { S.busy.delete("form"); render(); }
}

async function submitLien() {
  const fm = S.form; fm.a = $("#rz-a", host).value.trim(); fm.b = $("#rz-b", host).value.trim(); fm.err = null;
  const pers = choices((c) => !isOrg(c) && !isRes(c));
  const a = idOf(pers, fm.a), b = idOf(pers, fm.b);
  if (!a || !b) { fm.err = "Choisis deux contacts de la liste."; render(); return; }
  S.busy.add("form"); render();
  try {
    const r = await reseauApi.relier(a, b);
    toast(r.deja ? "Ces deux contacts étaient déjà reliés." : "Mise en lien enregistrée dans Notion.");
    S.form = null;
    load(true);
  } catch (e) { fm.err = e.message; }
  finally { S.busy.delete("form"); render(); }
}

/** Change l'étape dans Notion ; « Annuler » pendant 6 secondes remet l'étape d'avant (artefact). */
async function setParcours(id, v, undoable = true) {
  const c = C(id); if (!c || c.parcours === v || S.busy.has(id)) return;
  const was = c.parcours;
  S.busy.add(id); render();
  try {
    const r = await reseauApi.update(id, { "Parcours réseau": v });
    Object.assign(c, r.contact);
    const msg = `${c.nom.trim()}, ${pLab(v)}.`;
    if (undoable && was) toastUndo(msg + " Enregistré dans Notion.", () => setParcours(id, was, false).then(() => toast(`${c.nom.trim()} revient à ${pLab(was)}.`)));
    else if (undoable) toast(msg + " Enregistré dans Notion.");
  } catch (e) { toast(e.message, "err"); }
  finally { S.busy.delete(id); render(); }
}

// ---------------- Carte des mises en lien (d3-force, comme le POC) ----------------

let d3p = null;
function loadD3() {
  if (window.d3) return Promise.resolve(window.d3);
  if (!d3p) d3p = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"; s.async = true;
    s.onload = () => res(window.d3); s.onerror = () => { d3p = null; rej(new Error("d3")); };
    document.head.appendChild(s);
  });
  return d3p;
}

function inScope(c) {
  if (!isPers(c) || isMe(c.id)) return false;
  if (c.recommandePar.length || c.aRecommande.length || c.client) return true;
  return !!c.parcours && !["Pas pertinent"].includes(lab(c.parcours));
}

function carte() {
  const f = S.f;
  const chk = (k, l) => `<label class="chk-l"><input type="checkbox" data-rzchk="${k}" ${f[k] ? "checked" : ""}>${l}</label>`;
  return syncLine(" Flèche : « A recommandé ». Pointillés : personne rattachée à une organisation ou un réseau.") + `
    <div class="bar">${chk("orgs", "Organisations")}${chk("reseaux", "Réseaux")}${chk("tous", "Tous les contacts actifs")}
      <label class="sr" for="rz-find">Trouver sur la carte</label><input class="inp grow" id="rz-find" list="rz-fl" placeholder="Trouver une personne sur la carte…" autocomplete="off"><datalist id="rz-fl">${S.items.filter(isPers).map((c) => `<option value="${esc(c.nom.trim())}">`).join("")}</datalist></div>
    <div class="netbox" id="netbox"><svg id="net" role="img" aria-label="Carte du réseau : qui a recommandé qui, rattachements aux organisations et réseaux"></svg>
      <div class="legend" id="legend"><span><i style="background:var(--n-me)"></i>Toi</span><span><i style="background:var(--n-client)"></i>Client ou partenaire</span><span><i style="background:var(--n-reseau)"></i>Réseau</span><span><i style="background:var(--n-prospect)"></i>Prospect</span><span><i class="sq" style="background:var(--n-org)"></i>Organisation</span><span><i class="sq" style="background:var(--n-res);border:1.5px solid var(--teal)"></i>Réseau thématique</span><span><i class="ln"></i>A recommandé</span></div>
      <div class="nzoom"><button data-rzact="zin" aria-label="Zoomer">+</button><button data-rzact="zout" aria-label="Dézoomer">−</button><button data-rzact="zfit" aria-label="Recentrer">${ic("target", "ic-sm")}</button><button class="mob-only" data-rzact="legend" aria-label="Légende">${ic("info", "ic-sm")}</button></div>
      <div class="ninfo" id="ninfo" hidden></div>
    </div>
    ${S.clientsLus ? "" : `<p class="small muted" style="margin-top:8px">Pistes non lues : la nature « client ou partenaire » n'est pas calculée.</p>`}`;
}

function netData() {
  const f = S.f, nodes = new Map(), links = [];
  const add = (c) => { if (c && !nodes.has(nid(c.id))) nodes.set(nid(c.id), { id: nid(c.id), c, k: kindOf(c) }); };
  const persons = S.items.filter((c) => isPers(c) && !isMe(c.id) && (f.tous || inScope(c)));
  const pset = new Set(persons.map((p) => nid(p.id)));
  for (const p of [...persons]) for (const r of p.recommandePar) { const rc = C(r); if (rc && !isMe(r) && isPers(rc) && !pset.has(nid(r))) { pset.add(nid(r)); persons.push(rc); } }
  persons.forEach(add);
  const me = C(S.moi) || { id: S.moi || "moi", nom: "Jean-Baptiste", type: "Personne", recommandePar: [], aRecommande: [], rattacheA: [] };
  nodes.set(nid(me.id), { id: nid(me.id), c: me, k: "me", fx: 0, fy: 0 });
  for (const p of persons) {
    const by = p.recommandePar.filter((r) => pset.has(nid(r)) || isMe(r));
    for (const r of by) links.push({ source: nid(r), target: nid(p.id), t: "reco" });
    if (!by.length) links.push({ source: nid(me.id), target: nid(p.id), t: "me" });
    if (f.orgs) for (const o of orgsOf(p)) {
      if (isOrg(o)) { add(o); links.push({ source: nid(p.id), target: nid(o.id), t: "org" }); }
      else if (isRes(o) && f.reseaux) { add(o); links.push({ source: nid(p.id), target: nid(o.id), t: "res" }); }
    }
  }
  if (f.reseaux) for (const n of [...nodes.values()]) if (isOrg(n.c)) for (const r of n.c.rattacheA || []) { const rc = C(r); if (rc && isRes(rc)) { add(rc); links.push({ source: n.id, target: nid(rc.id), t: "res" }); } }
  const deg = new Map();
  for (const l of links) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1); }
  for (const n of nodes.values()) {
    const d = deg.get(n.id) || 0;
    n.r = n.k === "me" ? 16 : n.k === "res" ? 11 + Math.min(8, d / 2) : n.k === "org" ? 6 + Math.min(6, d) : 6 + Math.min(6, (n.c.aRecommande?.length || 0) * 2 + (n.c.pistes?.length || 0));
  }
  return { nodes: [...nodes.values()], links };
}

let NET = null;
async function drawNet() {
  const box = $("#netbox", host);
  if (!box) return;
  let d3;
  try { d3 = await loadD3(); } catch { box.innerHTML = `<p class="empty" style="padding:20px">La bibliothèque de graphe ne s'est pas chargée. Passe en vue Parcours ou recharge la page.</p>`; return; }
  if (!document.body.contains(box)) return;
  NET?.sim?.stop();
  const svg = d3.select(box.querySelector("#net"));
  const W = box.clientWidth, H = box.clientHeight;
  svg.attr("viewBox", [-W / 2, -H / 2, W, H]); svg.selectAll("*").remove();
  const css = getComputedStyle(document.documentElement);
  const col = (k) => css.getPropertyValue({ me: "--n-me", client: "--n-client", reseau: "--n-reseau", prospect: "--n-prospect", org: "--n-org", res: "--n-res" }[k]).trim();
  svg.append("defs").append("marker").attr("id", "arr").attr("viewBox", "0 0 10 10").attr("refX", 10).attr("refY", 5).attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto-start-reverse").append("path").attr("d", "M0,0 L10,5 L0,10 z").attr("fill", css.getPropertyValue("--edge-reco").trim());
  const { nodes, links } = netData();
  const g = svg.append("g");
  const zoom = d3.zoom().scaleExtent([0.25, 4]).on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  const link = g.append("g").selectAll("line").data(links).join("line").attr("class", (d) => `lk ${d.t}`).attr("marker-end", (d) => (d.t === "reco" ? "url(#arr)" : null));
  const node = g.append("g").selectAll("g").data(nodes).join("g").attr("class", "ng");
  node.each(function (d) {
    const s = d3.select(this);
    if (d.k === "org" || d.k === "res") s.append("rect").attr("class", "nd k-" + d.k).attr("x", -d.r).attr("y", -d.r).attr("width", d.r * 2).attr("height", d.r * 2).attr("rx", d.k === "res" ? 5 : 3).attr("fill", col(d.k)).attr("transform", d.k === "res" ? "rotate(45)" : null);
    else s.append("circle").attr("class", "nd k-" + d.k).attr("r", d.r).attr("fill", col(d.k));
  });
  const showLabel = (d) => d.k === "me" || d.k === "res" || d.r >= 9 || (d.c.aRecommande?.length || 0) > 0 || nodes.length < 70;
  const label = node.append("text").attr("dy", (d) => d.r + 12).attr("text-anchor", "middle").text((d) => { const n = name(d.c); return n.length > 26 ? n.slice(0, 24) + "…" : n; }).attr("opacity", (d) => (showLabel(d) ? 1 : 0));
  node.append("title").text((d) => name(d.c));
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => (l.t === "reco" ? 55 : l.t === "org" ? 38 : l.t === "res" ? 70 : 95)).strength((l) => (l.t === "me" ? 0.25 : l.t === "res" ? 0.3 : 0.8)))
    .force("charge", d3.forceManyBody().strength((d) => (d.k === "res" ? -260 : -90)))
    .force("collide", d3.forceCollide((d) => d.r + 5))
    .force("x", d3.forceX().strength(0.04)).force("y", d3.forceY().strength(0.05))
    .on("tick", () => {
      const end = (d, ax) => { if (d.t !== "reco") return d.target[ax]; const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y, L = Math.hypot(dx, dy) || 1; return d.target[ax] - (ax === "x" ? dx : dy) / L * (d.target.r + 3); };
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => end(d, "x")).attr("y2", (d) => end(d, "y"));
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });
  node.call(d3.drag().on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; }).on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; }).on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); if (d.k !== "me") { d.fx = null; d.fy = null; } }));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); sim.on("tick")(); }
  const fit = (anim) => { if (!nodes.length) return; const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); const k = Math.max(0.25, Math.min(1.3, W / (x1 - x0 + 90), H / (y1 - y0 + 90))); const t = d3.zoomIdentity.scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2); (anim ? svg.transition().duration(400) : svg).call(zoom.transform, t); };
  const adj = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
  links.forEach((l) => { const s = l.source.id || l.source, t = l.target.id || l.target; adj.get(s)?.add(t); adj.get(t)?.add(s); });
  function select(id) {
    S.sel = id;
    node.classed("ndim", (d) => id && !adj.get(id)?.has(d.id));
    node.select(".nd").classed("sel", (d) => d.id === id);
    link.classed("ndim", (d) => id && d.source.id !== id && d.target.id !== id);
    label.attr("opacity", (d) => ((id ? adj.get(id)?.has(d.id) : showLabel(d)) ? 1 : 0));
    const info = $("#ninfo", host); if (!info) return;
    const n = nodes.find((x) => x.id === id);
    if (!n || n.k === "me") { info.hidden = true; return; }
    const c = n.c, by = c.recommandePar.map((r) => (isMe(r) ? { nom: "moi, réseau perso" } : C(r))).filter(Boolean), to = c.aRecommande.map(C).filter(Boolean);
    info.hidden = false;
    info.innerHTML = `<div class="nh">${av(c)}<div style="min-width:0;flex:1"><b>${esc(c.nom.trim())}</b><div class="small muted">${esc(KIND[n.k])}${c.position ? " · " + esc(c.position) : ""}</div></div><button class="iconbtn" data-rzact="nclose" aria-label="Fermer">${ic("close", "ic-sm")}</button></div>
      <div class="chips">${parcChip(c.parcours)}${by.map((b) => `<span class="chip st-relire">Recommandé par ${esc(b.nom.trim())}</span>`).join("")}${to.length ? `<span class="chip st-termine">A recommandé ${esc(to.map((t) => t.nom.trim()).join(", "))}</span>` : ""}${c.pistes?.length ? `<span class="chip st-encours">${c.pistes.length} piste${c.pistes.length > 1 ? "s" : ""}</span>` : ""}</div>
      <div class="dact"><a class="btn sm" href="#/contacts/${c.id}">Ouvrir la fiche</a>${isPers(c) ? `<button class="btn sm" data-rzact="lienDe" data-id="${c.id}">${ic("link", "ic-sm")}Relier</button>` : ""}</div>`;
  }
  node.on("click", (e, d) => { e.stopPropagation(); select(d.id); });
  svg.on("click", () => select(null));
  NET = { sim, svg, zoom, d3, fit, select, nodes, focus: (id) => { const n = nodes.find((x) => x.id === id); if (!n) { toast("Cette personne n'est pas sur la carte avec ces filtres."); return; } select(id); svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.scale(1.6).translate(-n.x, -n.y)); } };
  setTimeout(() => { if (NET?.sim === sim && !S.sel) fit(true); }, 1400);
  if (S.sel && nodes.some((n) => n.id === S.sel)) setTimeout(() => select(S.sel), 50);
}

// ---------------- Événements ----------------

export function bindReseauEvents(root) {
  root.addEventListener("click", (e) => {
    if (!host || !root.contains(host)) return;
    const f = e.target.closest("[data-rzf]");
    if (f) { const [k, ...v] = f.dataset.rzf.split(":"); S.f[k] = k === "pall" ? !!v.join(":") : v.join(":"); if (k === "mode") S.sel = null; render(); return; }
    // Menu « ⋯ » : un seul ouvert à la fois, fermé par un clic ailleurs.
    root.querySelectorAll("details.pmenu[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
    const nx = e.target.closest("[data-rznext]");
    if (nx) { focusAfter = `[data-rzmenu="${nx.dataset.rznext}"] summary`; setParcours(nx.dataset.rznext, nx.dataset.v); return; }
    const set = e.target.closest("[data-rzset]");
    if (set) { set.closest("details").open = false; focusAfter = `[data-rzmenu="${set.dataset.rzset}"] summary`; setParcours(set.dataset.rzset, set.dataset.v); return; }
    const a = e.target.closest("[data-rzact]");
    if (!a) return;
    const act = a.dataset.rzact;
    if (act === "new") { S.form = { kind: "new" }; render(); $("#rz-n", host)?.focus(); }
    else if (act === "lien") { S.form = { kind: "lien" }; render(); $("#rz-a", host)?.focus(); }
    else if (act === "lienDe") { const c = C(a.dataset.id); S.form = { kind: "lien", a: c?.nom.trim() }; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (act === "fermer") { S.form = null; render(); }
    else if (act === "force") submitNew(true);
    else if (act === "nclose") NET?.select(null);
    else if (act === "zin") NET?.svg.transition().call(NET.zoom.scaleBy, 1.4);
    else if (act === "zout") NET?.svg.transition().call(NET.zoom.scaleBy, 1 / 1.4);
    else if (act === "zfit") NET?.fit(true);
    else if (act === "legend") $("#legend", host)?.classList.toggle("show");
  });
  root.addEventListener("input", (e) => { if (e.target.id === "rz-q") { S.f.q = e.target.value; render(); } });
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { const d = e.target.closest?.("details.pmenu[open]"); if (d) { d.open = false; d.querySelector("summary").focus(); } } });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset?.rzchk) { S.f[el.dataset.rzchk] = el.checked; render(); return; }
    if (el.id === "rz-find" && el.value.trim()) { const c = S.items.find((x) => nrm(x.nom.trim()) === nrm(el.value.trim())); if (c) NET?.focus(nid(c.id)); }
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id === "rz-new") { e.preventDefault(); submitNew(false); }
    if (e.target.id === "rz-lien") { e.preventDefault(); submitLien(); }
  });
}

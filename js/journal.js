// Vue « Journal » (lot 5a, 26/11/2026) : entrées du Journal de bord du miroir, par semaine ou en calendrier,
// reliées aux contacts, pistes et projets. Fiche d'une entrée plein écran, onglets de l'artefact : Synthèse,
// Compte rendu (corps de la page Notion, lu à la demande, 26/11/2026), Actions issues, Projet et initiative.
import { journalApi } from "./api.js";
import { interRow } from "./journee.js";
import { jetonsHTML } from "./jetons.js";
import { contenuHTML, bindContenu, oublierBlocs } from "./contenu.js";
import { ppTxt, ppLink, ppBtn, ppBand, saFold } from "./props.js";
import { setTaskEtat } from "./todo.js";
import { $, esc, ic, nrm, fd, toast, toastUndo, setDrawerOwner, ownsDrawer, ficheTop, renderSide, sideHTML, ficheTabs, etatChip, taSpan, chip, syncOf, syncSpan, staleBanner, isDone } from "./ui.js";

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const TYPES = ["Email", "Compte rendu", "Relance", "Prise de contact", "Ordre du jour", "Production", "Recherche", "Point à creuser"];
const lab = (v) => (v == null ? "" : String(v).replace(/^[^\p{L}\p{N}]+/u, "").trim());
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const mondayOf = (d) => { const m = day0(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
const parseD = (s) => new Date(/T/.test(s) ? s : s + "T00:00:00");
const kindOf = (f) => /atelier/i.test(f || "") ? "atelier" : /r[ée]union/i.test(f || "") ? "reunion" : /call|appel/i.test(f || "") ? "call" : null;
const mobile = () => window.matchMedia("(max-width: 900px)").matches;

const S = { data: null, error: null, loading: false, f: { vue: "liste", fmt: "", lien: "", q: "", wk: "" }, open: null, busy: false };
let host = null, drawerHost = null;

export const journalView = {
  id: "journal",
  label: "Journal",
  short: "Journal",
  icon: "book",
  async mount(container, drawer) { host = container; drawerHost = drawer; render(); await load(!!S.data); },
  open: openEntree,
  close: () => { S.open = null; },
  reload: async () => { await load(true); if (S.open) openEntree(S.open.id, true); },
};

async function load(silent = false) {
  if (S.loading) return;
  S.loading = true; if (!silent) { S.error = null; render(); }
  try { S.data = await journalApi.list(); S.error = null; }
  catch (e) { if (!silent || !S.data) S.error = e.message; else toast(e.message, "err"); }
  finally { S.loading = false; render(); }
}

function filtered() {
  const f = S.f, d = S.data, q = nrm(f.q.trim());
  return d.entrees.filter((e) => {
    const k = kindOf(e.format);
    if (f.fmt && (f.fmt === "autre" ? k : k !== f.fmt)) return false;
    if (f.lien === "none" && (e.projets.length || e.pistes.length)) return false;
    if (f.lien === "pistes" && !e.pistes.length) return false;
    if (f.lien && !["none", "pistes"].includes(f.lien) && !e.projets.includes(f.lien)) return false;
    if (q && !nrm([e.titre, ...e.pistes.map((id) => d.pistesNoms[id]), ...e.projets.map((id) => d.projetsNoms[id]), ...e.contacts.map((id) => d.contactsNoms[id])].join(" ")).includes(q)) return false;
    return true;
  });
}

function render() {
  if (!host) return;
  if (S.error) { host.innerHTML = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`; return; }
  const d = S.data;
  if (!d) { host.innerHTML = `<div class="card"><p class="empty">Chargement du Journal de bord…</p></div>`; return; }
  const f = S.f;
  const seg = (k, v, l) => `<button class="${f[k] === v ? "on" : ""}" data-jf="${k}:${v}">${l}</button>`;
  const prj = d.choix.projets.filter((p) => d.entrees.some((e) => e.projets.includes(p.id)));
  const head = `<div class="bar"><div class="seg" role="group" aria-label="Affichage">${seg("vue", "liste", ic("list", "ic-sm") + " Liste")}${seg("vue", "semaine", ic("grid", "ic-sm") + " Semaine")}</div>
    <div class="seg" role="group" aria-label="Format">${seg("fmt", "", "Tout")}${seg("fmt", "atelier", "Ateliers")}${seg("fmt", "reunion", "Réunions")}${seg("fmt", "call", "Appels")}${seg("fmt", "autre", "Sans format")}</div>
    <label class="sr" for="jf-l">Rattachement</label><select class="sel" id="jf-l" data-jfsel="lien"><option value="">Tous les rattachements</option><option value="pistes" ${f.lien === "pistes" ? "selected" : ""}>Liées à une piste</option><option value="none" ${f.lien === "none" ? "selected" : ""}>Non rattachées</option>${prj.map((p) => `<option value="${p.id}" ${f.lien === p.id ? "selected" : ""}>${esc(p.nom)}</option>`).join("")}</select>
    <label class="sr" for="jf-q">Filtrer</label><input class="inp grow" id="jf-q" type="search" placeholder="Titre, piste, projet, contact…" value="${esc(f.q)}" autocomplete="off"></div>`;
  const list = filtered();
  const intro = `<p class="small muted" style="margin:-4px 0 10px">${list.length} entrée${list.length > 1 ? "s" : ""} du Journal de bord depuis le ${esc(fd(d.depuis))}. ${esc(d.exclus)} ${syncSpan(syncOf(d), true)}${S.loading ? ", mise à jour…" : ""}.</p>`;
  const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  host.innerHTML = head + staleBanner(syncOf(d)) + intro + (f.vue === "semaine" ? week(list) : weeks(list));
  if (active === "jf-q") { const i = $("#jf-q", host); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
}

function weeks(list) {
  if (!list.length) return `<div class="card"><p class="empty">Aucune entrée pour ces filtres.</p></div>`;
  const groups = new Map();
  for (const e of list) { const k = iso(mondayOf(parseD(e.date))); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const cur = iso(mondayOf(new Date()));
  let html = `<div class="card">`;
  for (const [k, items] of groups) html += `<div class="wk">${k === cur ? "Cette semaine" : `Semaine du ${esc(fd(k))}`} · ${items.length}</div><div class="list">${items.map((e) => interRow(e, S.data)).join("")}</div>`;
  return html + `</div>`;
}

// Calendrier à la semaine (POC) : colonnes par jour, échanges placés à leur heure ; sur téléphone, liste par jour.
const H0 = 7, H1 = 22, HH = 58;
function week(list) {
  const mon = S.f.wk ? parseD(S.f.wk) : mondayOf(new Date());
  const days = [...Array(7)].map((_, i) => { const x = new Date(mon); x.setDate(x.getDate() + i); return x; });
  const end = new Date(mon); end.setDate(end.getDate() + 7);
  const prev = new Date(mon); prev.setDate(prev.getDate() - 7);
  const evs = list.filter((e) => { const x = parseD(e.date); return x >= mon && x < end; });
  const byDay = days.map((x) => evs.filter((e) => iso(parseD(e.date)) === iso(x)).sort((a, b) => a.date.localeCompare(b.date)));
  const last = days[6], tIso = iso(new Date());
  const title = mon.getMonth() === last.getMonth() ? `Semaine du ${mon.getDate()} au ${last.getDate()} ${MOIS[last.getMonth()]}` : `Semaine du ${mon.getDate()} ${MOIS[mon.getMonth()]} au ${last.getDate()} ${MOIS[last.getMonth()]}`;
  const totalMin = evs.reduce((n, e) => n + (e.duree || 0), 0);
  let html = `<div class="calnav"><button class="iconbtn" data-jf="wk:${iso(prev)}" aria-label="Semaine précédente">${ic("back")}</button><button class="iconbtn flip" data-jf="wk:${iso(end)}" aria-label="Semaine suivante">${ic("back")}</button>
    <h2>${title}${mon.getFullYear() !== new Date().getFullYear() ? " " + mon.getFullYear() : ""}</h2>
    <span class="count">${evs.length} entrée${evs.length > 1 ? "s" : ""}${totalMin ? ` · ${Math.floor(totalMin / 60)} h ${String(totalMin % 60).padStart(2, "0")} enregistrées` : ""}</span>
    ${iso(mon) === iso(mondayOf(new Date())) ? "" : `<button class="btn sm" data-jf="wk:">Cette semaine</button>`}</div>`;
  if (mobile()) {
    html += `<div class="agenda">`;
    days.forEach((x, k) => {
      if (!byDay[k].length && iso(x) !== tIso) return;
      html += `<section class="aday card ${iso(x) === tIso ? "today" : ""}"><h3>${JOURS[x.getDay()]} ${x.getDate()} ${MOIS[x.getMonth()]}<span>${byDay[k].length || "aucune"} entrée${byDay[k].length > 1 ? "s" : ""}</span></h3><div class="list">${byDay[k].map((e) => interRow(e, S.data)).join("") || `<p class="empty">Rien de noté pour l'instant.</p>`}</div></section>`;
    });
    return html + (evs.length ? "" : `<p class="empty">Aucune entrée cette semaine avec ces filtres.</p>`) + `</div>`;
  }
  const tot = (H1 - H0) * HH;
  let g = `<div class="cal-wrap"><div class="cal" style="--days:7;--hh:${HH}px"><div class="cal-h"></div>`;
  days.forEach((x) => { g += `<div class="cal-h ${iso(x) === tIso ? "today" : ""}"><span>${JOURS[x.getDay()].slice(0, 3)}.</span><b>${x.getDate()}</b></div>`; });
  g += `<div class="cal-adl">Sans heure</div>`;
  byDay.forEach((arr) => { g += `<div class="cal-ad">${arr.filter((e) => !/T/.test(e.date)).map((e) => `<a class="ev ad ${kindOf(e.format) || "none"}" href="#/journal/${e.id}" title="${esc(e.titre)}"><b class="clamp2">${esc(e.titre)}</b></a>`).join("")}</div>`; });
  g += `<div class="cal-times" style="height:${tot}px">${[...Array(H1 - H0)].map((_, k) => `<span style="top:${k ? k * HH : 8}px">${H0 + k}h</span>`).join("")}</div>`;
  days.forEach((x, k) => {
    // Chevauchements placés en couloirs, comme le POC.
    const timed = byDay[k].filter((e) => /T/.test(e.date)).map((e) => { const t = parseD(e.date); const st = t.getHours() * 60 + t.getMinutes(); return { e, st, en: st + Math.max(e.duree || 45, 30) }; });
    const lanes = []; let cluster = [], clEnd = -1; const out = [];
    const flush = () => { const n = Math.max(...cluster.map((c) => c.lane)) + 1; cluster.forEach((c) => { c.n = n; out.push(c); }); cluster = []; lanes.length = 0; };
    for (const o of timed) {
      if (cluster.length && o.st >= clEnd) flush();
      let l = lanes.findIndex((en) => en <= o.st); if (l < 0) { l = lanes.length; lanes.push(0); }
      lanes[l] = o.en; o.lane = l; cluster.push(o); clEnd = Math.max(clEnd, o.en);
    }
    if (cluster.length) flush();
    const wkend = x.getDay() === 0 || x.getDay() === 6;
    g += `<div class="cal-day ${iso(x) === tIso ? "today" : ""} ${wkend ? "wkend" : ""}" style="height:${tot}px">`;
    for (const o of out) {
      const top = Math.max(0, Math.min(tot - 24, (o.st - H0 * 60) / 60 * HH));
      const h = Math.max(24, (o.en - o.st) / 60 * HH - 2);
      const t = parseD(o.e.date);
      g += `<a class="ev ${kindOf(o.e.format) || "none"}" href="#/journal/${o.e.id}" style="top:${top}px;height:${h}px;left:calc(${o.lane / o.n * 100}% + 2px);width:calc(${100 / o.n}% - 4px)" title="${esc(o.e.titre)}"><b class="clamp2">${esc(o.e.titre)}</b><small>${t.getHours()}h${String(t.getMinutes()).padStart(2, "0")}${o.e.duree ? ` · ${o.e.duree} min` : ""}</small></a>`;
    }
    if (iso(x) === tIso) { const n = new Date(); const m = n.getHours() * 60 + n.getMinutes(); if (m >= H0 * 60 && m <= H1 * 60) g += `<div class="nowline" style="top:${(m - H0 * 60) / 60 * HH}px"></div>`; }
    g += `</div>`;
  });
  return html + g + `</div></div>`;
}

// ---------------- Fiche d'une entrée ----------------

async function openEntree(id, keepSec = false) {
  const fromList = S.data?.entrees.find((e) => e.id === id);
  const same = S.open?.id === id;
  const sec = keepSec && same ? S.open.sec : "synthese";
  S.open = { id, e: same ? S.open.e : null, partial: fromList, actions: same ? S.open.actions : null, choix: S.open?.choix ?? S.data?.choix ?? null, error: null, sec, form: same ? S.open.form : false,
    contenu: same ? S.open.contenu : null, cErr: null, inits: S.open?.inits ?? null };
  setDrawerOwner("journal");
  renderDrawer();
  lireContenu(id);
  try {
    const r = await journalApi.get(id);
    if (S.open?.id !== id) return;
    Object.assign(S.open, { e: r.entree, actions: r.actions, choix: r.choix, synchro: syncOf(r), error: null });
  } catch (e) { if (S.open?.id === id) S.open.error = e.message; }
  renderDrawer();
}

/** Compte rendu : lu dans Notion par la fonction journal (cache court côté serveur), en même temps que la fiche. */
async function lireContenu(id, frais = false) {
  if (frais) oublierBlocs(id);
  try {
    const c = await journalApi.contenu(id, frais);
    if (S.open?.id !== id) return;
    Object.assign(S.open, { contenu: c, cErr: null });
  } catch (e) { if (S.open?.id === id) Object.assign(S.open, { cErr: e.message }); }
  renderDrawer();
}

/** Initiatives (base Thèmes, lue dans Notion), chargées à l'ouverture de l'onglet Projet et initiative. */
async function lireInitiatives() {
  const o = S.open; if (!o || o.inits || o.initsLoading) return;
  o.initsLoading = true;
  try { o.inits = await journalApi.initiatives(); } catch (e) { o.inits = { erreur: e.message }; }
  o.initsLoading = false;
  if (S.open === o) renderDrawer();
}

const SECS = { synthese: "Synthèse", cr: "Compte rendu", actions: "Actions issues", liens: "Projet et initiative" };

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost || !ownsDrawer("journal")) return;
  const e = o.e;
  ficheTop({ kind: "Échange", url: e?.url || o.partial?.url || null, side: true });
  renderSide("journal", sideHTML({ notes: [{ label: "Mes notes", text: e?.mesNotes }], notesHint: "Lues dans Notion, modifiables dans Notion", notesMissing: e ? "" : "Chargement…" }));
  if (!e) {
    const p = o.partial;
    drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : p ? `<div class="dh"><span class="ifmt">${ic(kindOf(p.format) || "note")}</span><div><h1>${esc(p.titre)}</h1><div class="sub">Chargement…</div></div></div>` : `<p class="empty">Chargement de l'entrée…</p>`;
    return;
  }
  const k = kindOf(e.format);
  const dt = new Date(e.date);
  const when = `${fd(e.date)}${/T/.test(e.date) ? " à " + dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ") : ""}`;
  const pj = e.projets.map((id) => ({ id, nom: e.projetsNoms[id] })), pi = e.pistes.map((id) => ({ id, nom: e.pistesNoms[id] }));
  const acts = o.actions || [];
  const cur = o.sec;
  if (cur === "liens") lireInitiatives();
  const body = { synthese: () => synthese(o, e, pj, pi, acts, when), cr: () => compteRendu(o, e), actions: () => actions(o, e, acts), liens: () => liens(o, e, pj, pi) }[cur]();
  drawerHost.innerHTML = `
    <div class="dh"><div class="dact">
      <button class="btn sm pri" data-jact="action">${ic("todo", "ic-sm")}Action</button></div>
      <span class="ifmt ${k ? "" : "none"}">${ic(k || "note")}</span><div style="flex:1;min-width:0"><h1>${esc(e.titre)}</h1>
      <div class="sub">${esc(when)}${e.duree ? ` · ${e.duree} min` : ""}</div>
      ${ppBand([
        e.format ? ppTxt(`${ic(k || "note", "ic-sm")}${esc(lab(e.format))}`, "", "Format, se modifie dans Notion") : ppTxt("Format non précisé", "pp-calc dash", "Format, se modifie dans Notion"),
        ...pj.map((x) => ppLink(`#/projets/${x.id}`, `${ic("folder", "ic-sm")}${esc(x.nom || "Projet")}`, "pj", "Ouvrir le projet")),
        pj.length ? "" : ppBtn(`data-jsec="liens"`, "+ Projet", "pp-add dash", "Rattacher à un projet"),
        ...pi.map((x) => ppLink(`#/pistes/${x.id}`, `${ic("target", "ic-sm")}${esc((x.nom || "Piste").trim())}`, "pi", "Ouvrir la piste")),
        pi.length ? "" : ppBtn(`data-jsec="liens"`, "+ Piste", "pp-add dash", "Rattacher à une piste"),
        ...e.tags.map((t) => ppTxt(esc(t))),
      ])}</div></div>
    ${ficheTabs([["synthese", SECS.synthese], ["cr", SECS.cr], ["actions", SECS.actions, acts.length], ["liens", SECS.liens]], cur, "data-jsec")}
    <section class="cbody" aria-label="${esc(SECS[cur])}"><h2 class="ch">${esc(SECS[cur])}</h2>${body}</section>
    <p class="small muted" style="margin-top:14px">${syncSpan(o.synchro, true)}.</p>`;
}

const contactChips = (e, ids = e.contacts) => ids.length ? `<div class="chips">${ids.map((id) => `<a class="chip" href="#/contacts/${id}">${ic("users", "ic-sm")}${esc(e.contactsNoms[id] || "Contact")}</a>`).join("")}</div>` : `<p class="small muted">Aucun contact lié.</p>`;
// Ligne d'action de l'artefact (actRow) : case à cocher, intitulé, P1, état, projet, type d'action, échéance.
function taskRow(t) {
  const d = isDone(t), e = S.open?.e;
  const pj = (t.projets || []).map((id) => e?.projetsNoms?.[id]).find(Boolean);
  return `<div class="arow ${d ? "done" : ""}"><button class="chk ${d ? "done" : ""}" data-jdone="${t.id}" ${S.busy ? "disabled" : ""} aria-label="${d ? "Rouvrir la tâche" : "Marquer comme terminée"} : ${esc(t.nom)}">${d ? ic("check", "ic-sm") : ""}</button>
    <a class="am" href="#/todo/${t.id}"><div class="an">${esc(t.nom)}</div><div class="ameta chips">${t.prio === "P1" && !d ? chip("P1", "red") : ""}${etatChip(t.etat)}${pj ? `<span class="chip pj">${ic("folder", "ic-sm")}${esc(pj)}</span>` : ""}${taSpan(t.typeAction)}</div></a>${t.echeance ? `<span class="due">${esc(fd(t.echeance))}</span>` : ""}</div>`;
}

// « La piste de cet échange est devenue le projet … » (relSuggest de l'artefact).
const suggestions = (e) => (e.suggestions || []).map((x) => `<div class="banner info">${ic("folder", "ic-sm")}<span>La piste de cet échange est devenue le projet <b>${esc(x.nom)}</b>.</span><button class="btn sm pri" data-jrelpj="${x.id}" ${S.busy ? "disabled" : ""}>Rattacher au projet</button></div>`).join("");

const crHTML = (o, e) => contenuHTML(o.contenu, { entree: o.id, url: e.url, erreur: o.cErr });

function synthese(o, e, pj, pi, acts, when) {
  return `<h3 class="sh">Compte rendu</h3>${crHTML(o, e)}
    ${suggestions(e)}
    ${acts.length ? `<h3 class="sh">Actions issues <button class="lnk" data-jsec="actions">${acts.length}</button></h3><div class="list">${acts.slice(0, 4).map(taskRow).join("")}</div>` : ""}
    ${saFold(e.syntheseAgent)}`;
}

function compteRendu(o, e) {
  const c = o.contenu;
  const lu = c?.lu_le ? new Date(c.lu_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ") : null;
  return `${crHTML(o, e)}
    <p class="small muted" style="margin-top:14px">${c ? `Lu dans Notion à ${esc(lu)}${c.suivies?.length ? `, dans ${c.suivies.length > 1 ? "les sous-pages" : "la sous-page"} ${c.suivies.map((x) => `« ${esc(x.titre)} »`).join(", ")}` : ""}. ` : ""}Le compte rendu se modifie dans Notion.
      <button class="lnk" data-jact="relire">Relire dans Notion</button> · <a href="${esc(e.url)}" target="_blank" rel="noopener">Ouvrir la page</a></p>`;
}

function actions(o, e, acts) {
  const inTwo = new Date(Date.now() + 2 * 864e5);
  const form = `<form class="form card" data-jform="action" style="margin-bottom:14px">
      <div class="fld"><label for="ja-n">Intitulé</label><input id="ja-n" required maxlength="2000" placeholder="Envoyer le compte rendu, relancer…"></div>
      <div class="frow"><div class="fld"><label for="ja-e">Échéance</label><input id="ja-e" type="date" value="${iso(inTwo)}"></div>
        <div class="fld"><label for="ja-p">Priorité</label><select id="ja-p"><option value="">Non définie</option><option>P1</option><option selected>P2</option><option>P3</option></select></div></div>
      <div class="fld"><label for="ja-t">Type d'action</label><select id="ja-t"><option value="">Non défini</option>${TYPES.map((t) => `<option>${esc(t)}</option>`).join("")}</select></div>
      <p class="small muted">La tâche est créée dans TO DO, liée à cet échange (Réunion source)${e.projets.length || e.pistes.length || e.contacts.length ? ", à ses projets, pistes et contacts" : ""}.</p>
      <div class="mfoot"><button class="btn sm" type="button" data-jact="noform">Annuler</button><button class="btn sm pri" type="submit" ${S.busy ? "disabled" : ""}>${ic("plus", "ic-sm")}Créer la tâche</button></div></form>`;
  return `${o.form ? form : `<div class="dact" style="margin-bottom:10px"><button class="btn sm pri" data-jact="action">${ic("plus", "ic-sm")}Nouvelle action</button></div>`}
    ${acts.length ? `<div class="list">${acts.map(taskRow).join("")}</div>` : `<p class="empty">Aucune action rattachée à cet échange.</p>`}`;
}

// Projet et initiative (relForm de l'artefact) : projet, initiative, piste, contacts. Chaque ajout ou retrait part
// aussitôt dans Notion, avec « Annuler ». Choisir une initiative rattache aussi à son projet.
function liens(o, e, pj, pi) {
  const ch = o.choix || { projets: [], pistes: [], contacts: [] };
  const field = (id, rel, label, ph, items, list, more, href, icn, cls) => jetonsHTML({
    id, label, placeholder: ph, busy: S.busy, locked: more,
    items: items.map((x) => ({ id: x.id, nom: x.nom || "Sans nom", href: href(x.id), icon: icn, cls })),
    choices: list.map((x) => ({ id: x.id, nom: x.nom, sub: x.etat || (x.issue && x.issue !== "En cours" ? x.issue : "") })),
    onAdd: (xid) => rattacher(rel, { add: [xid] }), onRemove: (xid) => rattacher(rel, { remove: [xid] }),
  });
  const cs = e.contacts.map((id) => ({ id, nom: e.contactsNoms[id] || "Contact" }));
  const ded = (e.contactsParPiste || []);
  return `${suggestions(e)}<div class="form">
    <div class="fld"><span class="lb">Projet</span>${field("jl-pr", "Projets", "Projets de l'échange", "Rattacher à un projet", pj, ch.projets, e.projetsMore, (id) => `#/projets/${id}`, "folder", "pj")}</div>
    <div class="fld"><label for="jl-th">Initiative</label>${initiativeSel(o, e)}<span class="small muted">Choisir une initiative rattache aussi à son projet.</span></div>
    <div class="fld"><span class="lb">Piste</span>${field("jl-pi", "Piste/Opportunité", "Pistes de l'échange", "Rattacher à une piste", pi, ch.pistes, e.pistesMore, (id) => `#/pistes/${id}`, "target", "")}</div>
    <div class="fld"><span class="lb">Contacts</span>${field("jl-c", "Contacts", "Contacts de l'échange", "Ajouter un contact", cs, (ch.contacts || []), e.contactsMore, (id) => `#/contacts/${id}`, "users", "")}</div>
    <p class="small muted">Chaque ajout ou retrait part tout de suite dans Notion. Une erreur ? La croix retire le lien, et « Annuler » le remet. Rien ne se supprime : retirer un lien ne touche ni le projet ni la piste.</p></div>
    ${ded.length ? `<h3 class="sh">Aussi liés par la piste</h3>${contactChips(e, ded)}` : ""}`;
}

// Liste des initiatives groupées par projet, projets de l'échange en tête (thOptions de l'artefact).
function initiativeSel(o, e) {
  const I = o.inits;
  const cur = (e.themesIds || [])[0] || "";
  if (!I || I.erreur) return `<select class="sel" id="jl-th" disabled><option>${I?.erreur ? esc(I.erreur) : "Chargement des initiatives…"}</option></select>`;
  const groups = new Map();
  for (const t of I.initiatives) { const pr = t.projets[0]; if (!pr || !I.projetsNoms[pr]) continue; if (!groups.has(pr)) groups.set(pr, []); groups.get(pr).push(t); }
  const order = [...groups.keys()].sort((a, b) => (e.projets.includes(b) - e.projets.includes(a)) || I.projetsNoms[a].localeCompare(I.projetsNoms[b], "fr"));
  const known = I.initiatives.some((t) => t.id === cur);
  return `<select class="sel" id="jl-th" data-jth="1" ${S.busy || e.themesMore ? "disabled" : ""}><option value="">Aucune initiative</option>${cur && !known ? `<option value="${esc(cur)}" selected>Initiative actuelle</option>` : ""}${order.map((pid) => `<optgroup label="${esc(I.projetsNoms[pid])}">${groups.get(pid).map((t) => `<option value="${t.id}" ${t.id === cur ? "selected" : ""}>${esc(t.nom)}</option>`).join("")}</optgroup>`).join("")}</select>`;
}

async function choisirInitiative(th) {
  const o = S.open; if (!o?.e || S.busy) return;
  const e = o.e, cur = e.themesIds || [];
  const changes = { "Thèmes": th ? { add: [th], remove: cur.filter((x) => x !== th) } : { remove: cur } };
  const t = th ? o.inits?.initiatives?.find((x) => x.id === th) : null;
  const pr = t?.projets?.[0];
  if (pr && !e.projets.includes(pr)) changes["Projets"] = { add: [pr] };
  await ecrire(changes, th ? (changes["Projets"] ? "Initiative et projet rattachés dans Notion." : "Initiative rattachée dans Notion.") : "Initiative retirée dans Notion.");
}

async function rattacher(rel, change, undoable = true) {
  const o = S.open; if (!o || S.busy) return;
  const eid = o.id;
  const ok = await ecrire({ [rel]: change }, undoable ? null : (change.add ? "Lien remis dans Notion." : "Lien retiré de nouveau."));
  if (ok && undoable) toastUndo(change.add ? "Rattaché dans Notion." : "Lien retiré dans Notion.", () => {
    const inv = change.add ? { remove: change.add } : { add: change.remove };
    if (S.open?.id === eid) rattacher(rel, inv, false);
    else journalApi.rattacher(eid, { [rel]: inv }).then(() => { toast("Lien rétabli dans Notion."); load(true); }, (err) => toast(err.message, "err"));
  });
}

/** Écrit des rattachements dans Notion ; la fiche suit la page renvoyée par Notion, sans relire le miroir. */
async function ecrire(changes, msg) {
  const o = S.open; if (!o || S.busy) return false;
  S.busy = true; renderDrawer();
  try {
    const r = await journalApi.rattacher(o.id, changes);
    if (msg) toast(msg);
    const nm = (list, id) => (list || []).find((x) => x.id === id)?.nom;
    const names = (ids, old, list, def) => Object.fromEntries(ids.map((id) => [id, old[id] ?? nm(list, id) ?? def]));
    Object.assign(o.e, {
      projets: r.entree.projets, pistes: r.entree.pistes, contacts: r.entree.contacts, themesIds: r.entree.themesIds,
      projetsNoms: names(r.entree.projets, o.e.projetsNoms, o.choix?.projets, "Projet"),
      pistesNoms: names(r.entree.pistes, o.e.pistesNoms, o.choix?.pistes, "Piste"),
      contactsNoms: { ...o.e.contactsNoms, ...names(r.entree.contacts, o.e.contactsNoms, o.choix?.contacts, "Contact") },
    });
    o.e.suggestions = (o.e.suggestions || []).filter((x) => !o.e.projets.includes(x.id));
    o.e.contactsParPiste = (o.e.contactsParPiste || []).filter((x) => !o.e.contacts.includes(x));
    load(true);
    return true;
  } catch (e) { toast(e.message, "err"); return false; }
  finally { S.busy = false; renderDrawer(); }
}

/** Case à cocher d'une action issue : même écriture que la vue TO DO. */
async function cocher(id) {
  const o = S.open; const t = o?.actions?.find((x) => x.id === id);
  if (!t || S.busy) return;
  S.busy = true; renderDrawer();
  try { const r = await setTaskEtat(id, isDone(t) ? "A faire" : "Terminé"); Object.assign(t, { etat: r?.etat ?? (isDone(t) ? "A faire" : "Terminé") }); }
  catch (e) { toast(e.message, "err"); }
  finally { S.busy = false; renderDrawer(); }
}

export function bindJournalEvents(root) {
  root.addEventListener("click", (e) => {
    const f = e.target.closest("[data-jf]");
    if (f) { const [k, v] = f.dataset.jf.split(/:(.*)/); S.f[k] = S.f[k] === v && k === "fmt" ? "" : v; render(); }
  });
  root.addEventListener("change", (e) => {
    const s = e.target.closest?.("[data-jfsel]");
    if (s) { S.f[s.dataset.jfsel] = s.value; render(); }
  });
  root.addEventListener("input", (e) => { if (e.target.id === "jf-q") { S.f.q = e.target.value; render(); } });
}

export function bindJournalDrawerEvents(root) {
  root.addEventListener("click", (e) => {
    if (!ownsDrawer("journal") || !S.open) return;
    const sec = e.target.closest("[data-jsec]");
    if (sec) { S.open.sec = sec.dataset.jsec; renderDrawer(); return; }
    const act = e.target.closest("[data-jact]")?.dataset.jact;
    if (act === "action") { S.open.sec = "actions"; S.open.form = true; renderDrawer(); $("#ja-n", root)?.focus(); return; }
    if (act === "noform") { S.open.form = false; renderDrawer(); return; }
    if (act === "relire") { S.open.contenu = null; renderDrawer(); lireContenu(S.open.id, true); return; }
    const dn = e.target.closest("[data-jdone]");
    if (dn && !dn.disabled) { cocher(dn.dataset.jdone); return; }
    const sp = e.target.closest("[data-jrelpj]");
    if (sp && !sp.disabled) { S.open.sec = "liens"; rattacher("Projets", { add: [sp.dataset.jrelpj] }); return; }
  });
  root.addEventListener("change", (e) => {
    const th = e.target.closest?.("[data-jth]");
    if (th && ownsDrawer("journal") && S.open) choisirInitiative(th.value);
  });
  bindContenu(root, () => { if (ownsDrawer("journal")) renderDrawer(); });
  root.addEventListener("submit", async (e) => {
    const form = e.target.closest?.("[data-jform='action']");
    if (!form || !ownsDrawer("journal") || !S.open) return;
    e.preventDefault();
    if (S.busy) return;
    const values = { "Nom": $("#ja-n", form).value.trim(), "Échéance": $("#ja-e", form).value, "Prio": $("#ja-p", form).value, "Type d'action": $("#ja-t", form).value };
    if (!values["Nom"]) return;
    S.busy = true; renderDrawer();
    try {
      const r = await journalApi.action(S.open.id, values);
      toast("Tâche créée dans TO DO.");
      S.open.form = false;
      S.open.actions = [...(S.open.actions || []), r.tache];
      S.busy = false;
      openEntree(S.open.id, true);
    } catch (err) {
      toast(err.message, "err"); S.busy = false; renderDrawer();
      // Le formulaire est redessiné : on remet ce qui avait été saisi.
      for (const [id, k] of [["#ja-n", "Nom"], ["#ja-e", "Échéance"], ["#ja-p", "Prio"], ["#ja-t", "Type d'action"]]) { const el = $(id, root); if (el) el.value = values[k]; }
    }
  });
}

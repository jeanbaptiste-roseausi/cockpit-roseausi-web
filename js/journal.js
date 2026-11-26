// Vue « Journal » (lot 5a, 26/11/2026) : entrées du Journal de bord du miroir, par semaine ou en calendrier,
// reliées aux contacts, pistes et projets. Fiche d'une entrée plein écran avec trois gestes : rattacher à un
// projet ou une piste, ouvrir le compte rendu (dans Notion, où il est rédigé), créer une action TO DO.
import { journalApi } from "./api.js";
import { interRow } from "./journee.js";
import { $, esc, ic, nrm, fd, toast, setDrawerOwner, ownsDrawer, ficheTop, renderSide, sideHTML, ficheTabs, etatChip, taSpan, chip, syncOf, syncSpan, staleBanner } from "./ui.js";

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
  const sec = keepSec && S.open?.id === id ? S.open.sec : "synthese";
  S.open = { id, e: S.open?.id === id ? S.open.e : null, partial: fromList, actions: S.open?.id === id ? S.open.actions : null, choix: S.open?.choix ?? S.data?.choix ?? null, error: null, sec, form: S.open?.id === id ? S.open.form : false };
  setDrawerOwner("journal");
  renderDrawer();
  try {
    const r = await journalApi.get(id);
    if (S.open?.id !== id) return;
    Object.assign(S.open, { e: r.entree, actions: r.actions, choix: r.choix, synchro: syncOf(r), error: null });
  } catch (e) { if (S.open?.id === id) S.open.error = e.message; }
  renderDrawer();
}

const SECS = { synthese: "Synthèse", actions: "Actions issues", liens: "Projet et piste" };

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
  const body = { synthese: () => synthese(o, e, pj, pi, acts, when), actions: () => actions(o, e, acts), liens: () => liens(o, e, pj, pi) }[cur]();
  drawerHost.innerHTML = `
    <div class="dh"><div class="dact">
      <button class="btn sm pri" data-jact="action">${ic("todo", "ic-sm")}Action</button>
      <button class="btn sm" data-jsec="liens">${ic("link", "ic-sm")}Rattacher</button>
      <a class="btn sm" href="${esc(e.url)}" target="_blank" rel="noopener" title="Le compte rendu est le contenu de la page Notion">${ic("book", "ic-sm")}Compte rendu</a></div>
      <span class="ifmt ${k ? "" : "none"}">${ic(k || "note")}</span><div style="flex:1;min-width:0"><h1>${esc(e.titre)}</h1>
      <div class="sub">${esc(when)}${e.format ? " · " + esc(lab(e.format)) : ""}${e.duree ? ` · ${e.duree} min` : ""}</div>
      <div class="chips" style="margin-top:8px">${pj.map((x) => `<a class="chip pj" href="#/projets/${x.id}">${ic("folder", "ic-sm")}${esc(x.nom || "Projet")}</a>`).join("")}${pi.map((x) => `<a class="chip pi" href="#/pistes/${x.id}">${ic("target", "ic-sm")}${esc((x.nom || "Piste").trim())}</a>`).join("")}${e.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div></div></div>
    ${!pj.length && !pi.length ? `<div class="banner dashed">${ic("alert", "ic-sm")}<span>Cet échange n'est rattaché ni à une piste ni à un projet. <button class="lnk" data-jsec="liens">Rattacher</button></span></div>` : ""}
    ${ficheTabs([["synthese", SECS.synthese], ["actions", SECS.actions, acts.length], ["liens", SECS.liens]], cur, "data-jsec")}
    <section class="cbody" aria-label="${esc(SECS[cur])}"><h2 class="ch">${esc(SECS[cur])}</h2>${body}</section>
    <p class="small muted" style="margin-top:14px">${syncSpan(o.synchro, true)}.</p>`;
}

const contactChips = (e) => e.contacts.length ? `<div class="chips">${e.contacts.map((id) => `<a class="chip" href="#/contacts/${id}">${ic("users", "ic-sm")}${esc(e.contactsNoms[id] || "Contact")}</a>`).join("")}</div>` : `<p class="small muted">Aucun contact lié.</p>`;
const taskRow = (t) => `<a class="arow ${t.etat === "Terminé" || t.etat === "Annulé" ? "done" : ""}" href="#/todo/${t.id}"><div class="am"><div class="an">${esc(t.nom)}</div><div class="ameta chips">${t.prio === "P1" ? chip("P1", "red") : ""}${etatChip(t.etat)}${taSpan(t.typeAction)}</div></div>${t.echeance ? `<span class="due">${esc(fd(t.echeance))}</span>` : ""}</a>`;

function synthese(o, e, pj, pi, acts, when) {
  return `<div class="sfacts">
      <div><span>Date</span><b>${esc(when)}</b></div>
      <div><span>Format</span><b>${e.format ? esc(lab(e.format)) : "Non précisé"}</b>${e.duree ? `<small>${e.duree} min</small>` : ""}</div>
      <div><span>Piste</span><b>${pi.length ? pi.map((x) => esc((x.nom || "").trim())).join(", ") : "Aucune"}</b></div>
      <div><span>Projet</span><b>${pj.length ? pj.map((x) => esc(x.nom || "")).join(", ") : "Aucun"}</b></div>
    </div>
    <h3 class="sh">Contacts</h3>${contactChips(e)}
    ${e.syntheseAgent ? `<h3 class="sh">Synthèse agent</h3><p class="notes">${esc(e.syntheseAgent)}</p>` : ""}
    <h3 class="sh">Actions issues <button class="lnk" data-jsec="actions">${acts.length}</button></h3>${acts.length ? `<div class="list">${acts.slice(0, 4).map(taskRow).join("")}</div>` : `<p class="small muted">Aucune action rattachée à cet échange.</p>`}
    <h3 class="sh">Compte rendu</h3><p class="small">Le compte rendu est le contenu de la page Notion de l'échange${e.idPlaud ? ", importé de Plaud" : ""}. Il n'est pas recopié dans le cockpit.</p>
    <div class="dact" style="margin-top:8px"><a class="btn sm" href="${esc(e.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Ouvrir le compte rendu dans Notion</a></div>`;
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

function liens(o, e, pj, pi) {
  const ch = o.choix || { projets: [], pistes: [] };
  const tok = (x, rel, href, icn) => `<span class="tok"><a class="tok-l" href="${href}">${ic(icn, "ic-sm")}<span>${esc((x.nom || "Sans nom").trim())}</span></a><button class="tok-x" data-jrm="${esc(rel)}:${x.id}" ${S.busy ? "disabled" : ""} aria-label="Retirer ${esc((x.nom || "").trim())}">×</button></span>`;
  const sel = (id, rel, list, have, ph) => `<select class="sel" id="${id}" data-jadd="${esc(rel)}" ${S.busy || e[rel === "Projets" ? "projetsMore" : "pistesMore"] ? "disabled" : ""}><option value="">${ph}</option>${list.filter((x) => !have.includes(x.id)).map((x) => `<option value="${x.id}">${esc(x.nom)}${x.etat ? ` (${esc(x.etat)})` : x.issue && x.issue !== "En cours" ? ` (${esc(x.issue)})` : ""}</option>`).join("")}</select>`;
  return `<div class="form">
    <div class="fld"><span class="lb">Projet</span><div class="chips">${pj.map((x) => tok(x, "Projets", `#/projets/${x.id}`, "folder")).join("") || `<span class="small muted">Aucun projet.</span>`}</div>
      <label class="sr" for="jl-pr">Rattacher à un projet</label>${sel("jl-pr", "Projets", ch.projets, e.projets, "Rattacher à un projet…")}</div>
    <div class="fld"><span class="lb">Piste</span><div class="chips">${pi.map((x) => tok(x, "Piste/Opportunité", `#/pistes/${x.id}`, "target")).join("") || `<span class="small muted">Aucune piste.</span>`}</div>
      <label class="sr" for="jl-pi">Rattacher à une piste</label>${sel("jl-pi", "Piste/Opportunité", ch.pistes, e.pistes, "Rattacher à une piste…")}</div>
    <div class="fld"><span class="lb">Contacts</span>${contactChips(e)}<span class="small muted">Les contacts se modifient dans Notion.</span></div>
    <p class="small muted">Chaque ajout ou retrait part tout de suite dans Notion. Rien ne se supprime : retirer un lien ne touche ni le projet ni la piste.</p></div>`;
}

async function rattacher(rel, change) {
  const o = S.open; if (!o || S.busy) return;
  S.busy = true; renderDrawer();
  try {
    const r = await journalApi.rattacher(o.id, { [rel]: change });
    toast(change.add ? "Rattaché dans Notion." : "Lien retiré dans Notion.");
    // La fiche suit la réponse de Notion (la page renvoyée après l'écriture), sans relire le miroir.
    const nm = (list, id) => (list || []).find((x) => x.id === id)?.nom;
    Object.assign(o.e, {
      projets: r.entree.projets, pistes: r.entree.pistes,
      projetsNoms: Object.fromEntries(r.entree.projets.map((id) => [id, o.e.projetsNoms[id] ?? nm(o.choix?.projets, id) ?? "Projet"])),
      pistesNoms: Object.fromEntries(r.entree.pistes.map((id) => [id, o.e.pistesNoms[id] ?? nm(o.choix?.pistes, id) ?? "Piste"])),
    });
    load(true);
  } catch (e) { toast(e.message, "err"); }
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
    const rm = e.target.closest("[data-jrm]");
    if (rm && !rm.disabled) { const [rel, id] = rm.dataset.jrm.split(/:(?=[^:]+$)/); rattacher(rel, { remove: [id] }); }
  });
  root.addEventListener("change", (e) => {
    const s = e.target.closest?.("[data-jadd]");
    if (s && s.value && ownsDrawer("journal")) rattacher(s.dataset.jadd, { add: [s.value] });
  });
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

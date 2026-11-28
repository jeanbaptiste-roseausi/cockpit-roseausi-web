// Vues « Ma journée » et « Vue d'ensemble » (lot 5a, 26/11/2026). Données du miroir Notion, calculées par la
// fonction journee. Lot 5b : rendez-vous (Google Agenda) et mails sans réponse (Gmail), lus par la fonction
// google et chargés à part : si Google ne répond pas, le reste de Ma journée s'affiche quand même.
// Gestes : terminer une tâche, changer son échéance (fonction todo).
// 28/11/2026 : avec un brief du matin du jour, la journée est bâtie sur le brief, section par section, comme dans
// l'artefact (couloirs, lignes sans tâche cochées dans le cockpit, listes latérales, « Replanifiée au », « Hors brief »).
// Sans brief du jour, bandeau « Pas encore de brief ce matin » et journée calculée depuis TO DO.
import { journeeApi, todoApi, googleApi, projetsIndex } from "./api.js";
import { segsHTML } from "./contenu.js";
import { gread, gstate, gsrc, rdvRow, filRow, jourLabel } from "./google.js";
import { $, esc, ic, fd, toast, taSpan, syncOf, syncSpan, staleBanner, chip } from "./ui.js";

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const today = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}` : `${m} min`;
const hm = (iso) => iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", " h ") : "";
const lab = (v) => (v == null ? "" : String(v).replace(/^[^\p{L}\p{N}]+/u, "").trim());
const stars = (p) => { const n = !p ? null : /🧊/u.test(p) ? 0 : ((String(p).match(/⭐/gu) || []).length || null); return n == null ? "" : n === 0 ? `<span class="chip st-encours">Froide</span>` : `<span class="stars" title="Priorité ${n} sur 3">${"★".repeat(n)}${"☆".repeat(3 - n)}</span>`; };

// ======================= Ma journée =======================

const J = { data: null, error: null, loading: false, open: null, busy: new Set(),
  // Brief du matin : réponse de GET /journee/brief, brief choisi quand il n'y en a pas aujourd'hui, ligne ouverte.
  b: null, bError: null, bLoading: false, briefId: null, ligne: null, geste: null, sideOpen: {}, items: [] };
let jHost = null;

export const journeeView = {
  id: "journee",
  label: "Ma journée",
  short: "Journée",
  icon: "home",
  async mount(container) { jHost = container; renderJ(); await Promise.all([loadJ(!!J.data), loadB(!!J.b)]); },
  open() {},
  close() {},
  reload: () => { loadJ(true); loadB(true, true); gread("agenda", googleApi.agenda, renderJ, { frais: true }); gread("a-traiter", googleApi.aTraiter, renderJ, { frais: true }); },
};

async function loadJ(silent = false) {
  if (J.loading) return;
  J.loading = true; if (!silent) { J.error = null; renderJ(); }
  const t0 = performance.now();
  try { J.data = await journeeApi.get(); J.error = null; J.ms = Math.round(performance.now() - t0); }
  catch (e) { if (!silent || !J.data) J.error = e.message; else toast(e.message, "err"); }
  finally { J.loading = false; renderJ(); }
}

async function loadB(silent = false, frais = false) {
  if (J.bLoading) return;
  J.bLoading = true; if (!silent) { J.bError = null; renderJ(); }
  try { J.b = await journeeApi.brief(J.briefId, frais); J.bError = null; }
  catch (e) { if (!silent || !J.b) { J.bError = e.message; J.b = null; } else toast(e.message, "err"); }
  finally { J.bLoading = false; renderJ(); }
}

const pjChip = (d, ids) => (ids || []).slice(0, 1).map((id) => d.projetsNoms?.[id] ? `<a class="chip pj" href="#/projets/${id}">${ic("folder", "ic-sm")}${esc(d.projetsNoms[id])}</a>` : "").join("");
const piChip = (d, ids) => (ids || []).slice(0, 1).map((id) => d.pistesNoms?.[id] ? `<a class="chip pi" href="#/pistes/${id}">${ic("target", "ic-sm")}${esc(d.pistesNoms[id].trim())}</a>` : "").join("");
const prioChip = (t) => t.prio === "P1" ? chip("P1", "red") : t.prio ? chip(t.prio) : "";

/** Ligne de tâche de la journée : case à cocher, intitulé, liens, durée, échéance modifiable, brouillon. */
function dayRow(d, t, { done = false } = {}) {
  const late = !done && t.echeance && t.echeance < d.date;
  const busy = J.busy.has(t.id);
  return `<div class="row dayrow ${done ? "done" : ""}">
    <button class="chk ${done ? "done" : ""}" data-jck="${t.id}" data-to="${done ? "A faire" : "Terminé"}" ${busy ? "disabled" : ""} aria-label="${done ? "Rouvrir" : "Marquer comme faite"} : ${esc(t.nom)}">${done ? ic("check", "ic-sm") : ""}</button>
    <div class="rm"><div class="rt">${done ? `<span class="dbadge">${ic("check", "ic-sm")}${t.etat === "Annulé" ? "Annulée" : "Faite"}</span>` : ""}<a class="lnk ttl" href="#/todo/${t.id}">${esc(t.nom)}</a></div>
      <div class="chips" style="margin-top:6px">${prioChip(t)}${pjChip(d, t.projets)}${piChip(d, t.pistes)}${taSpan(t.typeAction)}<span class="eff">${fmtMin(t.duree)}${t.dureeEstimee ? " estimées" : ""}</span>
        ${!done ? `<label class="chip echchip ${late ? "c-crit" : ""}" title="Changer l'échéance">${late ? "En retard, " : t.echeance === d.date ? "Aujourd'hui, " : ""}${t.echeance ? esc(fd(t.echeance)) : "Sans échéance"}<input type="date" data-jech="${t.id}" value="${esc(t.echeance || "")}" ${busy ? "disabled" : ""} aria-label="Changer l'échéance de ${esc(t.nom)}"></label>` : t.echeance ? `<span class="chip">${esc(fd(t.echeance))}</span>` : ""}</div></div>
    <div class="rr">${t.brouillon ? `<a class="btn sm ${t.bloc === "Prêt à envoyer" ? "pri" : ""}" href="${esc(t.brouillon)}" target="_blank" rel="noopener">Brouillon</a>` : `<a class="btn sm" href="#/todo/${t.id}">Ouvrir</a>`}</div></div>`;
}

/** Ligne courte (listes des voyants, prêtes à relire). */
const miniTask = (d, t) => `<a class="row" href="#/todo/${t.id}"><div class="rm"><div class="rt">${esc(t.nom)}</div><div class="chips" style="margin-top:4px">${prioChip(t)}${pjChip(d, t.projets)}${piChip(d, t.pistes)}${taSpan(t.typeAction)}</div></div><div class="rr">${t.echeance ? `<span class="due ${t.echeance < d.date ? "late" : t.echeance === d.date ? "today" : ""}">${t.echeance === d.date ? "Aujourd'hui" : esc(fd(t.echeance))}</span>` : `<span class="small muted">Sans échéance</span>`}</div></a>`;
const miniMission = (m) => `<a class="row" href="#/projets/${m.id}"><div class="rm"><div class="rt">${esc(m.nom)}</div><div class="rs">${m.meteo ? esc(lab(m.meteo)) : "Météo non renseignée"}</div></div><div class="rr"><b class="${m.niveau === "crit" ? "neg" : ""}">${Math.round((m.consomme ?? 0) * 100)} %</b></div></a>`;

function voyant(v) {
  const src = `<span class="vy-src">${esc(v.source)}, ${syncSpan({ source: "miroir", synchronise: v.synchronise })}</span>`;
  if (v.niveau === "vert") return `<div class="voyant vert" title="${esc(v.regle)}"><span class="vy-ok">${ic("check", "ic-sm")}</span><div><b>${esc(v.titre)}</b>${src}</div></div>`;
  const open = J.open === v.id;
  return `<button class="voyant ${v.niveau} ${open ? "on" : ""}" data-jvy="${v.id}" aria-expanded="${open}" title="${esc(v.regle)}">
    <span class="vy-n">${v.n}</span><div><b>${esc(v.titre)}</b><span class="vy-d">${esc(v.detail)}</span>${src}</div></button>`;
}

// ----------------------- Ma journée bâtie sur le brief (28/11/2026) -----------------------

const LANES = ["Prêt à envoyer", "À préparer", "À relancer", "À décider"];
const doneWord = (titre, t) => t && t.etat === "Annulé" ? "Annulée" : /arbitrer|décider/i.test(titre || "") ? "Décidé" : /Attendu/i.test(titre || "") ? "Reçu" : "Fait";
const jjmm = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
const hmShort = (iso) => iso ? `${fd(iso.slice(0, 10))} à ${hm(iso)}` : "";
const titreLigne = (l) => (l?.plain || "").split(". ")[0];
const ouverte = (t) => t && t.etat !== "Terminé" && t.etat !== "Annulé";

function linkedChips(autres) {
  const op = autres.filter(ouverte), fa = autres.filter((a) => a.etat === "Terminé"), an = autres.filter((a) => a.etat === "Annulé");
  const pl = (n, w) => `${n} tâche${n > 1 ? "s" : ""} liée${n > 1 ? "s" : ""}${w ? " " + w + (n > 1 ? "s" : "") : ""}`;
  const t = (l) => esc(l.map((a) => a.nom).join(", "));
  return (op.length ? `<span class="chip" title="${t(op)}">+ ${pl(op.length)}</span>` : "") + (fa.length ? `<span class="chip" title="${t(fa)}">${pl(fa.length, "faite")}</span>` : "") + (an.length ? `<span class="chip" title="${t(an)}">${pl(an.length, "annulée")}</span>` : "");
}

/** Ligne du brief ouverte : texte cité, section, deux gestes (En faire une tâche, Commenter dans le brief). */
function lignePanel(b, l, sec, { cochee = false, coche_le = null, commentaire_le = null } = {}) {
  const g = J.geste;
  const busy = J.busy.has(l.id);
  const form = g === "tache" ? `<form class="form bl-form" data-bltask="${l.id}">
      <div class="fld"><label for="bt-n">Intitulé</label><input id="bt-n" name="Nom" required value="${esc(titreLigne(l))}"></div>
      <div class="fld"><label for="bt-rec">Récap</label><textarea id="bt-rec" name="Récap">${esc(l.ctx || l.plain)}</textarea></div>
      <div class="frow"><div class="fld"><label for="bt-ta">Type d'action</label><select id="bt-ta" name="Type d'action" class="sel"><option value="">Non défini</option>${["Email", "Compte rendu", "Ordre du jour", "Relance", "Prise de contact", "Production", "Recherche", "Point à creuser"].map((x) => `<option>${esc(x)}</option>`).join("")}</select></div>
        <div class="fld"><label for="bt-bloc">Bloc</label><select id="bt-bloc" name="Bloc" class="sel">${LANES.map((x) => `<option ${x === laneDeSection(sec) ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div></div>
      <div class="frow"><div class="fld"><label for="bt-ech">Échéance</label><input type="date" id="bt-ech" name="Échéance" value="${esc(today())}"></div>
        <div class="fld"><label for="bt-dur">Durée estimée (min)</label><input type="number" min="0" step="5" id="bt-dur" name="Durée estimée (min)" value="15"></div></div>
      <div class="fld"><label for="bt-pr">Projet</label><select id="bt-pr" name="Projets" class="sel"><option value="">Aucun projet</option>${(J.projets || []).map((p) => `<option value="${esc(p.id)}">${esc(p.nom)}</option>`).join("")}</select></div>
      <p class="small muted">La tâche est créée dans TO DO, reliée au brief (Réunion source) et à cette ligne.</p>
      <div class="mfoot"><button class="btn sm" type="button" data-blgeste="">Fermer</button><button class="btn sm pri" type="submit" ${busy ? "disabled" : ""}>Créer la tâche dans Notion</button></div></form>`
    : g === "commentaire" ? `<form class="form bl-form" data-blcom="${l.id}"><div class="fld"><label for="bc-t">Commentaire sur cette ligne</label><textarea id="bc-t" name="texte" required placeholder="Pas pertinent, déjà fait, à reformuler…"></textarea></div>
      <p class="small muted">Le commentaire est ajouté au brief dans Notion, avec la ligne citée. Le brief n'est pas modifié.</p>
      <div class="mfoot"><button class="btn sm" type="button" data-blgeste="">Fermer</button><button class="btn sm pri" type="submit" ${busy ? "disabled" : ""}>Commenter dans Notion</button></div></form>` : "";
  return `<div class="blpanel">
    <div class="small muted">${esc(sec)} · <a href="${esc(b.brief.url)}" target="_blank" rel="noopener">${esc(b.brief.titre)}</a>${cochee && coche_le ? ` · coché le ${esc(hmShort(coche_le))}` : ""}${commentaire_le ? ` · commenté le ${esc(hmShort(commentaire_le))}` : ""}</div>
    <div class="pgbody bltext">${segsHTML(l.r, b.fiches)}</div>
    <p class="small muted">Cette ligne n'est reliée à aucune tâche TO DO. Tu peux en faire une tâche, la commenter dans le brief ou la cocher dans Ma journée.</p>
    ${g ? form : `<div class="dact"><button class="btn sm pri" data-blgeste="tache">${ic("todo", "ic-sm")}En faire une tâche</button><button class="btn sm" data-blgeste="commentaire">${ic("note", "ic-sm")}Commenter dans le brief</button></div>`}</div>`;
}
const laneDeSection = (sec) => /Brouillons/i.test(sec) ? "Prêt à envoyer" : /Relances/i.test(sec) ? "À relancer" : /arbitrer|décider/i.test(sec) ? "À décider" : "À préparer";

function briefRow(b, it, k) {
  const a = it.tache, l = it.ligne;
  const title = a ? a.nom : titreLigne(l);
  const sub = a ? (l ? l.ctx : "") : (l.plain.slice(title.length).replace(/^\.\s*/, ""));
  const late = it.echeance && !it.faite && it.echeance < b.date;
  const busy = a ? J.busy.has(a.id) : J.busy.has(l.id);
  const open = !a && J.ligne === l.id;
  const badges = (it.replan ? `<span class="dbadge replan">${ic("cal", "ic-sm")}Replanifiée au ${esc(jjmm(it.echeance))}</span>` : "")
    + (it.faite ? `<span class="dbadge ${a && a.etat === "Annulé" ? "annule" : ""}">${ic("check", "ic-sm")}${doneWord(it.couloir === "À décider" ? "décider" : "", a)}${!a && it.coche_le ? " le " + esc(hmShort(it.coche_le)) : ""}</span>` : "")
    + (it.horsBrief ? `<span class="dbadge hors">Hors brief</span>` : "") + (it.tacheCreee ? `<span class="dbadge">Tâche créée depuis le brief</span>` : "");
  const titre = a ? `<a class="lnk ttl" href="#/todo/${a.id}">${esc(title)}</a>` : `<button class="lnk ttl" data-blopen="${l.id}" aria-expanded="${open}">${esc(title)}</button>`;
  return `<div class="row dayrow ${it.faite ? "done" : it.replan ? "replan" : ""} ${open ? "open" : ""}">
    <button class="chk ${it.faite ? "done" : ""}" data-bdk="${k}" ${busy ? "disabled" : ""} aria-label="${it.faite ? "Rouvrir" : "Marquer comme fait"} : ${esc(title)}">${it.faite ? ic("check", "ic-sm") : ""}</button>
    <div class="rm"><div class="rt">${badges}${titre}</div>${sub && sub !== title ? `<div class="rs">${esc(sub.length > 220 ? sub.slice(0, 217) + "…" : sub)}</div>` : ""}
      <div class="chips" style="margin-top:6px">${a ? prioChip(a) + pjChip(b, a.projets) + piChip(b, a.pistes) : ""}<span class="eff">${fmtMin(it.duree)}${it.estimee ? " estimées" : ""}</span>${a && !it.faite ? `<label class="chip echchip ${late ? "c-crit" : ""}" title="Changer l'échéance">${late ? "En retard, " : it.echeance === b.date ? "Aujourd'hui, " : ""}${it.echeance ? esc(fd(it.echeance)) : "Sans échéance"}<input type="date" data-jech="${a.id}" value="${esc(it.echeance || "")}" ${busy ? "disabled" : ""} aria-label="Changer l'échéance de ${esc(title)}"></label>` : it.echeance ? `<span class="chip">${esc(fd(it.echeance))}</span>` : ""}${linkedChips(it.autres || [])}</div>
      ${open ? lignePanel(b, l, it.sec, { cochee: it.faite, coche_le: it.coche_le, commentaire_le: it.commentaire_le }) : ""}</div>
    <div class="rr">${it.brouillon ? `<a class="btn sm ${it.couloir === "Prêt à envoyer" ? "pri" : ""}" href="${esc(it.brouillon)}" target="_blank" rel="noopener">Brouillon</a>` : a ? `<a class="btn sm" href="#/todo/${a.id}">Ouvrir</a>` : `<button class="btn sm" data-blopen="${l.id}">${open ? "Fermer" : "Ouvrir"}</button>`}</div></div>`;
}

function sideList(b, c) {
  const open = J.sideOpen[c.cle];
  const vis = open ? c.lignes : c.lignes.slice(0, c.n);
  const left = c.lignes.filter((r) => !r.faite).length;
  const item = (r) => {
    const word = doneWord(c.titre, r.tache), l = r.ligne;
    const busy = J.busy.has(r.tache ? r.tache.id : l.id);
    const ck = c.cochable ? `<button class="chk ${r.faite ? "done" : ""}" ${r.tache ? `data-bsk="${r.tache.id}" data-to="${r.faite ? "A faire" : "Terminé"}"` : `data-blck="${l.id}" data-on="${r.faite ? "" : "1"}"`} ${busy ? "disabled" : ""} aria-label="${r.faite ? "Rouvrir" : "Marquer comme " + word.toLowerCase()}">${r.faite ? ic("check", "ic-sm") : ""}</button>` : "";
    const ouvre = !r.tache && J.ligne === l.id;
    const body = `${r.faite ? `<span class="dbadge ${r.tache && r.tache.etat === "Annulé" ? "annule" : ""}">${ic("check", "ic-sm")}${word}${!r.tache && r.coche_le ? " le " + esc(hmShort(r.coche_le)) : ""}</span>` : ""}<div class="dlt">${segsHTML(l.r, b.fiches)}</div>`;
    return `<div class="dli ${r.faite ? "done" : ""} ${c.cochable ? "ckable" : ""}">${ck}<div class="dlb-w">${r.tache ? `<a class="dlb" href="#/todo/${r.tache.id}">${body}</a>` : `<div class="dlb" data-blopen="${l.id}" tabindex="0" role="button" aria-expanded="${ouvre}">${body}</div>`}
      ${ouvre ? lignePanel(b, l, c.titre, { cochee: r.faite, coche_le: r.coche_le, commentaire_le: r.commentaire_le }) : ""}</div></div>`;
  };
  const cnt = c.cochable ? (left ? `${left} restant${left > 1 ? "s" : ""} sur ${c.lignes.length}` : "Tout est traité") : c.lignes.length;
  return `<section class="card daycard"><div class="card-h"><h2>${esc(c.titre)}</h2><span class="count">${cnt}</span></div>
    <div class="daylist">${vis.map(item).join("")}</div>
    ${c.lignes.length > c.n ? `<button class="lnk" data-bside="${c.cle}">${open ? "Réduire" : (c.lignes.length - c.n > 1 ? `Voir les ${c.lignes.length - c.n} autres` : "Voir le dernier")}</button>` : ""}</section>`;
}

/** Colonne principale et colonne latérale bâties sur le brief. */
function briefParts(b) {
  const items = [];
  const lanes = b.couloirs.map((c) => ({ ...c, items: c.items.map((it) => { items.push(it); return { it, k: items.length - 1 }; }) }));
  J.items = items;
  const n = (l) => l.items.filter((o) => !o.it.faite && !o.it.replan);
  const main = `<section class="card"><div class="card-h"><h2>À faire, dans l'ordre</h2><span class="small muted">par bloc, puis échéance et durée</span></div>
    ${lanes.map((l) => `<h3 class="lane">${LANES.indexOf(l.couloir) + 1}. ${esc(l.couloir)} <small>${n(l).length} · ${fmtMin(n(l).reduce((s, o) => s + o.it.duree, 0))}</small></h3><div class="list">${l.items.map((o) => briefRow(b, o.it, o.k)).join("")}</div>`).join("")}
    ${!items.length ? `<p class="empty">Le brief ne liste rien à faire aujourd'hui.</p>` : ""}
    <details class="more"><summary>Règles</summary><p class="small muted">${esc(b.regles.couloirs)} ${esc(b.regles.replan)} ${esc(b.regles.horsBrief)} ${esc(b.regles.lignes)}</p></details></section>`;
  return { main, side: b.cote.map((c) => sideList(b, c)).join("") };
}

function renderJ() {
  if (!jHost) return;
  const now = new Date();
  const head = `<section class="hello"><h1>Bonjour Jean-Baptiste</h1><p class="small muted">${JOURS[now.getDay()]} ${now.getDate()} ${MOIS[now.getMonth()]}</p>`;
  if (J.error) { jHost.innerHTML = head + `</section><div class="banner">${ic("alert", "ic-sm")}<span>${esc(J.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`; return; }
  const d = J.data;
  if (!d) { jHost.innerHTML = head + `<p>Chargement de ta journée depuis le miroir de Notion…</p></section>`; return; }
  const sy = syncOf(d);
  // Brief du matin : bâti sur le brief quand il y en a un aujourd'hui (ou quand un brief plus ancien est choisi).
  const bb = J.b && J.b.brief && J.b.couloirs ? J.b : null;
  const dernier = J.b?.dernier;
  const b = d.brief;
  let briefLine, bandeau = "";
  if (bb) {
    briefLine = `Brief ${bb.duJour ? "de " + hm(bb.brief.cree) : "du " + esc(jjmm(bb.brief.date))} · ${esc(bb.reunions.length ? bb.reunions.join(" · ") : "Aucune réunion aujourd'hui")} · <a class="lnk" href="${esc(bb.brief.url)}" target="_blank" rel="noopener">Ouvrir le brief dans Notion</a>`;
    if (!bb.duJour) bandeau = `<div class="banner info">${ic("info", "ic-sm")}<span>Pas encore de brief ce matin. Tu vois la journée du brief du ${esc(jjmm(bb.brief.date))}. <button class="lnk" data-bfrom="">Revenir à la journée calculée depuis TO DO</button></span></div>`;
  } else {
    briefLine = b ? `Brief ${b.date === d.date ? "de " + hm(b.cree) : "du " + esc(fd(b.date))} · <a class="lnk" href="${esc(b.url)}" target="_blank" rel="noopener">Ouvrir le brief dans Notion</a>` : "Aucun brief du matin dans le Journal de bord";
    if (J.bError) bandeau = `<div class="banner">${ic("alert", "ic-sm")}<span>Le brief du matin n'a pas pu être lu (${esc(J.bError)}). La journée est calculée depuis TO DO. <button class="lnk" data-bretry="">Réessayer</button></span></div>`;
    else if (J.b && !J.b.duJour) bandeau = `<div class="banner info nobrief">${ic("info", "ic-sm")}<span><b>Pas encore de brief ce matin.</b> La journée est calculée depuis TO DO.${dernier ? ` <button class="lnk" data-bfrom="${esc(dernier.id)}">Voir la journée du brief du ${esc(jjmm(dernier.date))}</button>` : ""}</span></div>`;
    else if (!J.b && J.bLoading) bandeau = `<p class="small muted">Lecture du brief du matin…</p>`;
  }
  const j = d.jour;
  const opened = d.voyants.find((v) => v.id === J.open && v.niveau !== "vert");
  // Lot 5b : agenda et mails, chacun avec sa source et son heure ; une panne de Google reste dans son bloc.
  const ag = gread("agenda", googleApi.agenda, renderJ), ml = gread("a-traiter", googleApi.aTraiter, renderJ);
  const agSt = gstate(ag, { quoi: "Google Agenda" }), mlSt = gstate(ml, { quoi: "Gmail" });
  const prochain = ag.data?.rendezVous.find((r) => !r.journee && r.jour === d.date && Date.parse(r.fin || r.debut) > Date.now());
  const parJour = ag.data ? ag.data.jours.map((j) => [j, ag.data.rendezVous.filter((r) => r.jour === j)]) : [];
  const parts = bb ? briefParts(bb) : null;
  const prog = bb ? `<div class="dp1"><div class="dpl"><b>Ta journée, ${bb.faites} sur ${bb.total} fait${bb.faites > 1 ? "s" : ""}</b><span>reste environ ${fmtMin(bb.resteMin)}${bb.replanifiees ? ` · ${bb.replanifiees} replanifiée${bb.replanifiees > 1 ? "s" : ""}` : ""}${bb.horsBrief ? ` · ${bb.horsBrief} hors brief` : ""}</span></div>
    <div class="gauge"><i style="width:${bb.total ? Math.round(bb.faites / bb.total * 100) : 0}%"></i></div></div>`
    : `<div class="dp1"><div class="dpl"><b>Ta journée, ${j.faites} sur ${j.total} faite${j.faites > 1 ? "s" : ""}</b><span>reste environ ${fmtMin(j.resteMin)} · ${j.enRetard} en retard, ${j.duJour} du jour</span></div>
    <div class="gauge"><i style="width:${j.total ? Math.round(j.faites / j.total * 100) : 0}%"></i></div></div>`;
  const googleSide = `<section class="card daycard gcard" aria-label="Rendez-vous"><div class="card-h"><h2>Rendez-vous</h2>${ag.data ? `<span class="count">${ag.data.rendezVous.length}</span>` : ""}</div>
        ${agSt ?? `<p class="small muted" style="margin-bottom:4px">Aujourd'hui et les deux jours suivants. ${gsrc(ag.data)}</p>
          ${parJour.map(([j, l]) => `<h3 class="lane">${esc(jourLabel(j, d.date))} <small>${l.length || "aucun"}</small></h3>${l.length ? `<div class="list">${l.map(rdvRow).join("")}</div>` : ""}`).join("")}
          <details class="more"><summary>Règle des liens</summary><p class="small muted">${esc(ag.data.regle)}</p></details>`}</section>
      <section class="card daycard gcard" aria-label="Mails sans réponse"><div class="card-h"><h2>Mails sans réponse</h2>${ml.data ? `<span class="count">${ml.data.fils.length}</span>` : ""}<a class="lnk" href="#/a-traiter">À traiter</a></div>
        ${mlSt ?? `<p class="small muted" style="margin-bottom:4px">Depuis deux jours ouvrés. ${gsrc(ml.data)}</p>
          <div class="list">${ml.data.fils.slice(0, 3).map((f) => filRow(f, { attente: true })).join("") || `<p class="empty">Aucun mail en attente.</p>`}</div>
          ${ml.data.fils.length > 3 ? `<a class="lnk" href="#/a-traiter">Voir les ${ml.data.fils.length - 3} autres</a>` : ""}`}</section>`;
  const todoMain = `<section class="card"><div class="card-h"><h2>Tes priorités</h2><span class="count">${d.priorites.length}</span></div>
        <p class="small muted" style="margin-bottom:4px">${esc(d.regles.priorites)}</p>
        <div class="list">${d.priorites.map((t) => dayRow(d, t)).join("") || `<p class="empty">Aucune tâche P1 ou P2 due.</p>`}</div></section>
      <section class="card"><div class="card-h"><h2>À faire, dans l'ordre</h2><span class="small muted">par bloc, puis échéance et durée</span></div>
        ${d.jour.blocs.map((l, n) => l.taches.length || l.faites.length ? `<h3 class="lane">${n + 1}. ${esc(l.bloc)} <small>${l.taches.length} · ${fmtMin(l.taches.reduce((s, t) => s + t.duree, 0))}</small></h3>
          <div class="list">${l.taches.map((t) => dayRow(d, t)).join("")}${l.faites.map((t) => dayRow(d, t, { done: true })).join("")}</div>` : "").join("")}
        ${!j.total ? `<p class="empty">Aucune tâche due aujourd'hui ni en retard.</p>` : ""}
        <p class="small muted" style="margin-top:8px">${esc(d.regles.jour)} ${esc(d.regles.duree)}</p></section>`;
  const todoSide = `<section class="card daycard"><div class="card-h"><h2>Relances de pistes échues</h2><span class="count">${d.relances.length}</span></div>
        <div class="list">${d.relances.map((r) => `<a class="row" href="#/pistes/${r.id}"><div class="rm"><div class="rt">${esc(r.nom.trim())}</div><div class="rs">${esc(r.tache.nom)}</div><div class="chips" style="margin-top:4px">${r.etape ? `<span class="chip">${esc(lab(r.etape))}</span>` : ""}</div></div><div class="rr"><span class="due ${r.joursRetard > 0 ? "late" : "today"}">${r.joursRetard > 0 ? esc(fd(r.tache.echeance)) : "Aujourd'hui"}</span>${stars(r.prio)}</div></a>`).join("") || `<p class="empty">Aucune relance échue.</p>`}</div>
        <p class="small muted" style="margin-top:6px">${esc(d.regles.relances)}${d.pistesSansTache ? ` ${d.pistesSansTache} pistes actives n'ont aucune tâche ouverte : <a class="lnk" href="#/pistes">Prospection</a>.` : ""}</p></section>
      <section class="card daycard"><div class="card-h"><h2>Prêtes à relire</h2><span class="count">${d.relire.length}</span></div>
        <div class="list">${d.relire.map((t) => miniTask(d, t)).join("") || `<p class="empty">Rien à relire.</p>`}</div></section>`;
  jHost.innerHTML = head + `<p>${briefLine} · ${syncSpan(sy)}${J.loading || J.bLoading ? ", mise à jour…" : ""}</p></section>
  ${staleBanner(sy)}${bandeau}
  <section class="voyants" aria-label="Voyants">${d.voyants.map(voyant).join("")}</section>
  ${opened ? `<section class="card vy-list"><div class="card-h"><h2>${esc(opened.titre)}</h2><span class="count">${opened.n}</span><button class="lnk" data-jvy="${opened.id}">Fermer</button></div>
    <p class="small muted" style="margin-bottom:6px">${esc(opened.regle)}</p>
    <div class="list">${opened.items.map((x) => opened.id === "budget" ? miniMission(x) : miniTask(d, x)).join("")}</div></section>` : ""}
  <section class="dayprog">${prog}
    <div class="dpnext"><span class="small muted">Prochain rendez-vous</span>${agSt ? `<b class="small">${ag.error ? (ag.error.code === "google_non_relie" ? "Google n'est pas relié" : "Agenda indisponible") : "Lecture de l'agenda…"}</b>` : prochain ? `<b>${esc(prochain.titre)}</b><span class="small">${esc(new Date(prochain.debut).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", " h "))}${prochain.fiches[0] ? " · " + esc(prochain.fiches[0].nom) : ""}</span>` : `<b class="small">Plus de rendez-vous aujourd'hui</b>`}</div>
    ${bb && bb.prochainRdv ? `<div class="dpnext"><span class="small muted">Prochain rendez-vous à préparer (brief)</span><b>${esc(bb.prochainRdv.length > 140 ? bb.prochainRdv.slice(0, 137) + "…" : bb.prochainRdv)}</b></div>` : ""}</section>
  <div class="daygrid">
    <div class="daymain">${parts ? parts.main : todoMain}</div>
    <div class="dayside">${parts ? parts.side : todoSide}${googleSide}</div>
  </div>`;
}

async function setTask(id, changes, msg) {
  J.busy.add(id); renderJ();
  try { await todoApi.update(id, changes); toast(msg); await Promise.all([loadJ(true), J.b?.couloirs ? loadB(true) : null]); }
  catch (e) { toast(e.message, "err"); }
  finally { J.busy.delete(id); renderJ(); }
}

/** Coche d'une ligne du brief : la tâche (et ses tâches liées) dans Notion, sinon la ligne dans le cockpit. */
async function cocherItem(k) {
  const it = J.items[k]; if (!it) return;
  if (it.tache) {
    const acts = [it.tache, ...(it.autres || [])];
    const to = it.faite ? "A faire" : "Terminé";
    const cibles = acts.filter((x) => to === "Terminé" ? ouverte(x) : x.etat === "Terminé");
    for (const x of cibles) J.busy.add(x.id);
    renderJ();
    try {
      for (const x of cibles) await todoApi.update(x.id, { "État": to });
      toast(to === "Terminé" ? (cibles.length > 1 ? `${cibles.length} tâches terminées dans Notion.` : "Tâche terminée dans Notion.") : "Tâche rouverte dans Notion.");
      await Promise.all([loadJ(true), loadB(true)]);
    } catch (e) { toast(e.message, "err"); }
    finally { for (const x of cibles) J.busy.delete(x.id); renderJ(); }
    return;
  }
  await cocherLigne(it.ligne.id, !it.faite);
}

async function cocherLigne(ligne, on) {
  if (!J.b?.brief) return;
  J.busy.add(ligne); renderJ();
  try { await journeeApi.cocher(J.b.brief.id, ligne, on); await loadB(true); }
  catch (e) { toast(e.message, "err"); }
  finally { J.busy.delete(ligne); renderJ(); }
}

async function ligneTache(form) {
  const ligne = form.dataset.bltask, f = new FormData(form);
  const values = {};
  for (const [k, v] of f.entries()) if (String(v).trim()) values[k] = String(v).trim();
  if (values["Projets"]) values["Projets"] = [values["Projets"]]; else delete values["Projets"];
  J.busy.add(ligne); renderJ();
  try { const r = await journeeApi.tacheLigne(J.b.brief.id, ligne, values); toast(`Tâche « ${r.tache.nom} » créée dans Notion et reliée à la ligne.`); J.geste = null; J.ligne = null; await Promise.all([loadB(true), loadJ(true)]); }
  catch (e) { toast(e.message, "err"); }
  finally { J.busy.delete(ligne); renderJ(); }
}

async function ligneCommentaire(form) {
  const ligne = form.dataset.blcom, texte = String(new FormData(form).get("texte") || "").trim();
  if (!texte) return;
  J.busy.add(ligne); renderJ();
  try { await journeeApi.commenterLigne(J.b.brief.id, ligne, texte); toast("Commentaire ajouté au brief dans Notion."); J.geste = null; await loadB(true); }
  catch (e) { toast(e.message, "err"); }
  finally { J.busy.delete(ligne); renderJ(); }
}

// ======================= Vue d'ensemble =======================

const E = { data: null, error: null, loading: false };
let eHost = null;

export const ensembleView = {
  id: "ensemble",
  label: "Vue d'ensemble",
  short: "Ensemble",
  icon: "board",
  async mount(container) { eHost = container; renderE(); await loadE(!!E.data); },
  open() {},
  close() {},
  reload: () => loadE(true),
};

async function loadE(silent = false) {
  if (E.loading) return;
  E.loading = true; if (!silent) { E.error = null; renderE(); }
  try { E.data = await journeeApi.ensemble(); E.error = null; }
  catch (e) { if (!silent || !E.data) E.error = e.message; else toast(e.message, "err"); }
  finally { E.loading = false; renderE(); }
}

const METEO_CL = [[/vert/i, "c-good"], [/surveiller/i, "c-warn"], [/difficult/i, "c-crit"]];
const meteoChip = (m) => m ? `<span class="chip ${METEO_CL.find(([re]) => re.test(m))?.[1] ?? ""}">${esc(lab(m))}</span>` : "";

export function interRow(e, d) {
  const pj = e.projets.map((id) => d.projetsNoms?.[id]).find(Boolean), pjId = e.projets.find((id) => d.projetsNoms?.[id]);
  const pi = e.pistes.map((id) => d.pistesNoms?.[id]).find(Boolean), piId = e.pistes.find((id) => d.pistesNoms?.[id]);
  const k = /atelier/i.test(e.format || "") ? "atelier" : /r[ée]union/i.test(e.format || "") ? "reunion" : /call|appel/i.test(e.format || "") ? "call" : null;
  const dt = e.date ? new Date(e.date) : null;
  const when = dt ? `${fd(e.date)}${/T/.test(e.date) ? " à " + dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ") : ""}` : "";
  return `<a class="row" href="#/journal/${e.id}"><span class="ifmt sm ${k ? "" : "none"}">${ic(k || "note", "ic-sm")}</span>
    <div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(when)}${e.format ? " · " + esc(lab(e.format)) : ""}${e.duree ? ` · ${e.duree} min` : ""}</div>
    <div class="chips" style="margin-top:6px">${pi ? `<span class="chip pi">${ic("target", "ic-sm")}${esc(pi.trim())}</span>` : ""}${pj ? `<span class="chip pj">${ic("folder", "ic-sm")}${esc(pj)}</span>` : ""}${!e.projets.length && !e.pistes.length ? `<span class="chip dash">Non rattachée</span>` : ""}${e.contacts.length ? `<span class="chip">${e.contacts.length} contact${e.contacts.length > 1 ? "s" : ""}</span>` : ""}${e.actions ? `<span class="chip">${e.actions} action${e.actions > 1 ? "s" : ""}</span>` : ""}</div></div></a>`;
}

function renderE() {
  if (!eHost) return;
  const head = `<section class="hello">`;
  if (E.error) { eHost.innerHTML = head + `</section><div class="banner">${ic("alert", "ic-sm")}<span>${esc(E.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`; return; }
  const d = E.data;
  if (!d) { eHost.innerHTML = head + `<p>Chargement depuis le miroir de Notion…</p></section>`; return; }
  const sy = syncOf(d), k = d.kpis;
  const relRow = (r) => `<a class="row" href="#/pistes/${r.id}"><div class="rm"><div class="rt">${esc(r.nom.trim())}</div><div class="rs clamp2">${esc(r.tache.nom)}</div><div class="chips" style="margin-top:6px">${r.etape ? `<span class="chip">${esc(lab(r.etape))}</span>` : ""}${r.issue && lab(r.issue) !== "En cours" ? `<span class="chip">${esc(lab(r.issue))}</span>` : ""}</div></div><div class="rr"><span class="due ${r.tache.echeance < d.date ? "late" : r.tache.echeance === d.date ? "today" : ""}">${r.tache.echeance === d.date ? "Aujourd'hui" : esc(fd(r.tache.echeance))}</span>${stars(r.prio)}</div></a>`;
  const actRow = (t) => `<a class="arow" href="#/todo/${t.id}"><div class="am"><div class="an">${esc(t.nom)}</div><div class="ameta chips">${t.prio === "P1" ? chip("P1", "red") : ""}${pjChip(d, t.projets)}${piChip(d, t.pistes)}${taSpan(t.typeAction)}</div></div><span class="due ${t.echeance < d.date ? "late" : "today"}">${t.echeance === d.date ? "Aujourd'hui" : esc(fd(t.echeance))}</span></a>`;
  eHost.innerHTML = head + `<p class="muted">${syncSpan(sy, true)}${E.loading ? ", mise à jour…" : ""}</p></section>
  ${staleBanner(sy)}
  <div class="kpis">
    <a class="kpi" href="#/pistes"><b>${k.pistesActives}</b><span>Pistes actives</span></a>
    <a class="kpi ${k.relancesDues ? "alert" : ""}" href="#/pistes"><b>${k.relancesDues}</b><span>Relances dues</span></a>
    <a class="kpi ${k.actionsRetard ? "alert" : ""}" href="#/todo"><b>${k.actionsRetard}</b><span>Actions en retard</span></a>
    <a class="kpi ${k.missionsDifficulte ? "alert" : ""}" href="#/projets"><b>${k.missionsDifficulte}<small> / ${k.missions}</small></b><span>Missions en difficulté</span></a>
  </div>
  <div class="grid2">
    <section class="card"><div class="card-h"><h2>À relancer</h2><span class="count">${d.aRelancer.length}</span><a class="lnk" href="#/pistes">Toutes les pistes</a></div>
      <p class="small muted" style="margin-bottom:6px">Prochaine tâche de la piste due dans les sept jours. ${esc(d.regles.relances)}</p>
      <div class="list">${d.aRelancer.map(relRow).join("") || `<p class="empty">Rien à relancer cette semaine.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Actions du jour et en retard</h2><span class="count">${d.actionsTotal}</span><a class="lnk" href="#/todo">Toutes</a></div>
      ${d.relire ? `<div class="banner info" style="margin-bottom:8px">${ic("info", "ic-sm")}<span>${d.relire} tâche${d.relire > 1 ? "s" : ""} prête${d.relire > 1 ? "s" : ""} à relire.</span></div>` : ""}
      <div class="list">${d.actions.map(actRow).join("") || `<p class="empty">Aucune action due.</p>`}</div>
      ${d.actionsTotal > d.actions.length ? `<a class="lnk" href="#/journee">Voir les ${d.actionsTotal - d.actions.length} autres dans Ma journée</a>` : ""}</section>
    <section class="card"><div class="card-h"><h2>Météo des missions</h2><a class="lnk" href="#/projets">Projets</a></div>
      <p class="small muted" style="margin-bottom:6px">${esc(d.regles.meteo)}</p>
      <div class="list">${d.meteo.map((m) => `<a class="row" href="#/projets/${m.id}"><div class="rm"><div class="rt">${esc(m.nom)}</div><div class="rs clamp2">${esc(m.motif || "")}</div></div><div class="rr">${meteoChip(m.meteo)}${m.dateJalon ? `<span class="due">Jalon ${esc(fd(m.dateJalon))}</span>` : ""}</div></a>`).join("") || `<p class="empty">Aucune mission en cours avec une météo.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Dernières interactions</h2><a class="lnk" href="#/journal">Journal</a></div>
      <div class="list">${d.interactions.map((e) => interRow(e, d)).join("") || `<p class="empty">Aucune interaction.</p>`}</div></section>
    <section class="card"><div class="card-h"><h2>Pistes prioritaires sans nouvelles</h2><span class="count">${d.sansNouvelles.length}</span></div>
      <p class="small muted" style="margin-bottom:6px">${esc(d.regles.sansNouvelles)}</p>
      <div class="list">${d.sansNouvelles.map((p) => `<a class="row" href="#/pistes/${p.id}"><div class="rm"><div class="rt">${esc(p.nom.trim())}</div><div class="chips" style="margin-top:6px">${p.etape ? `<span class="chip">${esc(lab(p.etape))}</span>` : ""}<span class="chip">${p.dernierEchange ? "Dernier échange " + esc(fd(p.dernierEchange)) : "Aucun échange au journal"}</span></div></div><div class="rr">${stars(p.prio)}</div></a>`).join("") || `<p class="empty">Toutes les pistes prioritaires ont eu un échange récent.</p>`}</div></section>
  </div>`;
}

// ======================= Événements =======================

export function bindJourneeEvents(root) {
  root.addEventListener("click", (e) => {
    const vy = e.target.closest("[data-jvy]");
    if (vy) { J.open = J.open === vy.dataset.jvy ? null : vy.dataset.jvy; renderJ(); return; }
    const ck = e.target.closest("[data-jck]");
    if (ck && !ck.disabled) { setTask(ck.dataset.jck, { "État": ck.dataset.to }, ck.dataset.to === "Terminé" ? "Tâche terminée dans Notion." : "Tâche rouverte dans Notion."); return; }
    // Ma journée bâtie sur le brief (28/11/2026)
    const bdk = e.target.closest("[data-bdk]");
    if (bdk && !bdk.disabled) { cocherItem(+bdk.dataset.bdk); return; }
    const bsk = e.target.closest("[data-bsk]");
    if (bsk && !bsk.disabled) { setTask(bsk.dataset.bsk, { "État": bsk.dataset.to }, bsk.dataset.to === "Terminé" ? "Tâche terminée dans Notion." : "Tâche rouverte dans Notion."); return; }
    const blck = e.target.closest("[data-blck]");
    if (blck && !blck.disabled) { cocherLigne(blck.dataset.blck, !!blck.dataset.on); return; }
    const g = e.target.closest("[data-blgeste]");
    if (g) { J.geste = g.dataset.blgeste || null; if (J.geste === "tache" && !J.projets) projetsIndex().then((p) => { J.projets = p.filter((x) => !x.etat || /En cours|Prospect/i.test(x.etat)); renderJ(); }).catch(() => {}); renderJ(); return; }
    const bo = e.target.closest("[data-blopen]");
    if (bo && !e.target.closest("a, .blpanel")) { J.ligne = J.ligne === bo.dataset.blopen ? null : bo.dataset.blopen; J.geste = null; renderJ(); return; }
    const bs = e.target.closest("[data-bside]");
    if (bs) { J.sideOpen[bs.dataset.bside] = !J.sideOpen[bs.dataset.bside]; renderJ(); return; }
    const bf = e.target.closest("[data-bfrom]");
    if (bf) { J.briefId = bf.dataset.bfrom || null; J.b = null; J.ligne = null; loadB(); return; }
    if (e.target.closest("[data-bretry]")) { loadB(); return; }
  });
  root.addEventListener("keydown", (e) => {
    const bo = e.target.closest?.("[data-blopen][role=button]");
    if (bo && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); bo.click(); }
  });
  root.addEventListener("submit", (e) => {
    const t = e.target.closest?.("form[data-bltask]"), c = e.target.closest?.("form[data-blcom]");
    if (t) { e.preventDefault(); ligneTache(t); }
    else if (c) { e.preventDefault(); ligneCommentaire(c); }
  });
  root.addEventListener("change", (e) => {
    const inp = e.target.closest?.("input[data-jech]");
    if (inp && inp.value) setTask(inp.dataset.jech, { "Échéance": inp.value }, `Échéance au ${fd(inp.value)}, dans Notion.`);
  });
}

export { today };

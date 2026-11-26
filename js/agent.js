// Fil Agent des fiches Contact et Tâche (lot 3), dans le panneau de droite, sous Mes notes.
// Le panneau est redessiné par la vue propriétaire (renderSide) ; ce module y monte le fil à chaque fois,
// depuis son propre état (fil déjà lu, brouillon, type choisi), sans relire le serveur.
// L'agent écrit par la fonction serveur « agent » ; la page ne voit jamais la clé de l'API.
import { agentApi } from "./api.js";
import { $, esc, ic, fd, toast, setAgentHook } from "./ui.js";

const TYPES = {
  question: { l: "Question", ic: "info", ph: "Pose ta question. L'agent répond sans rien modifier." },
  remarque: { l: "Remarque", ic: "note", ph: "Une précision ou un changement. L'agent le range dans la fiche et te montre ce qui a changé." },
  livrable: { l: "Livrable", ic: "book", ph: "Décris le livrable voulu. La demande est enregistrée, traitée au lot 4." },
};
const SUGG = {
  tache: ["Où en est cette tâche ?", "Replanifie-la à vendredi", "Qu'est-ce qui bloque et que faut-il faire ensuite ?"],
  contact: ["Résume notre relation et ce qui est en cours", "Quelles sont mes prochaines actions avec ce contact ?", "Note une mise en lien"],
};

// État par fiche : { fil, info, busy, err, draft, type }
const F = new Map();
const st = (id) => F.get(id) ?? F.set(id, { fil: null, info: null, busy: false, err: "", draft: "", type: "question" }).get(id);

/** Fiche affichée d'après l'adresse : #/contacts/<id> ou #/todo/<id>. */
function ficheCourante() {
  const [, view, id] = (location.hash || "").split("/");
  if (!id || id === "new" || !/^[0-9a-f-]{32,36}$/i.test(id)) return null;
  if (view === "contacts") return { type: "contact", id };
  if (view === "todo") return { type: "tache", id };
  return null;
}

const usd = (x) => `${Number(x || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const usdFin = (x) => `${Number(x || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 4 })} $`;
const nb = (n) => Number(n || 0).toLocaleString("fr-FR");
const jetons = (e) => e.jetons_entree + e.jetons_sortie + e.jetons_cache_lecture + e.jetons_cache_ecriture;
const heure = (iso) => { const d = new Date(iso); return `${fd(iso)} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`; };

/** Texte de l'agent : paragraphes et listes simples, tout échappé. */
function texte(t) {
  const blocs = String(t || "").split(/\n{2,}/);
  return blocs.map((b) => {
    const l = b.split("\n");
    if (l.every((x) => /^\s*[-•]\s+/.test(x))) return `<ul>${l.map((x) => `<li>${esc(x.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${l.map(esc).join("<br>")}</p>`;
  }).join("");
}

const val = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) ? "vide" : Array.isArray(v) ? `${v.length} lien${v.length > 1 ? "s" : ""}` : /^\d{4}-\d\d-\d\d$/.test(String(v)) ? fd(String(v)) : String(v).length > 80 ? String(v).slice(0, 80) + "…" : String(v);
const lien = (a) => a.cible_id ? `<a href="#/${a.cible_base === "todo" ? "todo" : "contacts"}/${esc(a.cible_id)}">${esc(a.cible_nom || "la fiche")}</a>` : esc(a.cible_nom || "");

function actionHTML(a) {
  let quoi;
  if (a.genre === "modifier") {
    const rel = Array.isArray(a.ancienne) || Array.isArray(a.nouvelle);
    quoi = `<b>${esc(a.propriete)}</b> de ${lien(a)}${rel ? ` : liens modifiés (${val(a.ancienne)} → ${val(a.nouvelle)})` : `<span class="ag-diff"><del>${esc(val(a.ancienne))}</del> ${ic("arrow", "ic-sm")} <ins>${esc(val(a.nouvelle))}</ins></span>`}`;
  } else if (a.genre === "creer_tache") quoi = `Tâche créée : ${lien(a)}`;
  else if (a.genre === "creer_contact") quoi = `Contact créé : ${lien(a)}`;
  else if (a.genre === "relier") quoi = `Mise en lien : ${esc(a.nouvelle?.recommandeurNom || "un contact")} a recommandé ${lien(a)}`;
  else quoi = `Proposé : <b>${esc(a.propriete)}</b> de ${lien(a)}<span class="ag-diff"><del>${esc(val(a.ancienne))}</del> ${ic("arrow", "ic-sm")} <ins>${esc(val(a.nouvelle))}</ins></span>`;
  const btn = a.statut === "faite" && ["modifier", "creer_tache", "creer_contact", "relier"].includes(a.genre)
    ? `<button class="btn sm" data-ag-annuler="${a.id}" data-genre="${a.genre}">${ic("reset", "ic-sm")}Annuler</button>`
    : a.statut === "proposee" ? `<button class="btn sm pri" data-ag-appliquer="${a.id}">${ic("check", "ic-sm")}Appliquer</button>`
    : a.statut === "annulee" ? `<span class="chip">Annulée</span>` : a.statut === "appliquee" ? `<span class="chip c-good">Appliquée</span>`
    : a.statut === "refusee" ? `<span class="chip c-crit">Refusée</span>` : "";
  return `<li class="ag-act s-${a.statut}"><div class="ag-act-t"><span>${quoi}</span>${a.statut === "refusee" && a.erreur ? `<small>${esc(a.erreur)}</small>` : ""}${a.decision && a.statut !== "refusee" ? `<small>Décision : ${esc(a.decision)}</small>` : ""}</div>${btn}</li>`;
}

function messageHTML(e) {
  if (e.auteur === "jb") {
    return `<div class="ag-m me"><span class="it">${esc(TYPES[e.type_message]?.l ?? "")}</span><span class="ag-txt">${esc(e.texte)}</span>${e.type_message === "livrable" ? `<span class="ag-lot4">${ic("book", "ic-sm")}Enregistrée, traitée au lot 4</span>` : ""}<span class="ag-when">${esc(heure(e.cree_le))}</span></div>`;
  }
  if (e.auteur === "note") return `<p class="ag-note ${e.statut ? "n-" + esc(e.statut) : ""}">${esc(e.texte)}</p>`;
  const acts = e.actions?.length ? `<ul class="ag-acts">${e.actions.map(actionHTML).join("")}</ul>` : "";
  const cost = e.modele ? `<span class="ag-when">${esc(heure(e.cree_le))} · ${nb(jetons(e))} jetons · ${usdFin(e.cout_usd)}</span>` : `<span class="ag-when">${esc(heure(e.cree_le))}</span>`;
  return `<div class="ag-m bot ${e.statut === "erreur" ? "err" : ""}">${texte(e.texte)}${acts}${cost}</div>`;
}

function filHTML(f, s) {
  const i = s.info;
  const cumul = i ? `<span class="chip ag-cumul" title="Jetons et coût estimé ce mois, toutes fiches. Plafond réglé côté serveur.">Ce mois ${nb(i.cumul.jetons)} jetons · ${usd(i.cumul.cout_usd)} sur ${usd(i.plafondUsd)}</span>` : "";
  const sansCle = i && !i.cle ? `<div class="banner info ag-cle">${ic("info", "ic-sm")}<span>L'agent attend sa clé API Anthropic. Tu peux déjà écrire : tes messages sont gardés et les demandes de livrable sont enregistrées.</span></div>` : "";
  const plafond = i && i.cle && i.cumul.cout_usd >= i.plafondUsd ? `<div class="banner ag-cle">${ic("alert", "ic-sm")}<span>Plafond du mois atteint : l'agent ne répond plus jusqu'au mois prochain.</span></div>` : "";
  const list = s.fil === null ? `<p class="small muted">Chargement du fil…</p>`
    : s.fil === "erreur" ? `<div class="banner">${ic("alert", "ic-sm")}<span>Fil indisponible pour l'instant. <button class="lnk" data-ag-relire="1">Réessayer</button></span></div>`
    : s.fil.length ? s.fil.map(messageHTML).join("")
    : `<p class="ag-intro">Un seul interlocuteur pour cette fiche. Il répond à tes questions et range tes remarques (champs, replanification, tâche, contact, mise en lien). Chaque modification s'affiche ici avec l'ancienne et la nouvelle valeur, et un bouton Annuler. Il ne touche jamais à Mes notes ni aux statuts, il te les propose.</p>
       <div class="ag-sugg">${(SUGG[f.type] || []).map((t, n) => `<button class="chip" type="button" data-ag-sugg="${n}">${esc(t)}</button>`).join("")}</div>`;
  const live = s.busy ? `<div class="ag-m bot live" aria-live="polite"><p class="muted">${s.type === "livrable" ? "Enregistrement…" : "L'agent réfléchit…"}</p></div>` : "";
  return `<div class="ag" data-ag-fiche="${esc(f.id)}">
    <div class="ag-top">${cumul}</div>${sansCle}${plafond}
    <div class="ag-list" id="ag-list">${list}${live}</div>
    ${s.err ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(s.err)}</span></div>` : ""}
    <form class="ag-form on" data-ag-form="1">
      <div class="ag-int" role="group" aria-label="Type de message">${Object.entries(TYPES).map(([k, x]) => `<button type="button" class="chip" data-ag-type="${k}" aria-pressed="${s.type === k}">${ic(x.ic, "ic-sm")}${x.l}</button>`).join("")}</div>
      <label class="sr" for="ag-in">Ton message à l'agent</label>
      <textarea id="ag-in" rows="3" maxlength="4000" placeholder="${esc(TYPES[s.type].ph)}" ${s.busy ? "disabled" : ""}>${esc(s.draft)}</textarea>
      <div class="ag-foot"><span class="small muted ag-kbd">Ctrl + Entrée pour envoyer</span><button class="btn sm pri" type="submit" ${s.busy ? "disabled" : ""}>Envoyer</button></div>
    </form></div>`;
}

let host = null;
function paint(keepFocus = false) {
  const f = ficheCourante();
  const el = host?.isConnected ? host : document.querySelector("[data-agent-host]");
  if (!el) return;
  host = el;
  if (!f) { el.innerHTML = `<div class="ag-soon">${ic("agent")}<p><b>Le fil Agent couvre les fiches Contact et Tâche.</b> Il arrivera sur les pistes et les projets avec un lot suivant.</p></div>`; return; }
  const s = st(f.id);
  const ta = $("#ag-in", el);
  const foc = keepFocus || (ta && document.activeElement === ta);
  const sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
  el.innerHTML = filHTML(f, s);
  const l = $("#ag-list", el); if (l) l.scrollTop = l.scrollHeight;
  const t2 = $("#ag-in", el);
  if (t2 && foc && !t2.disabled) { t2.focus({ preventScroll: true }); if (sel) try { t2.setSelectionRange(...sel); } catch { /* */ } }
}

async function charger(f, force = false) {
  const s = st(f.id);
  if (s.fil !== null && s.fil !== "erreur" && !force) return;
  try { const r = await agentApi.fil(f.type, f.id); s.fil = r.fil; s.info = r; s.err = ""; }
  catch (e) { if (s.fil === null) s.fil = "erreur"; s.err = e.status ? e.message : ""; }
  if (ficheCourante()?.id === f.id) paint();
}

/** Monté par renderSide (ui.js) à chaque redessin du panneau de droite. */
function monter(side) {
  host = side.querySelector("[data-agent-host]");
  if (!host) return;
  paint();
  const f = ficheCourante();
  if (f) charger(f);
}

/** La fiche a changé côté Notion (action de l'agent, annulation) : la vue la relit. */
const ficheModifiee = () => window.dispatchEvent(new CustomEvent("cockpit:fiche-modifiee"));

async function envoyer() {
  const f = ficheCourante(); if (!f) return;
  const s = st(f.id);
  const t = ($("#ag-in")?.value ?? s.draft).trim();
  if (!t || s.busy) return;
  s.busy = true; s.err = ""; s.draft = t; paint();
  try {
    const r = await agentApi.envoyer(f.type, f.id, s.type, t);
    s.fil = r.fil; s.info = r; s.draft = "";
    if (r.ecrit) ficheModifiee();
  } catch (e) { s.err = e.message || "L'agent n'a pas pu répondre."; }
  s.busy = false;
  if (ficheCourante()?.id === f.id) paint(true);
}

async function geste(kind, id, genre) {
  const f = ficheCourante(); if (!f) return;
  if (kind === "annuler" && (genre === "creer_tache" || genre === "creer_contact")
    && !confirm(`Annuler cette création ? ${genre === "creer_tache" ? "La tâche" : "Le contact"} part dans la corbeille Notion (récupérable 30 jours).`)) return;
  const s = st(f.id);
  try {
    const r = kind === "annuler" ? await agentApi.annuler(id) : await agentApi.appliquer(id);
    s.fil = r.fil; s.info = r; s.err = "";
    toast(kind === "annuler" ? "Ancienne valeur remise dans Notion" : "Statut changé dans Notion");
    ficheModifiee();
  } catch (e) { toast(e.message, "err"); }
  if (ficheCourante()?.id === f.id) paint();
}

export function bindAgent(side) {
  side.addEventListener("click", (e) => {
    const f = ficheCourante(); if (!f) return;
    const s = st(f.id);
    const ty = e.target.closest("[data-ag-type]");
    if (ty) { s.draft = $("#ag-in")?.value ?? s.draft; s.type = ty.dataset.agType; paint(true); return; }
    const sg = e.target.closest("[data-ag-sugg]");
    if (sg) { s.type = "question"; s.draft = SUGG[f.type][Number(sg.dataset.agSugg)]; paint(true); return; }
    const an = e.target.closest("[data-ag-annuler]");
    if (an) { geste("annuler", an.dataset.agAnnuler, an.dataset.genre); return; }
    const ap = e.target.closest("[data-ag-appliquer]");
    if (ap) { geste("appliquer", ap.dataset.agAppliquer); return; }
    if (e.target.closest("[data-ag-relire]")) { s.fil = null; paint(); charger(f, true); }
  });
  side.addEventListener("input", (e) => { if (e.target.id === "ag-in") { const f = ficheCourante(); if (f) st(f.id).draft = e.target.value; } });
  side.addEventListener("submit", (e) => { if (e.target.closest("[data-ag-form]")) { e.preventDefault(); envoyer(); } });
  side.addEventListener("keydown", (e) => { if (e.target.id === "ag-in" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); envoyer(); } });
}

setAgentHook(monter);

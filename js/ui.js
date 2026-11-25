// Petits utilitaires d'affichage partagés par les vues.

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ic = (n, cl = "") => `<svg class="ic ${cl}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
export const nrm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const initials = (n) => {
  const w = String(n || "?").replace(/[^\p{L}\p{N} '-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "?") + (w.length > 1 ? w[w.length - 1][0] : (w[0]?.[1] ?? ""))).toUpperCase();
};
const KIND = { Personne: "p", Organisation: "org", "Réseau": "res" };
export const av = (c, cl = "") => `<span class="av k-${KIND[c.type] ?? "p"} ${cl}" aria-hidden="true">${esc(initials(c.nom))}</span>`;

const today = () => new Date().toISOString().slice(0, 10);
export function fd(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
export function due(iso) {
  if (!iso) return "";
  const d = iso.slice(0, 10), t = today();
  return `<span class="due ${d < t ? "late" : d === t ? "today" : ""}">${d === t ? "Aujourd'hui" : esc(fd(iso))}</span>`;
}

// Couleur d'une option Notion → classe de pastille du design RoseauSI.
const COLOR = { green: "st-termine", blue: "st-encours", purple: "st-relire", orange: "st-attente", yellow: "st-attente", brown: "st-attente", red: "c-crit", gray: "", pink: "", default: "" };
export const chip = (label, color) => label ? `<span class="chip ${COLOR[color] ?? ""}">${esc(label)}</span>` : "";

let toastT;
export function toast(msg, kind = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "on " + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = ""; }, 3200);
}

// Le tiroir de fiche est partagé entre les vues : seule la vue qui l'a ouvert en dernier
// a le droit de le redessiner (évite qu'une réponse tardive écrase une autre fiche).
let drawerOwner = null;
export const setDrawerOwner = (v) => { drawerOwner = v; };
export const ownsDrawer = (v) => drawerOwner === v;

/** Petite pastille d'état de tâche (classes du POC). */
const ETAT_CL = { "A venir": "st-avenir", "A faire": "st-afaire", "En attente": "st-attente", "En cours": "st-encours", "À rédiger": "st-relire", "Prêt à relire": "st-relire", "Terminé": "st-termine", "Annulé": "st-annule" };
export const etatChip = (e, always = false) => e && (always || e !== "A faire") ? `<span class="chip ${ETAT_CL[e] ?? ""}">${esc(e === "A faire" ? "À faire" : e === "A venir" ? "À venir" : e)}</span>` : "";
export const etatLabel = (e) => e === "A faire" ? "À faire" : e === "A venir" ? "À venir" : e;
export const isDone = (t) => t.etat === "Terminé" || t.etat === "Annulé";

// ---------------- Fiche plein écran (lot 1) ----------------

/** En-tête de la fiche : nature, lien Notion, panneau de droite présent ou non. */
export function ficheTop({ kind, url = null, side = true }) {
  $("#dr-kind").textContent = kind;
  const a = $("#dr-notion");
  a.hidden = !url;
  if (url) a.href = url;
  $("#drawer").classList.toggle("has-side", side);
  if (!side) $("#dr-side").innerHTML = "";
}

/** Écrit le panneau de droite (Mes notes au-dessus, agent en dessous), seulement pour la vue propriétaire. */
export function renderSide(owner, html) {
  if (!ownsDrawer(owner)) return;
  $("#dr-side").innerHTML = html;
}

const OA = {
  "En attente": ["st-attente", "Ordre en attente", "L'agent de production le prendra à son prochain passage."],
  "En cours": ["st-encours", "En cours", "L'agent de production y travaille."],
  "Fait": ["c-good", "Livrable prêt", "Le livrable est rangé dans la page Notion de la fiche."],
  "Bloqué": ["c-crit", "Bloqué", "La raison est notée dans la page Notion de la fiche."],
};

/**
 * Panneau de droite.
 * notes : [{ label, text }] (text vide = absent), notesHint : phrase sous les notes,
 * ordre : { etat, mission } lus dans Notion (Ordre agent, Ordre de mission), ou null.
 */
export function sideHTML({ notes = [], notesHint = "", notesMissing = "", ordre = null }) {
  const shown = notes.filter((n) => n.text);
  const notesBody = notesMissing
    ? `<p class="small muted">${esc(notesMissing)}</p>`
    : shown.length
      ? shown.map((n) => `${shown.length > 1 || n.label !== "Mes notes" ? `<div class="sn-l">${esc(n.label)}</div>` : ""}<p class="notes mesnotes">${esc(n.text)}</p>`).join("")
      : `<p class="small muted">Aucune note dans Notion.</p>`;
  const o = ordre?.etat ? OA[ordre.etat] : null;
  const prod = o ? `<div class="ag-prod"><div class="ag-prod-h">${ic("book", "ic-sm")}<b>Agent de production</b><span class="chip ${o[0]}">${o[1]}</span></div>
    ${ordre.mission ? `<p class="ag-prod-o">${esc(String(ordre.mission).slice(0, 220))}${String(ordre.mission).length > 220 ? "…" : ""}</p>` : ""}<p class="small muted">${o[2]}</p></div>`
    : ordre?.etat ? `<div class="ag-prod"><div class="ag-prod-h">${ic("book", "ic-sm")}<b>Agent de production</b><span class="chip">${esc(ordre.etat)}</span></div></div>` : "";
  return `<div class="side-in">
    <section class="side-notes" aria-labelledby="sn-h"><div class="sn-h"><b id="sn-h">Mes notes</b><span class="small muted">${esc(notesHint || "Lues dans Notion, modifiables dans Notion")}</span></div>${notesBody}</section>
    <section class="side-agent" aria-labelledby="ag-h"><div class="ag-head"><b id="ag-h">Agent de la fiche</b><span class="chip dash">Lot 3</span></div>
      ${prod}
      <div class="ag-soon">${ic("agent")}<p><b>Le fil Agent arrive au lot 3.</b> Tu pourras y poser une question, faire une remarque ou demander un livrable, et chaque échange restera visible ici. Pour l'instant aucune IA n'est appelée.</p></div>
      <form class="ag-form" onsubmit="return false"><label class="sr" for="ag-in">Message à l'agent (bientôt)</label><textarea id="ag-in" rows="3" disabled placeholder="Disponible au lot 3"></textarea>
        <div class="ag-foot"><button class="btn sm pri" type="button" disabled>Envoyer</button></div></form></section>
  </div>`;
}

/** Onglets de sections en haut de la fiche. secs : [[clé, libellé, nombre?]]. */
export const ficheTabs = (secs, cur, attr) => `<nav class="cnav" aria-label="Sections de la fiche">${secs.map(([k, lab, n]) =>
  `<button class="${k === cur ? "on" : ""}" ${attr}="${k}" aria-current="${k === cur ? "true" : "false"}">${esc(lab)}${n != null ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")}</nav>`;

/** Icône d'un type d'action TO DO (repris du POC). */
const TA_IC = { Email: "mail", "Compte rendu": "book", Relance: "reset", "Prise de contact": "call", "Ordre du jour": "list", Production: "layers", Recherche: "search", "Point à creuser": "info" };
export const taSpan = (t) => t ? `<span class="ta">${ic(TA_IC[t] || "note", "ic-sm")}${esc(t)}</span>` : "";

/** Icône du format d'un échange du journal (« 🎙️Réunion », « 📞Call », « 🧩Atelier »). */
export function fmtIcon(f) {
  const k = /atelier/i.test(f || "") ? "atelier" : /r[ée]union/i.test(f || "") ? "reunion" : /call|appel/i.test(f || "") ? "call" : null;
  return `<span class="ifmt sm ${k ? "" : "none"}">${ic(k || "note", "ic-sm")}</span>`;
}

/** Couleur d'une étape du parcours réseau (palette du POC), à partir du libellé Notion. */
const PARC_COL = [[/recommand/i, "#8a6a4a"], [/contacter/i, "#7a7a7a"], [/relance/i, "#7b5aa6"], [/contact[ée]/i, "#b8902a"], [/[ée]change|qualif|int[ée]r[êe]t/i, "#c0702a"], [/relais/i, "#2e8b6a"], [/opportunit|piste/i, "#1f7a5a"], [/nurturing/i, "#3a6fa8"], [/pertinent|sans suite/i, "#b04040"], [/contact$/i, "#b0567a"]];
export function parcChip(v) {
  if (!v) return "";
  const col = PARC_COL.find(([re]) => re.test(v))?.[1] || "#7a7a7a";
  return `<span class="chip parc"><i class="dot" style="background:${col}"></i>${esc(v)}</span>`;
}

// ---------------- Synchronisation avec Notion (lot M) ----------------
// Les fonctions lisent un miroir Postgres de Notion ; chaque réponse dit d'où viennent les données
// (synchro.source : « miroir » ou « notion ») et l'heure de la dernière synchronisation.

/** Au-delà de ce délai sans synchronisation, un bandeau le signale. */
export const STALE_MIN = 30;

const hm = (d) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
export const syncMinutes = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : null);

export function ago(iso) {
  const m = syncMinutes(iso);
  if (m == null) return "";
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${Math.floor(m)} min`;
  if (m < 24 * 60) return `il y a ${Math.floor(m / 60)} h${String(Math.floor(m % 60)).padStart(2, "0")}`;
  const d = new Date(iso);
  return `le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${hm(d)}`;
}

/** Synchro d'une réponse ; une réponse sans « synchro » (ancienne fonction) vaut lecture directe. */
export const syncOf = (r) => r?.synchro ?? (r?.fetchedAt ? { source: "notion", synchronise: r.fetchedAt } : null);

function syncText(sy) {
  if (!sy?.synchronise) return sy?.source === "miroir" ? "jamais synchronisé avec Notion" : "";
  return sy.source === "miroir" ? `synchronisé avec Notion ${ago(sy.synchronise)}` : `lu dans Notion à ${hm(new Date(sy.synchronise))}`;
}

const cap1 = (t, cap) => (cap && t ? t[0].toUpperCase() + t.slice(1) : t);

/** Mention discrète « synchronisé il y a 3 min », tenue à jour par l'horloge de app.js. cap : majuscule initiale. */
export const syncSpan = (sy, cap = false) => sy ? `<span class="sync" data-sync="${esc(sy.synchronise ?? "")}" data-src="${esc(sy.source)}"${cap ? ` data-cap="1"` : ""}>${esc(cap1(syncText(sy), cap))}</span>` : "";

/** Bandeau affiché quand la dernière synchronisation date de plus de 30 minutes (ou n'a jamais eu lieu). */
export function staleBanner(sy) {
  if (sy?.source !== "miroir") return "";
  const m = syncMinutes(sy.synchronise);
  const late = m == null || m > STALE_MIN;
  return `<div class="banner sync-stale" data-stale="${esc(sy.synchronise ?? "")}"${late ? "" : " hidden"}>${ic("alert", "ic-sm")}<span>Pas de synchronisation avec Notion depuis <b class="stale-ago">${esc(sy.synchronise ? ago(sy.synchronise).replace(/^il y a /, "") : "le début")}</b> : ce qui est affiché peut avoir changé dans Notion. <button class="lnk" data-act="reload">Actualiser</button></span></div>`;
}

/** Met à jour les mentions et bandeaux de synchronisation déjà affichés (toutes les 30 secondes). */
export function tickSync(root = document) {
  root.querySelectorAll("[data-sync]").forEach((el) => {
    const sy = { source: el.dataset.src, synchronise: el.dataset.sync || null };
    el.textContent = cap1(syncText(sy), el.dataset.cap === "1");
  });
  root.querySelectorAll("[data-stale]").forEach((el) => {
    const iso = el.dataset.stale || null;
    const m = syncMinutes(iso);
    el.hidden = !(m == null || m > STALE_MIN);
    const b = el.querySelector(".stale-ago");
    if (b && iso) b.textContent = ago(iso).replace(/^il y a /, "");
  });
}

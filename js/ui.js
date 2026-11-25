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

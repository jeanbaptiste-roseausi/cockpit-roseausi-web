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

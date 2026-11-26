// Passage d'une vue à l'autre en gardant l'affichage choisi (26/11/2026, parcours réseau).
// Comme dans l'artefact, Contacts propose Liste, Cartes, À créer, Parcours et Mises en lien. Les deux derniers
// sont la vue Réseau, qui garde aussi son entrée dans le menu. La vue d'arrivée lit le mode demandé au montage.
import { ic } from "./ui.js";

export const modeDemande = { contacts: null, reseau: null };

const MODES = [
  ["contacts", "liste", "list", "Liste"],
  ["contacts", "cartes", "grid", "Cartes"],
  ["contacts", "acreer", "plus", "À créer"],
  ["reseau", "parcours", "users", "Parcours"],
  ["reseau", "carte", "net", "Mises en lien"],
];

/**
 * Barre d'affichage commune à Contacts et Réseau. Les modes de la vue courante sont des boutons
 * (attribut donné par `own(mode)`), ceux de l'autre vue des liens.
 */
export function modesSeg(view, cur, own) {
  return `<div class="seg vmodes" role="group" aria-label="Affichage">${MODES.map(([v, m, i, l]) => v === view
    ? `<button class="${cur === m ? "on" : ""}" ${own(m)} aria-pressed="${cur === m}">${ic(i, "ic-sm")} ${l}</button>`
    : `<a href="#/${v}" data-vmode="${v}:${m}">${ic(i, "ic-sm")} ${l}</a>`).join("")}</div>`;
}

document.addEventListener("click", (e) => {
  const a = e.target.closest?.("[data-vmode]");
  if (!a) return;
  const [v, m] = a.dataset.vmode.split(":");
  modeDemande[v] = m;
});

// Bande de propriétés des fiches (fiches compactes, artefact 1795796345-bfec, 27/11/2026).
// Sous le titre, une seule rangée de chips remplace les chips d'en-tête et la grille de cartes de la Synthèse.
// Trois aspects, sans pastille d'origine ni légende permanente :
// - trait plein (classe ed), champ modifiable sur place. Une liste ou une date native est posée en transparence
//   sur la chip, avec l'attribut que la fiche écoute déjà (data-tprop, data-piprop, data-cprop…). L'écriture
//   suit donc le chemin existant, Notion d'abord puis le miroir.
// - pointillés en italique (pp-calc), valeur calculée par le cockpit ou formule Notion, jamais écrite.
// - pointillés avec « + » (pp-add), champ vide, un clic pour le remplir.
// La légende complète est derrière l'icône ⓘ en bout de bande (PP_INFO).
import { esc, ic } from "./ui.js";

/** Options d'une liste. o : tableau de [valeur, libellé] ou objet. La valeur courante absente est ajoutée. */
export function ppOpts(o, cur) {
  cur = cur == null ? "" : String(cur);
  const e = Array.isArray(o) ? o.map((x) => (Array.isArray(x) ? x : [x, x])) : Object.entries(o);
  if (cur && !e.some(([k]) => String(k) === cur)) e.push([cur, cur]);
  return e.map(([k, v]) => `<option value="${esc(k)}" ${cur === String(k) ? "selected" : ""}>${esc(v)}</option>`).join("");
}

/** Chip modifiable par une liste native. attr : attribut écouté par la fiche. shown : HTML déjà échappé. */
export const ppSel = (attr, opts, shown, aria, cls = "", disabled = false) =>
  `<label class="chip pp ed ${cls}" title="${esc(aria)}">${shown}${ic("chev", "ic-xs")}<select ${attr} aria-label="${esc(aria)}" ${disabled ? "disabled" : ""}>${opts}</select></label>`;

/** Chip modifiable par un calendrier natif. */
export const ppDate = (attr, val, shown, aria, cls = "", disabled = false) =>
  `<label class="chip pp ed ${cls}" title="${esc(aria)}">${shown}${ic("chev", "ic-xs")}<input type="date" ${attr} value="${esc(String(val || "").slice(0, 10))}" aria-label="${esc(aria)}" ${disabled ? "disabled" : ""}></label>`;

/** Chip en lecture. */
export const ppTxt = (shown, cls = "", title = "") => `<span class="chip pp ${cls}" ${title ? `title="${esc(title)}"` : ""}>${shown}</span>`;

/** Chip lien (ouvre une fiche). */
export const ppLink = (href, shown, cls = "", title = "") => `<a class="chip pp ${cls}" href="${esc(href)}" ${title ? `title="${esc(title)}"` : ""}>${shown}</a>`;

/** Chip bouton (ouvre un onglet de la fiche ou lance un geste). attr : par exemple data-tsec="liens". */
export const ppBtn = (attr, shown, cls = "pp-add dash", title = "") => `<button type="button" class="chip pp ${cls}" ${attr} ${title ? `title="${esc(title)}"` : ""}>${shown}</button>`;

/** Légende des trois aspects, derrière l'icône ⓘ. */
export const PP_INFO = `<details class="ppinfo"><summary aria-label="Comment lire ces champs" title="Comment lire ces champs">${ic("info", "ic-sm")}</summary><div class="ppinfo-pop"><p><b>Trait plein</b>, tu modifies le champ ici d'un clic. La modification part dans Notion.</p><p><b>Pointillés en italique</b>, valeur calculée par le cockpit ou par une formule Notion.</p><p><b>Pointillés avec +</b>, champ vide, un clic pour le remplir.</p><p>La synthèse de l'agent est repliée sous le texte.</p></div></details>`;

/** Bande complète. */
export const ppBand = (chips) => `<div class="props">${chips.filter(Boolean).join("")}${PP_INFO}</div>`;

/** Synthèse agent repliée par défaut, aperçu d'une ligne. */
export const saFold = (sa) => sa ? `<details class="safold"><summary>${ic("agent", "ic-sm")}<b>Synthèse agent</b><span>${esc(sa)}</span></summary><p class="notes">${esc(sa)}</p></details>` : "";

/** Ligne « Prochaine action » ou « Prochaine étape ». html : contenu déjà échappé. */
export const nextLine = (label, html) => `<div class="nextline">${ic("flag", "ic-sm")}<b>${esc(label)}</b>${html}</div>`;

/** Durées proposées pour « Durée estimée (min) ». */
export const DUR_OPT = [["", "Non renseignée"], ["5", "5 min"], ["10", "10 min"], ["15", "15 min"], ["30", "30 min"], ["45", "45 min"], ["60", "1 h"], ["90", "1 h 30"], ["120", "2 h"], ["180", "3 h"], ["240", "4 h"]];
export const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}` : `${m} min`;

// Fermeture de la légende au clic ailleurs.
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.ppinfo[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
}

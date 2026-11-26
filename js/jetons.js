// Champs de rattachement en jetons, repris de l'artefact « Pilotage RoseauSI » (version 1795698879-79f6,
// poc/pilotage-2026-11-26-79f6.html, fonctions pickerHTML, pickerChips, pickerSearch).
// Les éléments liés vivent dans la case : un clic sur le nom ouvre la fiche liée, la croix retire le lien,
// Retour arrière dans la case vide retire le dernier, Entrée ajoute le premier proposé.
// Chaque ajout ou retrait est confié à la vue (onAdd, onRemove), qui l'écrit aussitôt dans Notion
// et propose « Annuler » pendant 6 secondes (toastUndo de ui.js).
import { esc, ic, nrm } from "./ui.js";

const REG = new Map(); // id du champ → { choices, onAdd, onRemove }
let bound = false;
const DRAFT = new Map(); // saisie en cours par champ, gardée quand la fiche se redessine
let focused = null;      // champ qui avait le curseur

/**
 * @param {object} o
 * @param {string} o.id identifiant unique du champ dans la page
 * @param {{id:string, nom:string, href?:string, icon?:string, cls?:string}[]} o.items éléments liés
 * @param {{id:string, nom:string, sub?:string}[]} o.choices éléments proposés à l'ajout
 * @param {string} o.label nom du champ (lecteurs d'écran)
 * @param {string} [o.placeholder]
 * @param {boolean} [o.busy] écriture en cours : croix et saisie désactivées
 * @param {boolean} [o.locked] trop de liens pour être modifiés ici (lecture seule)
 * @param {(id:string) => void} o.onAdd
 * @param {(id:string) => void} o.onRemove
 */
export function jetonsHTML(o) {
  bind();
  REG.set(o.id, { choices: o.choices || [], items: o.items || [], onAdd: o.onAdd, onRemove: o.onRemove, busy: !!o.busy });
  const ro = o.locked || !o.onAdd;
  const toks = (o.items || []).map((x) => tok(x, !!o.locked, !!o.busy)).join("");
  const ph = o.placeholder || "Chercher…";
  // La fiche se redessine (liste arrivée, enregistrement fini) : la saisie et le curseur restent.
  if (focused === o.id) setTimeout(() => {
    const p = document.getElementById(o.id), inp = p?.querySelector("input:not([disabled])");
    if (!inp || document.activeElement === inp) return;
    inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch { /* */ }
    if (inp.value) search(p, REG.get(o.id));
  }, 0);
  return `<div class="picker" id="${esc(o.id)}" data-pk="${esc(o.id)}"><div class="pk-box${ro ? " ro" : ""}">${toks || (ro ? `<span class="small muted">Aucun</span>` : "")}
    ${ro ? "" : `<input type="text" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${esc(o.id)}-l" aria-label="${esc(o.label)}" value="${esc(DRAFT.get(o.id) || "")}" placeholder="${esc((o.items || []).length ? "Ajouter…" : ph)}" ${o.busy ? "disabled" : ""}>`}</div>
    <div class="pk-list" id="${esc(o.id)}-l" role="listbox" hidden></div></div>`;
}

function tok(x, locked, busy) {
  const lead = x.icon ? ic(x.icon, "ic-sm") : "";
  const n = (x.nom || "Sans nom").trim();
  const label = x.href
    ? `<a class="tok-l" href="${esc(x.href)}" title="Ouvrir ${esc(n)}">${lead}<span>${esc(n)}</span><svg class="ext" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>`
    : `<span class="tok-l">${lead}<span>${esc(n)}</span></span>`;
  return `<span class="tok ${x.cls || ""}">${label}${locked ? "" : `<button type="button" class="tok-x" data-pkrm="${esc(x.id)}" aria-label="Retirer ${esc(n)}" title="Retirer" ${busy ? "disabled" : ""}>✕</button>`}</span>`;
}

const regOf = (el) => { const p = el.closest?.("[data-pk]"); return p ? [p, REG.get(p.dataset.pk)] : [null, null]; };

function search(p, r) {
  const inp = p.querySelector("input"), list = p.querySelector(".pk-list");
  const q = nrm(inp.value.trim());
  if (!q) { list.hidden = true; inp.setAttribute("aria-expanded", "false"); return; }
  const have = new Set(r.items.map((x) => x.id));
  const found = r.choices.filter((c) => !have.has(c.id) && nrm(String(c.nom || "")).includes(q)).slice(0, 8);
  list.innerHTML = found.map((c, i) => `<button type="button" role="option" data-pkadd="${esc(c.id)}" ${i === 0 ? 'aria-selected="true"' : ""}><span>${esc(String(c.nom).trim())}</span>${c.sub ? `<span class="small muted">${esc(c.sub)}</span>` : ""}</button>`).join("")
    || `<p class="small muted" style="padding:8px">Aucun résultat</p>`;
  list.hidden = false; inp.setAttribute("aria-expanded", "true");
  list.scrollIntoView({ block: "nearest" });
}

function closeAll(except) {
  document.querySelectorAll(".picker .pk-list:not([hidden])").forEach((l) => { if (!except || !except.contains(l)) { l.hidden = true; l.parentElement.querySelector("input")?.setAttribute("aria-expanded", "false"); } });
}

/** Remet le curseur dans le champ après le nouveau rendu de la fiche. */
function refocus(id) { setTimeout(() => document.getElementById(id)?.querySelector("input:not([disabled])")?.focus(), 0); }

async function run(p, r, fn, id) {
  if (r.busy || !fn) return;
  const pid = p.id;
  DRAFT.delete(pid); const inp = p.querySelector("input"); if (inp) inp.value = "";
  try { await fn(id); } finally { refocus(pid); }
}

function bind() {
  if (bound) return;
  bound = true;
  document.addEventListener("input", (e) => { const [p, r] = regOf(e.target); if (p && r && e.target.tagName === "INPUT") { DRAFT.set(p.id, e.target.value); search(p, r); } });
  document.addEventListener("focusin", (e) => { const [p] = regOf(e.target); focused = p && e.target.tagName === "INPUT" ? p.id : null; });
  document.addEventListener("focusout", (e) => { const [p] = regOf(e.target); if (p && !p.contains(e.relatedTarget) && e.relatedTarget) focused = null; });
  document.addEventListener("click", (e) => {
    const [p, r] = regOf(e.target);
    closeAll(p);
    if (!p || !r) { focused = null; return; }
    const add = e.target.closest("[data-pkadd]");
    if (add) { e.preventDefault(); run(p, r, r.onAdd, add.dataset.pkadd); return; }
    const rm = e.target.closest("[data-pkrm]");
    if (rm) { e.preventDefault(); run(p, r, r.onRemove, rm.dataset.pkrm); return; }
    if (e.target.classList?.contains("pk-box")) p.querySelector("input")?.focus();
  });
  document.addEventListener("keydown", (e) => {
    const [p, r] = regOf(e.target);
    if (!p || !r) return;
    const inp = p.querySelector("input"), list = p.querySelector(".pk-list");
    if (e.target === inp) {
      if (e.key === "Enter") { e.preventDefault(); const first = list.hidden ? null : list.querySelector("[data-pkadd]"); if (first) run(p, r, r.onAdd, first.dataset.pkadd); }
      else if (e.key === "Backspace" && !inp.value && r.items.length) { e.preventDefault(); run(p, r, r.onRemove, r.items[r.items.length - 1].id); }
      else if (e.key === "Escape" && !list.hidden) { e.stopPropagation(); list.hidden = true; }
      else if (e.key === "ArrowDown" && !list.hidden) { e.preventDefault(); list.querySelector("[data-pkadd]")?.focus(); }
    } else if (e.target.closest(".pk-list")) {
      const opts = [...list.querySelectorAll("[data-pkadd]")], i = opts.indexOf(e.target);
      if (e.key === "ArrowDown") { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? opts[i - 1] : inp).focus(); }
      else if (e.key === "Escape") { e.stopPropagation(); list.hidden = true; inp.focus(); }
    }
  });
}

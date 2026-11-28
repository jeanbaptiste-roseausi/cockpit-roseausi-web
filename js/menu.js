// Menu du téléphone réglable (28/11/2026) : ordre des vues et onglets de la barre du bas, choisis dans Réglages.
//
// Préférence « menu_telephone » = { ordre: [id de vue…], barre: [id de vue…] } :
//   - ordre : toutes les vues, dans l'ordre choisi ;
//   - barre : les vues de la barre du bas (4 au plus), affichées dans l'ordre de « ordre » ;
//   - les autres vont dans « Plus », dans l'ordre de « ordre ».
// Gardée dans la base du cockpit (fonction reglages) pour suivre Jean-Baptiste d'un navigateur à l'autre et dans
// l'appli installée ; copie locale (localStorage) pour l'affichage immédiat au démarrage. La base l'emporte.
// Une vue inconnue (retirée d'une version) est ignorée ; une vue nouvelle va à la fin, donc dans « Plus ».
// Sur ordinateur, rien ne change : le menu de gauche garde l'ordre de VIEWS.
import { reglagesApi } from "./api.js";
import { esc, ic, toast } from "./ui.js";

const CLE = "menu_telephone";
const LOCAL = "cockpit.menuTelephone";
export const BARRE_MAX = 4;
export const MSG_PLEIN = `La barre du bas garde au plus ${BARRE_MAX} onglets, plus « Plus ». Retire d'abord un onglet de la barre.`;

let VUES = [];          // objets vue, dans l'ordre de VIEWS (app.js)
let DEFAUT = [];        // onglets par défaut de la barre (MOB_TABS)
let surChange = () => {};
let pref = lireLocal(); // { ordre, barre } ou null (par défaut)
let hote = null;        // carte de Réglages, quand elle est affichée
let message = "";       // message de la carte (refus d'un cinquième onglet, échec d'enregistrement)

function lireLocal() {
  try { const o = JSON.parse(localStorage.getItem(LOCAL) || "null"); return o && typeof o === "object" ? o.valeur ?? null : null; }
  catch { return null; }
}
function ecrireLocal(valeur) {
  try { localStorage.setItem(LOCAL, JSON.stringify({ valeur, le: new Date().toISOString() })); } catch { /* stockage indisponible */ }
}

/** Branche le menu sur les vues de l'appli. onChange : redessine la barre et « Plus ». */
export function configurerMenu({ vues, defautBarre, onChange }) {
  VUES = vues; DEFAUT = defautBarre; surChange = onChange || (() => {});
}

/**
 * Ordre et barre effectifs d'une préférence, pour une liste d'identifiants de vues. Pur, testable.
 * Par défaut : la barre d'origine (defaut) en tête, puis les autres vues dans l'ordre de la liste.
 */
export function resoudre(p, ids, defaut) {
  const connu = new Set(ids);
  const uniques = (l) => [...new Set((Array.isArray(l) ? l : []).filter((x) => connu.has(x)))];
  const defOrdre = [...defaut.filter((x) => connu.has(x)), ...ids.filter((x) => !defaut.includes(x))];
  if (!p || typeof p !== "object") return { ordre: defOrdre, barre: defaut.filter((x) => connu.has(x)).slice(0, BARRE_MAX) };
  const ordre = uniques(p.ordre);
  for (const x of ids) if (!ordre.includes(x)) ordre.push(x); // vue nouvelle : à la fin
  const dans = new Set(uniques(p.barre));
  return { ordre, barre: ordre.filter((x) => dans.has(x)).slice(0, BARRE_MAX) };
}

const ids = () => VUES.map((v) => v.id);
const etat = () => resoudre(pref, ids(), DEFAUT);
const vue = (id) => VUES.find((v) => v.id === id);

/** Vues de la barre du bas et de « Plus », dans l'ordre choisi. */
export function menuMobile() {
  const { ordre, barre } = etat();
  return { barre: barre.map(vue), plus: ordre.filter((x) => !barre.includes(x)).map(vue) };
}

/** Relit la préférence dans la base du cockpit (après la connexion). La base l'emporte sur la copie locale. */
export async function chargerMenu() {
  let r;
  try { r = await reglagesApi.preferences(); } catch { return; } // hors ligne : la copie locale reste affichée
  const valeur = r?.preferences?.[CLE]?.valeur ?? null;
  if (JSON.stringify(valeur) === JSON.stringify(pref)) return;
  pref = valeur; ecrireLocal(valeur); surChange(); dessiner();
}

let enCours = Promise.resolve();
async function enregistrer(valeur, texte) {
  const avant = pref;
  pref = valeur; ecrireLocal(valeur); message = ""; surChange(); dessiner();
  enCours = enCours.then(async () => {
    try { await reglagesApi.enregistrer(CLE, valeur); if (texte) toast(texte); }
    catch (e) {
      pref = avant; ecrireLocal(avant); surChange();
      message = `Choix non enregistré dans le cockpit (${e.message}). Rien n'a changé.`; dessiner();
      toast("Menu du téléphone non enregistré.", "err");
    }
  });
  return enCours;
}

function changer(fn) {
  const { ordre, barre } = etat();
  const n = fn({ ordre: [...ordre], barre: [...barre] });
  if (n) enregistrer({ ordre: n.ordre, barre: n.ordre.filter((x) => n.barre.includes(x)) });
}

function basculer(id, dans) {
  const { barre } = etat();
  if (dans && !barre.includes(id) && barre.length >= BARRE_MAX) { refuser(); return false; }
  changer((s) => ({ ordre: s.ordre, barre: dans ? [...s.barre, id] : s.barre.filter((x) => x !== id) }));
  return true;
}

function refuser() {
  message = MSG_PLEIN; dessiner();
  toast(MSG_PLEIN, "err");
}

function deplacer(id, pas) {
  changer((s) => {
    const i = s.ordre.indexOf(id), j = i + pas;
    if (i < 0 || j < 0 || j >= s.ordre.length) return null;
    [s.ordre[i], s.ordre[j]] = [s.ordre[j], s.ordre[i]];
    return s;
  });
}

// ---------------- Carte de Réglages ----------------

/** Monte la carte « Menu du téléphone » dans Réglages. */
export function monterCarteMenu(el) {
  hote = el; message = "";
  el.addEventListener("change", (e) => {
    const c = e.target.closest("[data-mt-barre]");
    if (c && !basculer(c.dataset.mtBarre, c.checked)) c.checked = false;
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mt-monter],[data-mt-descendre],[data-mt-defaut]");
    if (!b) return;
    if (b.dataset.mtDefaut !== undefined) {
      enregistrer(null, "Menu du téléphone remis par défaut.");
      return;
    }
    const id = b.dataset.mtMonter || b.dataset.mtDescendre;
    const sens = b.dataset.mtMonter ? -1 : 1;
    deplacer(id, sens);
    // Le focus reste sur le bouton de la même vue (ou l'autre flèche en bout de liste).
    const q = (a) => hote?.querySelector(`[data-mt-${a}="${id}"]`);
    const f = q(sens < 0 ? "monter" : "descendre");
    (f && !f.disabled ? f : q(sens < 0 ? "descendre" : "monter"))?.focus();
  });
  el.addEventListener("pointerdown", glisser);
  dessiner();
}

function dessiner() {
  if (!hote || !hote.isConnected) return;
  const { ordre, barre } = etat();
  const n = ordre.length;
  const ligne = (id, i) => {
    const v = vue(id), dans = barre.includes(id), nom = esc(v.label);
    return `<li class="mt-l${dans ? " dans" : ""}" data-mt="${esc(id)}">
      <button type="button" class="mt-poignee" aria-label="Glisser pour déplacer ${nom}" title="Glisser pour déplacer">${ic("grid")}</button>
      <div class="mt-c"><span class="mt-nom">${ic(v.icon, "ic-sm")}<b>${nom}</b><span class="mt-ou">${dans ? `Barre, ${barre.indexOf(id) + 1}` : "Plus"}</span></span>
        <label class="mt-sw"><input type="checkbox" role="switch" data-mt-barre="${esc(id)}" ${dans ? "checked" : ""}><span>Dans la barre</span></label></div>
      <button type="button" class="iconbtn mt-fl" data-mt-monter="${esc(id)}" aria-label="Monter ${nom}" ${i === 0 ? "disabled" : ""}>${ic("chev", "mt-haut")}</button>
      <button type="button" class="iconbtn mt-fl" data-mt-descendre="${esc(id)}" aria-label="Descendre ${nom}" ${i === n - 1 ? "disabled" : ""}>${ic("chev", "mt-bas")}</button>
    </li>`;
  };
  hote.innerHTML = `<section class="card" style="margin-top:14px" aria-labelledby="mt-h"><div class="card-h"><h2 id="mt-h">Menu du téléphone</h2><span class="chip" data-mt-compte>${barre.length} sur ${BARRE_MAX} dans la barre</span></div>
    <p class="small muted">La barre du bas montre au plus ${BARRE_MAX} onglets, plus « Plus ». Les autres vues vont dans « Plus », dans cet ordre. Sur ordinateur, le menu ne change pas. Ce choix est gardé dans le cockpit et te suit dans le navigateur et dans l'appli installée.</p>
    <div class="mt-msg" role="status" aria-live="polite">${message ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(message)}</span></div>` : ""}</div>
    <ol class="mtlist">${ordre.map(ligne).join("")}</ol>
    <p style="margin-top:12px"><button type="button" class="btn" data-mt-defaut ${pref ? "" : "disabled"}>${ic("reset", "ic-sm")}Revenir à l'ordre par défaut</button></p></section>`;
}

// Glisser-déposer par la poignée (souris et doigt), en plus des boutons Monter et Descendre.
function glisser(e) {
  const p = e.target.closest(".mt-poignee");
  if (!p || (e.pointerType === "mouse" && e.button !== 0)) return;
  const li = p.closest("li"), liste = li.parentElement;
  e.preventDefault();
  // Écoute sur la fenêtre et non par capture : déplacer la ligne dans la liste ferait perdre la capture.
  li.classList.add("glisse");
  const avant = [...liste.children].map((x) => x.dataset.mt).join();
  const bouger = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const autres = [...liste.children].filter((x) => x !== li);
    const cible = autres.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    if (cible) { if (cible !== li.nextElementSibling) liste.insertBefore(li, cible); }
    else if (liste.lastElementChild !== li) liste.append(li);
  };
  const fin = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener("pointermove", bouger); window.removeEventListener("pointerup", fin); window.removeEventListener("pointercancel", fin);
    li.classList.remove("glisse");
    const ordre = [...liste.children].map((x) => x.dataset.mt);
    if (ordre.join() !== avant) changer((s) => ({ ordre, barre: s.barre }));
  };
  window.addEventListener("pointermove", bouger); window.addEventListener("pointerup", fin); window.addEventListener("pointercancel", fin);
}

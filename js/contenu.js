// Compte rendu d'un échange (26/11/2026) : corps de la page Notion, rendu comme dans l'artefact
// « Pilotage RoseauSI » (mdToHtml, classe pgbody) : titres, listes, gras, liens, tableaux simples.
// Les blocs arrivent simplifiés de la fonction journal (GET /journal/:id/contenu) ; tout texte est échappé ici.
// Les bascules (transcript) et les sous-pages se lisent quand on les ouvre (GET /journal/:id/contenu/:bloc).
// 26/11/2026 : réutilisé pour l'onglet Mémoire de la fiche contact (GET /contacts/:id/memoire), via `src`.
import { journalApi, contactsApi } from "./api.js";
import { esc, ic } from "./ui.js";

const ROUTE = { contacts: "contacts", todo: "todo", projets: "projets", pistes: "pistes", journal: "journal" };
const notionUrl = (id) => `https://www.notion.so/${String(id).replace(/-/g, "")}`;

// Blocs repliés déjà lus et ouverts, par entrée : la fiche se redessine sans les refermer.
const LUS = new Map();     // `${entree}:${bloc}` → { blocs, fiches } | { erreur }
const OUVERTS = new Set(); // `${entree}:${bloc}`
const EN_COURS = new Set();

function seg(s, fiches) {
  let t = esc(s.x).replace(/\n/g, "<br>");
  if (s.c) t = `<code>${t}</code>`;
  if (s.b) t = `<b>${t}</b>`;
  if (s.i) t = `<i>${t}</i>`;
  if (s.s) t = `<s>${t}</s>`;
  if (s.u) t = `<u>${t}</u>`;
  if (s.page) {
    const f = fiches?.[s.page];
    // Comme l'artefact : « [Terminé] Envoyer… » devient « Envoyer… » suivi d'une pastille.
    let lab = s.x, st = "";
    const m = lab.match(/^\s*\[([^\]]{2,20})\]\s*/);
    if (m) { lab = lab.slice(m[0].length); st = /termin/i.test(m[1]) ? ` <span class="stb done">faite</span>` : /annul/i.test(m[1]) ? ` <span class="stb">annulée</span>` : ""; }
    const inner = esc(lab || f?.titre || "Page");
    return f && ROUTE[f.base] ? `<a class="lnk" href="#/${ROUTE[f.base]}/${s.page}">${inner}</a>${st}` : `<a href="${esc(notionUrl(s.page))}" target="_blank" rel="noopener">${inner}</a>${st}`;
  }
  if (s.href) return `<a href="${esc(s.href)}" target="_blank" rel="noopener">${t}</a>`;
  return t;
}
const rt = (r, fiches) => (r || []).map((s) => seg(s, fiches)).join("");
/** Texte enrichi d'une ligne (segments simplifiés), pour Ma journée bâtie sur le brief (28/11/2026). */
export const segsHTML = rt;
const plain = (r) => (r || []).map((s) => s.x).join("").trim();

const LISTES = { bulleted_list_item: "ul", numbered_list_item: "ol", to_do: "todo" };

function blocsHTML(blocs, ctx) {
  const out = [];
  let liste = null;
  const fermer = () => { if (liste) { out.push(liste === "ol" ? "</ol>" : "</ul>"); liste = null; } };
  for (const b of blocs || []) {
    const l = LISTES[b.t];
    if (l) {
      if (liste !== l) { fermer(); out.push(l === "ol" ? "<ol>" : l === "todo" ? `<ul class="todo">` : "<ul>"); liste = l; }
      const box = l === "todo" ? `<span class="tdbox ${b.coche ? "on" : ""}" role="img" aria-label="${b.coche ? "Fait" : "À faire"}">${b.coche ? "✓" : ""}</span>` : "";
      out.push(`<li${b.coche ? ` class="done"` : ""}>${box}<span>${rt(b.r, ctx.fiches)}</span>${b.enfants?.length ? blocsHTML(b.enfants, ctx) : ""}</li>`);
      continue;
    }
    fermer();
    out.push(bloc(b, ctx));
  }
  fermer();
  return out.join("");
}

function enfantsDiffere(b, ctx) {
  const k = `${ctx.entree}:${b.page || b.id}`;
  const lu = LUS.get(k);
  if (!lu) return `<div class="pgkids" data-kids><p class="empty">Chargement depuis Notion…</p></div>`;
  if (lu.erreur) return `<div class="pgkids" data-kids><p class="empty">${esc(lu.erreur)}</p></div>`;
  return `<div class="pgkids" data-kids>${blocsHTML(lu.blocs, { ...ctx, fiches: { ...ctx.fiches, ...lu.fiches } }) || `<p class="empty">Vide.</p>`}${lu.tronque ? suite(ctx) : ""}</div>`;
}
const suite = (ctx) => `<p class="small muted">La suite est trop longue pour le cockpit, <a href="${esc(ctx.url)}" target="_blank" rel="noopener">à lire dans Notion</a>.</p>`;

function bloc(b, ctx) {
  const kids = b.enfants?.length ? blocsHTML(b.enfants, ctx) : "";
  switch (b.t) {
    case "paragraph": { const h = rt(b.r, ctx.fiches); return h || kids ? `<p>${h}</p>${kids}` : ""; }
    case "titre": return `<h4 class="n${b.niveau || 2}">${rt(b.r, ctx.fiches)}</h4>`;
    case "quote": return `<blockquote>${rt(b.r, ctx.fiches)}${kids}</blockquote>`;
    case "callout": return `<div class="pgcallout">${b.icone ? `<span aria-hidden="true">${esc(b.icone)}</span>` : ""}<div>${rt(b.r, ctx.fiches)}${kids}</div></div>`;
    case "code": return `<pre><code>${esc(plain(b.r))}</code></pre>`;
    case "divider": return `<hr>`;
    case "groupe": return kids;
    case "table": return table(b, ctx);
    case "toggle": {
      const id = b.id, k = `${ctx.entree}:${id}`;
      const open = b.differe ? OUVERTS.has(k) : (b.ouvert && !OUVERTS.has(`ferme:${k}`)) || OUVERTS.has(k);
      const titre = rt(b.r, ctx.fiches) || "Détails";
      return `<details class="pgtg ${b.niveau ? "h" + b.niveau : ""}" data-bloc="${esc(id)}" ${b.differe ? "data-differe" : ""} ${open ? "open" : ""}><summary>${titre}</summary>${b.differe ? (open ? enfantsDiffere(b, ctx) : `<div class="pgkids" data-kids></div>`) : `<div class="pgkids">${kids}</div>`}</details>`;
    }
    case "page": {
      const k = `${ctx.entree}:${b.page}`, open = OUVERTS.has(k);
      const f = ctx.fiches?.[b.page];
      const lien = f && ROUTE[f.base] ? `<a class="lnk" href="#/${ROUTE[f.base]}/${b.page}">Ouvrir la fiche</a>` : `<a href="${esc(notionUrl(b.page))}" target="_blank" rel="noopener">Ouvrir dans Notion</a>`;
      return `<details class="pgsub" data-bloc="${esc(b.page)}" data-differe ${open ? "open" : ""}><summary>${ic("note", "ic-sm")}<span>${esc(b.titre || "Sous-page")}</span><small>Sous-page</small></summary>${open ? enfantsDiffere(b, ctx) : `<div class="pgkids" data-kids></div>`}<p class="small">${lien}</p></details>`;
    }
    case "sous_page": return `<div class="pgsec"><p class="small muted">${ic("note", "ic-sm")} Compte rendu lu dans la sous-page <a href="${esc(b.url)}" target="_blank" rel="noopener"><b>${esc(b.titre)}</b></a></p>${kids || `<p class="empty">Page vide.</p>`}</div>`;
    case "lien": return `<p><a href="${esc(b.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")} ${esc(b.titre)}</a></p>`;
    case "fichier": return `<p class="small">📎 ${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.nom)}</a>` : `${esc(b.nom)}, <a href="${esc(ctx.url)}" target="_blank" rel="noopener">à ouvrir dans Notion</a>`}</p>`;
    case "tronque": return suite(ctx);
    case "inconnu": return `<p class="small muted">Un bloc Notion (${esc(b.nom || "inconnu")}) ne se lit pas ici, <a href="${esc(ctx.url)}" target="_blank" rel="noopener">voir la page dans Notion</a>.</p>`;
    default: return kids;
  }
}

// Tableau simple. Sur téléphone, chaque ligne devient une carte (intitulé de colonne devant chaque cellule).
function table(b, ctx) {
  const rows = b.lignes || [];
  if (!rows.length) return "";
  const head = b.entete ? rows[0] : null, body = b.entete ? rows.slice(1) : rows;
  const labs = head ? head.map((c) => plain(c)) : [];
  return `<div class="pgtbl${head ? " stack" : ""}"><table>${head ? `<thead><tr>${head.map((c) => `<th>${rt(c, ctx.fiches)}</th>`).join("")}</tr></thead>` : ""}<tbody>${body.map((r) => `<tr>${r.map((c, i) => `<td${labs[i] ? ` data-l="${esc(labs[i])}"` : ""}>${rt(c, ctx.fiches)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

/**
 * HTML du compte rendu.
 * @param {object|null} c réponse de GET /journal/:id/contenu (null : chargement)
 * @param {{entree:string, url:string, erreur?:string}} o
 */
export function contenuHTML(c, o) {
  if (o.erreur) return `<div class="pgbody"><p class="empty">${esc(o.erreur)}</p></div>`;
  if (!c) return `<div class="pgbody"><p class="empty">Chargement depuis Notion…</p></div>`;
  if (c.vide) return `<div class="pgbody"><p class="empty">${esc(o.vide || "Pas de compte rendu dans Notion.")}</p></div>`;
  const ctx = { entree: o.entree, url: o.url, fiches: c.fiches || {} };
  return `<div class="pgbody" data-pgentree="${esc(o.entree)}" data-pgsrc="${esc(o.src || "journal")}">${blocsHTML(c.blocs, ctx)}${c.tronque ? suite(ctx) : ""}</div>`;
}

const LIRE_BLOC = { journal: (e, b) => journalApi.bloc(e, b), contacts: (e, b) => contactsApi.memoireBloc(e, b) };

/** Ouverture d'une bascule ou d'une sous-page : lecture à la demande, puis redessin par la vue. */
export function bindContenu(root, redessiner, src = "journal") {
  root.addEventListener("toggle", async (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.bloc) return;
    const box = d.closest("[data-pgentree]");
    const entree = box?.dataset.pgentree;
    if (!entree || (box.dataset.pgsrc || "journal") !== src) return;
    const k = `${entree}:${d.dataset.bloc}`;
    if (!("differe" in d.dataset)) { if (d.open) { OUVERTS.add(k); OUVERTS.delete(`ferme:${k}`); } else { OUVERTS.delete(k); OUVERTS.add(`ferme:${k}`); } return; }
    if (!d.open) { OUVERTS.delete(k); return; }
    OUVERTS.add(k);
    if ((LUS.has(k) && !LUS.get(k).erreur) || EN_COURS.has(k)) return;
    EN_COURS.add(k);
    const kids = d.querySelector(":scope > [data-kids]");
    if (kids) kids.innerHTML = `<p class="empty">Chargement depuis Notion…</p>`;
    try { const r = await LIRE_BLOC[src](entree, d.dataset.bloc); LUS.set(k, { blocs: r.blocs, fiches: r.fiches || {}, tronque: r.tronque }); }
    catch (err) { LUS.set(k, { erreur: err.message || "Notion n'a pas répondu." }); }
    finally { EN_COURS.delete(k); }
    redessiner();
  }, true);
}

/** Relecture forcée (bouton « Relire dans Notion ») : les blocs dépliés de l'entrée sont relus aussi. */
export function oublierBlocs(entree) { for (const k of [...LUS.keys()]) if (k.startsWith(entree + ":")) LUS.delete(k); }

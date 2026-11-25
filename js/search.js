// Recherche globale de l'en-tête (repris du POC) : contacts, tâches ouvertes et projets déjà lus
// par les vues. Pistes et échanges s'ajouteront avec leurs modules (lots 2 et 6).
import { projetsIndex } from "./api.js";
import { contactIndex } from "./contacts.js";
import { taskIndex } from "./todo.js";
import { $, esc, ic, av, nrm, etatLabel } from "./ui.js";

let data = null, loading = null, box = null;

async function ensure() {
  if (data) return data;
  if (!loading) {
    loading = Promise.allSettled([contactIndex(), taskIndex(), projetsIndex()]).then(([c, t, p]) => {
      data = { contacts: c.value || [], taches: t.value || [], projets: p.value || [], partial: [c, t, p].some((x) => x.status !== "fulfilled") };
      loading = null;
      return data;
    });
  }
  return loading;
}

export function mountSearch(el) {
  if (!el) return;
  box = el;
  data = null; // relu à chaque changement de vue pour rester à jour
  el.innerHTML = `${ic("search")}<label class="sr" for="gq">Rechercher</label>
    <input id="gq" type="search" placeholder="Chercher un contact, une tâche, un projet…" autocomplete="off">
    <div class="sres" id="gres" hidden></div>`;
  const input = $("#gq", el), res = $("#gres", el);
  const paint = async () => {
    const q = nrm(input.value.trim());
    if (q.length < 2) { res.hidden = true; res.innerHTML = ""; return; }
    res.hidden = false;
    if (!data) res.innerHTML = `<p class="small muted" style="padding:8px">Lecture depuis Notion…</p>`;
    const d = await ensure();
    if (nrm(input.value.trim()) !== q) return;
    const words = q.split(/\s+/);
    const hit = (s) => { const h = nrm(s); return words.every((w) => h.includes(w)); };
    const C = d.contacts.filter((c) => hit([c.nom, c.position, ...(c.typeOrg || [])].join(" "))).slice(0, 6);
    const T = d.taches.filter((t) => hit([t.nom, t.typeAction].join(" "))).slice(0, 6);
    const P = d.projets.filter((p) => hit(p.nom)).slice(0, 5);
    const grp = (lab, items, fn) => items.length ? `<div class="sg">${lab}</div>${items.map(fn).join("")}` : "";
    const html = grp("Contacts", C, (c) => `<a href="#/contacts/${c.id}">${av(c)}<span>${esc(c.nom)}${c.position ? ` <span class="small muted">· ${esc(c.position)}</span>` : ""}</span></a>`)
      + grp("Tâches ouvertes", T, (t) => `<a href="#/todo/${t.id}"><span class="ifmt sm">${ic("todo", "ic-sm")}</span><span>${esc(t.nom)} <span class="small muted">· ${esc(etatLabel(t.etat))}</span></span></a>`)
      + grp("Projets", P, (p) => `<a href="#/projets/${p.id}"><span class="ifmt sm">${ic("folder", "ic-sm")}</span><span>${esc(p.nom)} <span class="small muted">· ${esc(p.etat || "")}</span></span></a>`);
    res.innerHTML = (html || `<p class="small muted" style="padding:8px">Aucun résultat.</p>`)
      + (d.partial ? `<p class="small muted" style="padding:6px 8px">Une des bases n'a pas pu être lue, résultats incomplets.</p>` : "");
  };
  input.addEventListener("input", paint);
  input.addEventListener("focus", () => { ensure(); if (input.value.trim().length >= 2) paint(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { input.value = ""; paint(); el.classList.remove("open"); input.blur(); e.stopPropagation(); }
    if (e.key === "Enter") { const a = res.querySelector("a"); if (a) { e.preventDefault(); location.hash = a.getAttribute("href"); } }
  });
  res.addEventListener("click", (e) => { if (e.target.closest("a")) { input.value = ""; res.hidden = true; el.classList.remove("open"); } });
}

// Fermeture au clic ailleurs, ouverture par l'icône loupe sur téléphone.
document.addEventListener("click", (e) => {
  if (!box) return;
  if (e.target.closest('[data-act="opensearch"]')) { box.classList.add("open"); setTimeout(() => $("#gq", box)?.focus(), 0); return; }
  if (!e.target.closest("#search")) { const r = $("#gres", box); if (r) r.hidden = true; box.classList.remove("open"); }
});

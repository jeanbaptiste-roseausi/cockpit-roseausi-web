// Vue « Contacts » : liste des contacts actifs et fiche modifiable.
// Chaque vue du cockpit expose la même interface : { id, label, icon, render(), open(id) }.
import { contactsApi } from "./api.js";
import { $, esc, ic, av, nrm, fd, due, chip, toast } from "./ui.js";

const S = {
  items: null, schema: null, loading: false, error: null, fetchedAt: null,
  f: { q: "", type: "tous", parcours: "" },
  open: null, // fiche ouverte : { id, contact, values, saving: Set }
};

const FIELD_ORDER = [
  "Parcours réseau", "Prio", "Qualif Prospect", "Prochaine action", "Date prochaine action",
  "Dernier échange", "Position", "Type", "Email", "Phone", "Linkedin", "Site web",
];
const LABEL = { Phone: "Téléphone", Linkedin: "LinkedIn", Email: "Mail", "Parcours réseau": "Statut (parcours réseau)" };
const colorOf = (prop, val) => S.schema?.editable?.[prop]?.colors?.[val];

let host = null;      // conteneur de la vue
let drawerHost = null;

export const contactsView = {
  id: "contacts",
  label: "Contacts",
  icon: "users",
  async mount(container, drawer) {
    host = container; drawerHost = drawer;
    render();
    if (!S.items) await load();
  },
  open: openContact,
  close: () => { S.open = null; },
  reload: () => load(true),
};

async function load(force = false) {
  if (S.loading) return;
  S.loading = true; S.error = null; render();
  try {
    const [list, schema] = await Promise.all([contactsApi.list(), S.schema && !force ? S.schema : contactsApi.schema()]);
    S.items = list.contacts; S.fetchedAt = list.fetchedAt; S.schema = schema;
  } catch (e) {
    S.error = e.message;
  } finally {
    S.loading = false; render();
  }
}

const orgName = (id) => S.items?.find((c) => c.id === id)?.nom;
const subOf = (c) => [c.position, ...(c.rattacheA || []).map(orgName).filter(Boolean)].filter(Boolean).join(" · ")
  || (c.typeOrg || []).join(", ");

function filtered() {
  const f = S.f, q = nrm(f.q.trim());
  let list = S.items || [];
  if (f.type !== "tous") list = list.filter((c) => c.type === f.type);
  if (f.parcours) list = list.filter((c) => (f.parcours === "__none" ? !c.parcours : c.parcours === f.parcours));
  if (q) list = list.filter((c) => nrm([c.nom, c.position, c.prochaineAction, subOf(c), ...(c.typeOrg || [])].join(" ")).includes(q));
  return list;
}

function render() {
  if (!host) return;
  const f = S.f;
  const seg = (v, lab) => `<button class="${f.type === v ? "on" : ""}" data-type="${v}">${lab}</button>`;
  const opts = S.schema?.editable?.["Parcours réseau"]?.options || [];
  const head = `
    <div class="bar">
      <div class="seg" role="group" aria-label="Type de fiche">${seg("tous", "Tous")}${seg("Personne", "Personnes")}${seg("Organisation", "Organisations")}${seg("Réseau", "Réseaux")}</div>
      <label class="sr" for="cf-p">Statut</label>
      <select class="sel" id="cf-p"><option value="">Tous statuts</option>${opts.map((o) => `<option ${f.parcours === o ? "selected" : ""}>${esc(o)}</option>`).join("")}<option value="__none" ${f.parcours === "__none" ? "selected" : ""}>Sans statut</option></select>
      <label class="sr" for="cf-q">Filtrer</label>
      <input class="inp grow" id="cf-q" type="search" placeholder="Nom, poste, organisation…" value="${esc(f.q)}" autocomplete="off">
    </div>`;

  let body;
  if (S.error) body = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(S.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`;
  else if (!S.items) body = `<div class="card"><p class="empty">Chargement des contacts depuis Notion…</p></div>`;
  else {
    const list = filtered();
    body = `<p class="small muted" style="margin:-4px 0 10px">${list.length} fiche${list.length > 1 ? "s" : ""} sur ${S.items.length} contacts actifs${S.fetchedAt ? `, lus dans Notion à ${new Date(S.fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}${S.loading ? ", mise à jour…" : ""}.</p>
      ${list.length ? `<div class="card"><div class="list">${list.slice(0, 400).map(row).join("")}</div></div>` : `<p class="empty">Aucun contact pour ces filtres.</p>`}
      ${list.length > 400 ? `<p class="small muted" style="margin-top:8px">Seules les 400 premières fiches sont affichées, affine le filtre.</p>` : ""}`;
  }
  // Conserve le focus et la position du curseur dans le champ de recherche pendant la frappe.
  const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  host.innerHTML = head + body;
  if (active === "cf-q") { const i = $("#cf-q", host); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* */ } }
}

function row(c) {
  return `<a class="row" href="#/contacts/${c.id}">${av(c)}
    <div class="rm"><div class="rt">${esc(c.nom)}</div><div class="rs">${esc(subOf(c)) || "&nbsp;"}</div>
      ${c.prochaineAction ? `<div class="rs clamp2">${ic("arrow", "ic-sm")} ${esc(c.prochaineAction)}</div>` : ""}</div>
    <div class="rr">${chip(c.parcours, colorOf("Parcours réseau", c.parcours))}${c.prio === "P1" ? chip("P1", "red") : c.prio ? chip(c.prio) : ""}${due(c.dateProchaineAction)}</div></a>`;
}

// ---------------- Fiche ----------------

async function openContact(id) {
  const fromList = S.items?.find((c) => c.id === id);
  S.open = { id, contact: fromList ? { ...fromList, partial: true } : null, values: null, saving: new Set(), error: null };
  renderDrawer();
  try {
    if (!S.schema) S.schema = await contactsApi.schema();
    const r = await contactsApi.get(id);
    if (S.open?.id !== id) return;
    S.open.contact = r.contact; S.open.values = r.values;
  } catch (e) {
    if (S.open?.id !== id) return;
    S.open.error = e.message;
  }
  renderDrawer();
}

function renderDrawer() {
  const o = S.open;
  if (!o || !drawerHost) return;
  $("#dr-kind").textContent = o.contact?.type === "Organisation" ? "Organisation" : o.contact?.type === "Réseau" ? "Réseau" : "Contact";
  const c = o.contact;
  if (!c) {
    drawerHost.innerHTML = o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : `<p class="empty">Chargement de la fiche…</p>`;
    return;
  }
  const tel = c.phone ? c.phone.replace(/\s/g, "") : "";
  const acts = [
    c.url ? `<a class="btn sm" href="${esc(c.url)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Ouvrir dans Notion</a>` : "",
    tel ? `<a class="btn sm" href="tel:${esc(tel)}">${ic("call", "ic-sm")}Appeler</a>` : "",
    c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}">${ic("mail", "ic-sm")}Écrire</a>` : "",
    c.linkedin ? `<a class="btn sm" href="${esc(c.linkedin)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}LinkedIn</a>` : "",
  ].join("");
  const rel = c.relations || {};
  const n = (r) => r ? `${r.n}${r.more ? "+" : ""}` : "0";

  drawerHost.innerHTML = `
    <div class="dh">${av(c, "lg")}<div style="flex:1;min-width:0"><h1>${esc(c.nom)}</h1><div class="sub">${esc(subOf(c))}</div>
      <div class="chips" style="margin-top:8px">${c.type ? `<span class="chip">${esc(c.type)}</span>` : ""}${chip(c.qualif, colorOf("Qualif Prospect", c.qualif))}${c.prio ? chip(c.prio, colorOf("Prio", c.prio)) : ""}</div></div></div>
    ${acts ? `<div class="dact">${acts}</div>` : ""}
    ${o.error ? `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(o.error)}</span></div>` : ""}
    <div class="sfacts">
      <div><span>Statut</span><b>${c.parcours ? esc(c.parcours) : "Non renseigné"}</b></div>
      <div><span>Dernier échange</span><b>${c.dernierEchange ? esc(fd(c.dernierEchange)) : "Aucun"}</b></div>
      <div><span>Prochaine action</span><b>${c.prochaineAction ? esc(c.prochaineAction) : "Rien de prévu"}</b>${c.dateProchaineAction ? `<small>${due(c.dateProchaineAction)}</small>` : ""}</div>
      <div><span>Liens dans Notion</span><b class="small">${n(rel.opportunites)} opportunité(s) · ${n(rel.todo)} tâche(s) · ${n(rel.journal)} échange(s)</b>${c.partial ? "" : `<small>Recommandé par ${n(rel.recommandePar)} · a recommandé ${n(rel.aRecommande)}</small>`}</div>
    </div>
    <section class="sec"><h2>Fiche</h2>${o.values ? form(o) : `<p class="empty">Chargement des champs…</p>`}</section>
    ${c.notesContact ? `<section class="sec"><h2>Notes</h2><p class="notes">${esc(c.notesContact)}</p></section>` : ""}
    ${c.notesEntreprise ? `<section class="sec"><h2>Notes entreprise</h2><p class="notes">${esc(c.notesEntreprise)}</p></section>` : ""}
    ${c.syntheseAgent ? `<section class="sec"><h2>Synthèse agent</h2><p class="notes">${esc(c.syntheseAgent)}</p></section>` : ""}
    ${c.modifie ? `<p class="small muted">Modifié dans Notion le ${esc(new Date(c.modifie).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }))}. Les notes se modifient dans Notion.</p>` : ""}`;
}

function form(o) {
  const ed = S.schema?.editable || {};
  return `<form class="form" data-contact="${o.id}" onsubmit="return false">${FIELD_ORDER.filter((k) => ed[k]).map((k) => field(k, ed[k], o.values[k], o.saving.has(k))).join("")}</form>`;
}

function field(name, def, value, saving) {
  const id = "fx-" + nrm(name).replace(/[^a-z0-9]+/g, "-");
  const lab = `<label for="${id}">${esc(LABEL[name] || name)} <span class="fstate" data-state="${esc(name)}">${saving ? "Enregistrement…" : ""}</span></label>`;
  const attrs = `id="${id}" data-prop="${esc(name)}" ${saving ? "disabled" : ""}`;
  const v = value ?? "";
  let input;
  if (def.options) {
    const opts = def.options.includes(v) || !v ? def.options : [v, ...def.options];
    input = `<select ${attrs}><option value="">Non renseigné</option>${opts.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  } else if (def.type === "date") input = `<input type="date" ${attrs} value="${esc(String(v).slice(0, 10))}">`;
  else if (def.type === "email") input = `<input type="email" ${attrs} value="${esc(v)}" autocomplete="off">`;
  else if (def.type === "phone_number") input = `<input type="tel" ${attrs} value="${esc(v)}" autocomplete="off">`;
  else if (def.type === "url") input = `<input type="url" ${attrs} value="${esc(v)}" placeholder="https://" autocomplete="off">`;
  else input = `<textarea ${attrs} rows="2">${esc(v)}</textarea>`;
  return `<div class="fld">${lab}${input}</div>`;
}

// Enregistrement d'un champ dès qu'il change (sélection) ou à la sortie du champ (texte).
export async function saveField(el) {
  const o = S.open, prop = el.dataset.prop;
  if (!o || !o.values || !prop) return;
  const before = o.values[prop] ?? "";
  const val = el.value.trim();
  const cmp = (x) => String(x ?? "").slice(0, S.schema.editable[prop]?.type === "date" ? 10 : undefined);
  if (cmp(before) === val) return;
  o.saving.add(prop);
  const st = drawerHost.querySelector(`[data-state="${CSS.escape(prop)}"]`);
  if (st) st.textContent = "Enregistrement…";
  el.disabled = true;
  try {
    const r = await contactsApi.update(o.id, { [prop]: val || null });
    o.contact = r.contact; o.values = r.values;
    // Répercute dans la liste sans tout recharger.
    if (S.items) {
      const i = S.items.findIndex((c) => c.id === o.id);
      const { id, nom, type, position, parcours, prio, qualif, prochaineAction, dateProchaineAction, dernierEchange, typeOrg, rattacheA, modifie } = r.contact;
      const item = { id, nom, type, position, parcours, prio, qualif, prochaineAction, dateProchaineAction, dernierEchange, typeOrg, rattacheA, modifie };
      if (i >= 0) S.items[i] = item;
    }
    toast(`${LABEL[prop] || prop} enregistré dans Notion.`);
  } catch (e) {
    toast(e.message, "err");
  } finally {
    o.saving.delete(prop);
    renderDrawer(); render();
  }
}

// Délégation d'événements pour la liste.
export function bindContactEvents(root) {
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-type]");
    if (t) { S.f.type = t.dataset.type; render(); return; }
    if (e.target.closest('[data-act="reload"]')) load(true);
  });
  root.addEventListener("input", (e) => { if (e.target.id === "cf-q") { S.f.q = e.target.value; render(); } });
  root.addEventListener("change", (e) => { if (e.target.id === "cf-p") { S.f.parcours = e.target.value; render(); } });
}
export function bindDrawerEvents(root) {
  root.addEventListener("change", (e) => { if (e.target.dataset?.prop) saveField(e.target); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset?.prop && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); }
  });
}

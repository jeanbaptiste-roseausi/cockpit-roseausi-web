// Lot 5b (26/11/2026) : liaison Google, Réglages, À traiter, et blocs Google partagés (Ma journée, Journal,
// fiche Contact). Chaque bloc Google se charge à part et dit sa source et son heure de lecture : une panne de
// Google n'empêche pas le reste de la page de s'afficher. Rien ne s'envoie depuis le cockpit.
import { googleApi, googleAuthApi, journeeApi, journalApi } from "./api.js";
import { esc, ic, fd, toast } from "./ui.js";

// ---------------- Petit magasin des lectures Google (une entrée par bloc) ----------------

const store = new Map();
/**
 * Lecture d'un bloc : renvoie l'entrée { data, error, loading } et lance le chargement s'il le faut.
 * `rerender` est rappelé quand la lecture se termine. maxAgeMs : âge au-delà duquel la page redemande
 * (la fonction a son propre cache court).
 */
export function gread(key, loader, rerender, { frais = false, maxAgeMs = 90_000 } = {}) {
  let e = store.get(key);
  if (!e) { e = { data: null, error: null, loading: false, at: 0 }; store.set(key, e); }
  e.rerender = rerender;
  if (!e.loading && (frais || !e.at || Date.now() - e.at > maxAgeMs)) {
    e.loading = true;
    // « Non relié » (relie: false) arrive en réponse normale : rangé comme un état du bloc, sans données.
    loader(frais).then((d) => { if (d?.relie === false) { e.data = null; e.error = d; } else { e.data = d; e.error = null; } }).catch((err) => { e.error = err; })
      .finally(() => { e.loading = false; e.at = Date.now(); e.rerender?.(); });
  }
  return e;
}
export const gforget = () => store.clear();

const hm = (iso) => iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", " h ") : "";
/** Source et heure d'un bloc Google. */
export const gsrc = (d) => d ? `<span class="gsrc">${esc(d.source)}, lu à ${esc(hm(d.lu))}${d.cache ? " (cache de quelques minutes)" : ""}</span>` : "";

const LIAISON = new Set(["google_non_relie", "google_non_configure", "google_revoque", "google_compte", "google_droits", "google_client", "google_api"]);
/** Bloc en attente, en panne ou non relié ; null si les données sont là. */
export function gstate(e, { quoi = "Google" } = {}) {
  // Non relié ou pas encore configuré : réponse normale de la fonction (relie: false), pas une erreur.
  const err = e.error ?? (e.data?.relie === false ? e.data : null);
  if (err) {
    if (LIAISON.has(err.code)) {
      return `<div class="gnote">${ic("link", "ic-sm")}<span>${esc(err.message)} ${err.code === "google_non_configure" ? `<a class="lnk" href="#/reglages">Voir la procédure</a>` : `<a class="btn sm pri" href="#/reglages">${err.code === "google_non_relie" ? "Relier Google" : "Réglages"}</a>`}</span></div>`;
    }
    return `<div class="gnote warn">${ic("alert", "ic-sm")}<span>${esc(err.message || `${quoi} ne répond pas.`)} <button class="lnk" data-gretry>Réessayer</button></span></div>`;
  }
  if (!e.data) return `<p class="empty">Lecture de ${esc(quoi)}…</p>`;
  return null;
}

// ---------------- Lignes partagées ----------------

const FICHE = { contacts: ["contacts", "users"], pistes: ["pistes", "target"], projets: ["projets", "folder"] };
export const ficheChip = (f) => { const [v, i] = FICHE[f.base] || ["contacts", "users"]; return `<a class="chip ${f.base === "projets" ? "pj" : f.base === "pistes" ? "pi" : ""}" href="#/${v}/${f.id}" title="${f.par ? esc("Relié par " + f.par) : ""}">${ic(i, "ic-sm")}${esc(f.nom)}</a>`; };

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
export function jourLabel(iso, today) {
  if (iso === today) return "Aujourd'hui";
  const d = new Date(iso + "T12:00:00Z"), t = new Date(today + "T12:00:00Z");
  const n = Math.round((d - t) / 86_400_000);
  return n === 1 ? "Demain" : `${JOURS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Rendez-vous : heure, titre, fiches reliées, liens visio et agenda. */
export function rdvRow(r) {
  const h = r.journee ? "Journée" : `${hm(r.debut)}${r.fin ? `<small>${hm(r.fin)}</small>` : ""}`;
  const ext = r.participants.filter((p) => !p.contact).length;
  return `<div class="row rdv"><span class="rdv-h">${h}</span><div class="rm"><div class="rt">${r.lien ? `<a class="lnk ttl" href="${esc(r.lien)}" target="_blank" rel="noopener">${esc(r.titre)}</a>` : esc(r.titre)}</div>
    <div class="chips" style="margin-top:6px">${r.fiches.map(ficheChip).join("")}${ext ? `<span class="chip">${ext} autre${ext > 1 ? "s" : ""} participant${ext > 1 ? "s" : ""}</span>` : ""}${r.reponse === "needsAction" ? `<span class="chip st-attente">À répondre</span>` : r.reponse === "tentative" ? `<span class="chip">Peut-être</span>` : ""}${!r.fiches.length ? `<span class="chip dash">Aucune fiche reliée</span>` : ""}</div>
    ${r.lieu ? `<div class="rs clamp2">${esc(r.lieu)}</div>` : ""}</div>
    <div class="rr">${r.visio ? `<a class="btn sm" href="${esc(r.visio)}" target="_blank" rel="noopener">Visio</a>` : ""}</div></div>`;
}

/** Fil Gmail : objet, expéditeur, extrait, contacts, lien vers Gmail (l'envoi reste dans Gmail). */
export function filRow(f, { attente = false } = {}) {
  const de = f.dernier.deMoi ? "Toi" : (f.dernier.de?.nom || f.dernier.de?.email || "");
  return `<div class="row gfil"><span class="ifmt sm gm">${ic("mail", "ic-sm")}</span><div class="rm"><div class="rt"><a class="lnk ttl" href="${esc(f.lien)}" target="_blank" rel="noopener">${esc(f.sujet)}</a></div>
    <div class="rs">${esc(de)} · ${esc(fd(f.dernier.le.slice(0, 10)))} à ${esc(hm(f.dernier.le))}${f.nbMessages > 1 ? ` · ${f.nbMessages} messages` : ""}</div>
    ${f.extrait ? `<div class="rs clamp2 muted">${esc(f.extrait)}</div>` : ""}
    <div class="chips" style="margin-top:6px">${f.contacts.map((c) => ficheChip(c)).join("")}${!f.contacts.length ? `<span class="chip dash">Aucun contact du miroir</span>` : ""}${attente ? `<span class="chip st-attente">${f.joursOuvres} jours ouvrés sans réponse</span>` : ""}</div></div>
    <div class="rr"><a class="btn sm" href="${esc(f.lien)}" target="_blank" rel="noopener">${ic("ext", "ic-sm")}Gmail</a></div></div>`;
}

// ---------------- Réglages ----------------

const R = { etat: null, error: null, busy: false, issue: null };
let rHost = null;

const ISSUES = {
  relie: ["ok", "Google est relié : lecture de Gmail et de l'agenda, brouillons et envoi Gmail."],
  refus: ["warn", "Tu as refusé l'accès chez Google : rien n'a été relié."],
  compte: ["warn", "Ce compte Google n'est pas jeanbaptiste@roseausi.fr : l'accès a été retiré aussitôt, rien n'a été relié."],
  droits: ["warn", "Une des trois cases (lecture Gmail, brouillons et envoi, Agenda) n'a pas été cochée : rien n'a été relié. Recommence et coche les trois."],
  api: ["warn", "Gmail API n'est pas encore activée dans le projet Google Cloud : active-la (étape 2 de la procédure) puis recommence."],
  client: ["warn", "Google refuse l'identifiant client : vérifie GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans les secrets Supabase."],
  "sans-jeton": ["warn", "Google n'a pas renvoyé de jeton de rafraîchissement : délie puis relie à nouveau."],
  erreur: ["warn", "La liaison n'a pas abouti. Réessaie dans un instant."],
};
/** Issue du retour de Google (?google=… avant le fragment), lue une fois au chargement de la page. */
export function lireIssueGoogle() {
  const q = new URLSearchParams(location.search);
  const v = q.get("google");
  if (!v) return;
  q.delete("google");
  history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
  R.issue = ISSUES[v] ? v : "erreur";
  gforget();
  const [k, msg] = ISSUES[R.issue];
  setTimeout(() => toast(msg, k === "ok" ? "" : "err"), 300);
}

export const reglagesView = {
  id: "reglages", label: "Réglages", short: "Réglages", icon: "gear",
  async mount(c) { rHost = c; renderR(); await loadR(); },
  open() {}, close() {},
  reload: () => loadR(),
};

async function loadR() {
  try { R.etat = await googleAuthApi.etat(); R.error = null; } catch (e) { R.error = e.message; }
  renderR();
}

const dt = (iso) => iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }) : "";
const ERR = { revoque: "Google a refusé le jeton (accès retiré, inutilisé six mois ou mot de passe changé) : relie à nouveau.", compte: "Le compte relié n'est pas le bon : délie puis relie.", droits: "Un droit manque : relie à nouveau en cochant les trois cases.", client: "Google refuse l'identifiant client : vérifie les secrets Supabase." };

function renderR() {
  if (!rHost) return;
  if (R.error) { rHost.innerHTML = `<div class="banner">${ic("alert", "ic-sm")}<span>${esc(R.error)} <button class="lnk" data-act="reload">Réessayer</button></span></div>`; return; }
  const e = R.etat;
  if (!e) { rHost.innerHTML = `<div class="card"><p class="empty">Lecture des réglages…</p></div>`; return; }
  const issue = R.issue && ISSUES[R.issue];
  const droits = (e.relie ? e.scopes : e.droitsDemandes).map((s) => `<li>${esc(s.libelle)} <code>${esc(s.scope.replace("https://www.googleapis.com/auth/", ""))}</code></li>`).join("");
  let corps;
  if (!e.configure) {
    corps = `<p>Le cockpit n'a pas encore d'identifiant client Google. Jean-Baptiste le crée dans Google Cloud Console (procédure dans le README, section « Lot 5b »), puis l'enregistre lui-même dans Supabase › Edge Functions › Secrets sous les noms <code>GOOGLE_CLIENT_ID</code> et <code>GOOGLE_CLIENT_SECRET</code>. Personne d'autre ne saisit ces valeurs.</p>
      <div class="fld"><label for="g-ret">Adresse de retour à déclarer dans l'identifiant OAuth (Application Web)</label><input class="inp" id="g-ret" readonly value="${esc(e.adresseRetour)}"></div>
      <p class="small muted">Après l'enregistrement des secrets, cette page propose le bouton « Relier Google ».</p>`;
  } else if (!e.relie) {
    corps = `<p>Relie le compte <b>${esc(e.compteAttendu)}</b>. Google affiche son écran de consentement, tu acceptes, et tu reviens ici. Tu ne manipules aucun jeton.</p>
      <p><button class="btn pri" data-gact="relier" ${R.busy ? "disabled" : ""}>${ic("link", "ic-sm")}${R.busy ? "Ouverture de Google…" : "Relier Google"}</button></p>`;
  } else {
    corps = `<div class="sfacts"><div><span>Compte</span><b>${esc(e.compte)}</b></div><div><span>Relié le</span><b>${esc(dt(e.relieLe))}</b></div><div><span>Dernière lecture</span><b>${e.dernierUsage ? esc(dt(e.dernierUsage)) : "Pas encore"}</b></div></div>
      ${e.erreur ? `<div class="banner" style="margin-top:10px">${ic("alert", "ic-sm")}<span>${esc(ERR[e.erreur] || e.erreur)} (${esc(dt(e.erreurLe))})</span></div>` : ""}
      <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-gact="relier" ${R.busy ? "disabled" : ""}>${ic("refresh", "ic-sm")}Relier à nouveau</button><button class="btn" data-gact="delier" ${R.busy ? "disabled" : ""}>${ic("close", "ic-sm")}${R.busy ? "…" : "Délier"}</button></p>`;
  }
  rHost.innerHTML = `${issue ? `<div class="banner ${issue[0] === "ok" ? "info" : ""}" style="margin-bottom:12px">${ic(issue[0] === "ok" ? "check" : "alert", "ic-sm")}<span>${esc(issue[1])}</span></div>` : ""}
    <section class="card"><div class="card-h"><h2>Google (Gmail et Agenda)</h2><span class="chip ${e.relie ? "c-good" : "dash"}">${e.relie ? "Relié" : e.configure ? "Non relié" : "À configurer"}</span></div>
      ${corps}
      <h3 class="sh">Droits ${e.relie ? "accordés" : "demandés"}</h3><ul class="glist">${droits}</ul>
      ${e.relie && !e.scopes.some((s) => /gmail\.compose$/.test(s.scope)) ? `<div class="banner" style="margin-bottom:8px">${ic("alert", "ic-sm")}<span>Le droit « brouillons et envoi » n'est pas accordé : Relier à nouveau pour le donner. La lecture continue en attendant.</span></div>` : ""}<p class="small muted">Le cockpit lit Gmail et l'agenda. Il peut aussi préparer un brouillon dans Gmail et l'envoyer à ta demande (décision du 27/11/2026) ; aucun bouton d'envoi dans le cockpit pour l'instant, rien ne part sans ton accord.</p></section>
    <section class="card" style="margin-top:14px"><div class="card-h"><h2>Retirer l'accès</h2></div>
      <p class="small">Deux façons, à tout moment. Ici, <b>Délier</b> retire l'accès chez Google et efface le jeton gardé par le cockpit. Ou dans ton compte Google, <a class="lnk" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Applications tierces ayant accès à ton compte</a>, choisis « Cockpit RoseauSI » puis supprime son accès ; le cockpit affichera alors « relie Google à nouveau ».</p>
      <p class="small muted">Ce que garde le cockpit : l'adresse du compte, les droits accordés et les dates. Le jeton est chiffré dans Supabase Vault. Le contenu des mails et des rendez-vous n'est jamais enregistré, il reste quelques minutes en mémoire de la fonction.</p></section>`;
}

async function relier() {
  R.busy = true; renderR();
  try {
    const { url } = await googleAuthApi.debut(location.origin + location.pathname);
    location.assign(url);
  } catch (e) { toast(e.message, "err"); R.busy = false; renderR(); }
}
async function delier() {
  if (!confirm("Délier Google ? L'accès est retiré chez Google et le jeton effacé. Tu pourras relier à nouveau quand tu veux.")) return;
  R.busy = true; renderR();
  try { const r = await googleAuthApi.delier(); gforget(); R.issue = null; toast(r.revoque ? "Google délié, accès retiré chez Google." : "Google délié ici. Vérifie dans ton compte Google que l'accès a bien disparu.", r.revoque ? "" : "err"); }
  catch (e) { toast(e.message, "err"); }
  finally { R.busy = false; await loadR(); }
}

// ---------------- À traiter (file unique) ----------------

const A = { relire: null, rattacher: null, f: { contacts: false } };
let aHost = null;

export const aTraiterView = {
  id: "a-traiter", label: "À traiter", short: "À traiter", icon: "inbox",
  async mount(c) { aHost = c; loadA(); renderA(); },
  open() {}, close() {},
  reload: () => { loadA(true); gread("a-traiter", googleApi.aTraiter, renderA, { frais: true }); renderA(); },
};

/** Les deux sources Notion de la file : tâches « Prêt à relire » (journee) et entrées du journal sans rattachement. */
function loadA(force = false) {
  if (force || !A.relire) { A.relire = { loading: true }; journeeApi.get().then((d) => { A.relire = { data: d }; }).catch((e) => { A.relire = { error: e }; }).finally(renderA); }
  if (force || !A.rattacher) { A.rattacher = { loading: true }; journalApi.list().then((d) => { A.rattacher = { data: d }; }).catch((e) => { A.rattacher = { error: e }; }).finally(renderA); }
}

function renderA() {
  if (!aHost || !aHost.isConnected) return;
  const m = gread("a-traiter", googleApi.aTraiter, renderA);
  const st = gstate(m, { quoi: "Gmail" });
  const fils = m.data ? m.data.fils.filter((f) => !A.f.contacts || f.contacts.length) : [];
  const rl = A.relire?.data, rt = A.rattacher?.data;
  const relire = rl ? rl.relire : [];
  const rattacher = rt ? rt.entrees.filter((e) => !e.projets.length && !e.pistes.length).slice(0, 20) : [];
  const n = (m.data ? m.data.fils.length : 0) + relire.length + (rt ? rt.entrees.filter((e) => !e.projets.length && !e.pistes.length).length : 0);
  aHost.innerHTML = `<p class="small muted" style="margin:0 0 12px">${n} élément${n > 1 ? "s" : ""} à traiter. Chaque bloc dit sa source. Une ligne traitée (mail répondu dans Gmail, tâche relue, entrée rattachée) sort de la file à la lecture suivante.</p>
    <section class="card"><div class="card-h"><h2>Mails sans réponse</h2>${m.data ? `<span class="count">${fils.length}</span>` : ""}
      ${m.data ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-afc ${A.f.contacts ? "checked" : ""}>Contacts seulement</label>` : ""}</div>
      ${st ?? `<p class="small muted" style="margin-bottom:6px">${esc(m.data.regle)} ${gsrc(m.data)}${m.loading ? ", mise à jour…" : ""}</p>
        <div class="list">${fils.map((f) => filRow(f, { attente: true })).join("") || `<p class="empty">Aucun mail en attente de réponse depuis deux jours ouvrés.</p>`}</div>
        <p class="small muted" style="margin-top:6px">Écartés : ${m.data.ecartes.automatiques} envoi${m.data.ecartes.automatiques > 1 ? "s" : ""} automatique${m.data.ecartes.automatiques > 1 ? "s" : ""}, ${m.data.ecartes.repondus} fil${m.data.ecartes.repondus > 1 ? "s" : ""} où tu as répondu, ${m.data.ecartes.recents} trop récent${m.data.ecartes.recents > 1 ? "s" : ""}, sur ${m.data.lus} fils lus.${m.data.plusDe ? " Seuls les 50 fils les plus récents de la boîte sont lus." : ""}</p>`}</section>
    <div class="grid2" style="margin-top:14px">
    <section class="card"><div class="card-h"><h2>À relire</h2>${rl ? `<span class="count">${relire.length}</span>` : ""}<a class="lnk" href="#/todo">TO DO</a></div>
      <p class="small muted" style="margin-bottom:6px">Tâches TO DO à l'état « Prêt à relire », depuis le miroir de Notion.</p>
      ${A.relire?.error ? `<p class="empty">${esc(A.relire.error.message)}</p>` : !rl ? `<p class="empty">Chargement…</p>` : `<div class="list">${relire.map((t) => `<a class="row" href="#/todo/${t.id}"><div class="rm"><div class="rt">${esc(t.nom)}</div></div><div class="rr">${t.echeance ? `<span class="due">${esc(fd(t.echeance))}</span>` : ""}</div></a>`).join("") || `<p class="empty">Rien à relire.</p>`}</div>`}</section>
    <section class="card"><div class="card-h"><h2>À rattacher</h2>${rt ? `<span class="count">${rt.entrees.filter((e) => !e.projets.length && !e.pistes.length).length}</span>` : ""}<a class="lnk" href="#/journal">Journal</a></div>
      <p class="small muted" style="margin-bottom:6px">Entrées du Journal de bord sans projet ni piste. Ouvre l'entrée pour la rattacher.</p>
      ${A.rattacher?.error ? `<p class="empty">${esc(A.rattacher.error.message)}</p>` : !rt ? `<p class="empty">Chargement…</p>` : `<div class="list">${rattacher.map((e) => `<a class="row" href="#/journal/${e.id}"><div class="rm"><div class="rt">${esc(e.titre)}</div><div class="rs">${esc(fd(String(e.date).slice(0, 10)))}${e.format ? " · " + esc(String(e.format).replace(/^[^\p{L}\p{N}]+/u, "")) : ""}</div></div></a>`).join("") || `<p class="empty">Toutes les entrées sont rattachées.</p>`}</div>`}</section>
    </div>`;
}

// ---------------- Événements ----------------

export function bindGoogleEvents(root) {
  root.addEventListener("click", (e) => {
    const a = e.target.closest("[data-gact]")?.dataset.gact;
    if (a === "relier") relier();
    if (a === "delier") delier();
    if (e.target.closest("[data-gretry]")) { for (const [, v] of store) if (v.error) { v.at = 0; v.rerender?.(); } }
  });
  root.addEventListener("change", (e) => {
    if (e.target.closest("[data-afc]")) { A.f.contacts = e.target.checked; renderA(); }
  });
}

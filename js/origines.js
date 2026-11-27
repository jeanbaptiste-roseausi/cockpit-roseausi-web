// Pastille d'origine de chaque champ des fiches Contact, Tâche, Projet et Piste (retours du 26/11/2026).
// Qui tient le champ à jour : « Toi », « Agent » (agent de fiche, agent de production ou automate),
// « Calculé » (calcul du cockpit, rien n'est écrit dans Notion) ou « Formule Notion » (formule ou propriété
// automatique de Notion). Le crayon dit que le champ se modifie dans le cockpit.
// L'origine suit la description des propriétés dans Notion (« tenue par l'agent », « écrite chaque nuit par… »,
// « les agents la lisent et n'y écrivent jamais »). Correspondance champ par champ : README, « Pastilles d'origine ».
import { esc, ic } from "./ui.js";

export const KINDS = {
  toi: ["Toi", "Tenu à jour par toi"],
  agent: ["Agent", "Tenu à jour par un agent ou un automate"],
  calc: ["Calculé", "Calculé par le cockpit, rien n'est écrit dans Notion"],
  formule: ["Formule Notion", "Calculé par Notion (formule ou propriété automatique)"],
};

// [origine, modifiable dans le cockpit, précision]. Clé : nom de la propriété Notion, ou nom du calcul du cockpit.
export const ORIGINES = {
  contacts: {
    "Nom": ["toi", false], "Type": ["toi", true], "Position": ["toi", true, "Poste"], "Parcours réseau": ["toi", true, "Statut, changé par toi seul"],
    "Prio": ["toi", true], "Qualif Prospect": ["toi", true], "Prochaine action": ["toi", true], "Date prochaine action": ["toi", true],
    "Dernier échange": ["toi", true], "Email": ["toi", true], "Phone": ["toi", true], "Linkedin": ["toi", true], "Site web": ["toi", true],
    "👦👩‍🦰Notes contacts": ["toi", true, "Zone libre, les agents n'y écrivent jamais"], "Notes entreprise": ["toi", true, "Zone libre, les agents n'y écrivent jamais"],
    "Segmentation": ["toi", false], "Type d'organisation": ["toi", false], "Rattaché à": ["toi", false], "Recommandé par": ["toi", false],
    "A recommandé": ["formule", false, "Rempli par Notion, relation inverse de Recommandé par"], "Source": ["toi", false, "Origine de la fiche (import)"],
    "Synthèse agent": ["agent", false], "Ordre agent": ["agent", false], "Ordre de mission": ["agent", false], "Dernière session": ["agent", false],
    "Modifié le": ["formule", false],
    nature: ["calc", false], tachesOuvertes: ["calc", false], dernierEchangeDirect: ["calc", false, "Lu au Journal de bord"],
    prochaineEtape: ["calc", false, "Première tâche ouverte liée"], prochaineEtapePiste: ["calc", false, "Prochaine tâche des pistes actives"],
    liens: ["calc", false, "Nombres de liens dans Notion"], pistes: ["calc", false, "Pistes liées, miroir"],
  },
  todo: {
    "Nom": ["toi", true], "État": ["toi", true], "Échéance": ["toi", true], "Prio": ["toi", true], "Récap": ["toi", true],
    "Mes notes": ["toi", true, "Zone libre, l'agent n'y écrit jamais"], "Type d'action": ["agent", true, "Renseigné par le Préparateur d'action"],
    "Bloc": ["agent", true, "Renseigné par le Préparateur d'action"], "Durée estimée (min)": ["agent", true, "Renseignée par le Préparateur d'action"],
    "Projets": ["toi", true], "👱‍♀️ Contacts": ["toi", true], "Pistes/Opportunités": ["toi", true], "Thème": ["toi", true, "Initiative"],
    "Responsable": ["toi", false], "Synthèse agent": ["agent", false], "Ordre agent": ["agent", false], "Ordre de mission": ["agent", false],
    "Brouillon Gmail": ["agent", false], "Lien source": ["agent", false], "Réunion source": ["agent", false], "Créé par l'agent": ["agent", false],
    "Dernière session": ["agent", false], "Modifié le": ["formule", false],
    blocDeduit: ["calc", false, "Déduit du type d'action et de l'état"],
  },
  projets: {
    "Nom": ["toi", true], "État": ["toi", true], "Météo": ["agent", true, "Écrite chaque nuit par Contexte projets, ou par l'agent de la fiche"],
    "Motif météo": ["agent", true, "Écrit chaque nuit, ou par l'agent de la fiche"], "Prochain jalon": ["toi", true], "Date prochain jalon": ["toi", true],
    "Mes notes": ["toi", true, "Zone libre, les agents n'y écrivent jamais"], "Synthèse agent": ["agent", false, "Tenue par l'agent de la fiche"],
    "Consommé (%)": ["agent", false, "Écrit chaque lundi par Budget missions"], "Heures consommées": ["agent", false, "Toggl, chaque lundi"],
    "Heures vendues": ["agent", false, "Jours vendus × 8, sinon Toggl"], "Jours du mois": ["agent", false, "Écrits chaque lundi"],
    "Jours vendus": ["toi", false, "Saisis à la main"], "Plafond (j)": ["toi", false, "Saisi à la main"], "Budget mensuel (j)": ["toi", false, "Saisi à la main"],
    "Palier budget alerté": ["agent", false], "Retards des tiers": ["agent", false, "Tenu par l'agent de la fiche, d'après la page Contexte et les échanges"], "Hors périmètre ouverts": ["agent", false],
    "Dernière activité": ["agent", false, "Écrite chaque nuit"], "Météo hebdo": ["toi", false], "Projet Toggl": ["toi", false],
    "Responsable": ["toi", false], "Date de début Réelle ": ["toi", false], "Date prévisionnelle": ["toi", false], "Régulier": ["toi", false],
    "💶 Opportunités": ["toi", false], "Thèmes": ["toi", false], "Modifié le": ["formule", false],
    tachesOuvertes: ["calc", false, "Miroir TO DO"], dernierEchange: ["calc", false, "Lu au Journal de bord"], sommeil: ["calc", false, "14 jours sans activité"],
    niveau: ["calc", false, "Orange à 80 %, rouge à 100 %"], timeline: ["calc", false], interlocuteurs: ["calc", false],
  },
  pistes: {
    "Nom": ["toi", false], "Status": ["toi", true, "Étape"], "Gagné/Perdu": ["toi", true, "Issue"], "Prio": ["toi", true], "Taille": ["toi", true],
    "Date de signature prévue": ["toi", true], "👱‍♀️ Contacts": ["toi", true], "Mes notes": ["toi", true, "Zone libre, les agents n'y écrivent jamais"],
    "Projets": ["toi", false], "Tags": ["toi", false, "Origine"], "Lead→Opportunité": ["toi", false], "CA estimé ": ["toi", false], "CA réel": ["toi", false],
    "Résumé": ["toi", false], "Responsable": ["toi", false], "ID Odoo": ["toi", false, "Clé de l'export Odoo"],
    "Prochaine action": ["toi", false, "Texte libre de Notion, affiché en second, jamais modifié par le cockpit"],
    "Date prochaine action": ["toi", false, "Date du texte libre, jamais modifiée par le cockpit"],
    "Synthèse agent": ["agent", false], "Dernière interaction": ["agent", false], "Dernière session": ["agent", false],
    "Jours estimés": ["formule", false], "Probabilité": ["formule", false], "Jours pondérés": ["formule", false], "Modifié le": ["formule", false], "Date de création": ["formule", false],
    prochaine: ["calc", false, "Tâche ouverte liée à l'échéance la plus proche"], dernierEchange: ["calc", false, "Journal de bord, sinon Dernière interaction"],
  },
};

/**
 * Pastille d'origine d'un champ. Retirée des fiches le 27/11/2026 (fiches compactes, artefact 1795796345-bfec) :
 * la bande de propriétés dit la même chose par l'aspect des chips (trait plein, pointillés, +) et l'icône ⓘ.
 * og() ne rend donc plus rien ; ogBadge() garde l'ancien rendu si on en a de nouveau besoin.
 */
export const og = () => "";
export function ogBadge(base, key) {
  const o = ORIGINES[base]?.[key];
  if (!o) return "";
  const [k, edit, note] = o, [lab, title] = KINDS[k];
  const t = `${title}${note ? `. ${note}` : ""}${edit ? ". Modifiable dans le cockpit" : ". Non modifiable dans le cockpit"}`;
  return `<span class="og og-${k}" title="${esc(t)}"><span class="sr">Origine : </span>${esc(lab)}${edit ? `${ic("pen", "ic-og")}<span class="sr">, modifiable ici</span>` : ""}</span>`;
}

/** Ancienne légende courte, plus affichée depuis le 27/11/2026. */
export const ogLegend = () => `<div class="og-legend small muted">Qui tient chaque champ :${Object.entries(KINDS).map(([k, [lab, t]]) => `<span class="og og-${k}" title="${esc(t)}">${esc(lab)}</span>`).join("")}<span>; ${ic("pen", "ic-og")} modifiable ici.</span></div>`;

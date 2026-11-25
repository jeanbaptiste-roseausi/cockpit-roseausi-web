// Configuration publique de la page. Ces deux valeurs sont faites pour être visibles dans un
// navigateur : la clé « publishable » ne donne accès à rien sans session, et aucune table n'est
// exposée. Les secrets (NOTION_TOKEN, clés serveur) restent dans les secrets Supabase.
export const SUPABASE_URL = "https://kvjlhxqhiodsusmbletu.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PRKB-_JCcIxc1ctt_Ad6uQ_28vMlSf6";

// Contrôle de confort côté page. Le vrai refus est côté serveur : inscriptions désactivées
// dans Supabase Auth, et vérification de l'adresse dans chaque Edge Function.
export const ALLOWED_EMAIL = "jeanbaptiste@roseausi.fr";

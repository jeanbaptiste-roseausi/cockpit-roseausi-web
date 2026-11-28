// Service worker du cockpit installable (28/11/2026). Volontairement prudent :
//   - il ne touche qu'aux fichiers statiques de la page, sur le même site (HTML, JS, CSS, icônes, manifeste) ;
//   - il ne voit jamais passer les appels aux fonctions Supabase, à l'authentification, à Google, au CDN ni aux
//     polices : ces requêtes partent d'un autre site, il les laisse au navigateur sans y répondre ni les garder ;
//   - la page (navigation) part toujours au réseau d'abord ; sans réseau, l'écran « Hors connexion » s'affiche ;
//   - les autres fichiers sont servis depuis le cache de la version, rempli à l'installation et au fil des
//     lectures, et jeté quand une nouvelle version prend la main.
// Sa version est celle de version.txt (commit publié), passée dans l'adresse : sw.js?v=<version>. Une nouvelle
// version installe un nouveau cache ; elle attend que Jean-Baptiste touche « Nouvelle version, recharger » (ou
// que toutes les fenêtres du cockpit soient fermées) pour prendre la main.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `cockpit-${VERSION}`;
const BASE = new URL("./", self.location.href);
const HORS_CONNEXION = new URL("hors-connexion.html", BASE).href;

// Socle mis en cache dès l'installation : de quoi afficher l'écran « Hors connexion » et démarrer la page.
const SOCLE = [
  "hors-connexion.html", "styles.css", "config.js", "manifest.webmanifest",
  "favicon.ico", "favicon-32.png", "favicon-128.png", "apple-touch-icon.png",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png",
  "js/app.js",
].map((p) => new URL(p, BASE).href);

// Jamais en cache, même sur le site : le numéro de version et le service worker lui-même.
const JAMAIS = new Set(["version.txt", "sw.js"].map((p) => new URL(p, BASE).pathname));
const STATIQUE = /\.(?:html|js|mjs|css|png|ico|svg|webmanifest|woff2?)$/i;

/** Fichier statique du cockpit, sur le même site, sous la portée, sans paramètre d'adresse. */
function estStatique(url) {
  return url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname) && !url.search
    && !JAMAIS.has(url.pathname) && STATIQUE.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: "reload" : on contourne le cache HTTP du navigateur, pour ne pas ranger un fichier d'avant la publication.
    await cache.addAll(SOCLE.map((u) => new Request(u, { cache: "reload" })));
    // Toute première installation : rien à remplacer, il prend la main tout de suite. Sinon il attend.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("cockpit-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const m = event.data || {};
  if (m.type === "prendre-la-main") self.skipWaiting();
  // La page envoie la liste des fichiers qu'elle a chargés avant que le service worker ne la contrôle
  // (première visite) : ils sont rangés dans le cache de la version pour l'ouverture suivante.
  if (m.type === "ranger" && Array.isArray(m.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      for (const u of m.urls.slice(0, 200)) {
        let url; try { url = new URL(u); } catch { continue; }
        if (!estStatique(url) || await cache.match(url.href)) continue;
        try {
          const r = await fetch(url.href, { cache: "no-cache" });
          if (r.ok && r.type === "basic") await cache.put(url.href, r);
        } catch { /* hors réseau : il sera rangé plus tard */ }
      }
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Autre site (fonctions Supabase, authentification, Google, CDN, polices) : le service worker ne répond pas.
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;

  // Page : réseau d'abord, jamais rangée ; sans réseau, écran « Hors connexion ».
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(HORS_CONNEXION, { cacheName: CACHE }))
      || new Response("<!doctype html><meta charset=utf-8><title>Hors connexion</title><p style=\"font:16px Arial;padding:24px\">Hors connexion, le cockpit revient dès que le réseau est là.</p>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })));
    return;
  }

  if (!estStatique(url)) return;
  // Fichiers versionnés : cache de la version d'abord, sinon réseau (revalidé), rangé pour la suite.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url.href);
    if (hit) return hit;
    const r = await fetch(new Request(req, { cache: "no-cache" }));
    if (r.ok && r.type === "basic") cache.put(url.href, r.clone()).catch(() => {});
    return r;
  })());
});

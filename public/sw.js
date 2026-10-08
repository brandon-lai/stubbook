// Stubbook service worker. One job: receive files shared to the installed app
// (Android share sheet, e.g. a boarding-pass PDF from email) and hand them to the
// scanner without sending them to the server. Everything else goes to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") {
        const cache = await caches.open("share-target");
        await cache.put("/shared-file", new Response(file, { headers: { "content-type": file.type || "application/octet-stream", "x-filename": file.name || "shared" } }));
        return Response.redirect("/scan?shared=1", 303);
      }
    } catch (e) { /* fall through */ }
    return Response.redirect("/scan?shared=missed", 303);
  })());
});

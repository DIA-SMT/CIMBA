/**
 * Service worker de CIMBA: recibe notificaciones push (Web Push / VAPID)
 * y abre la pantalla correspondiente al tocarlas.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (evento) => {
  let datos = { titulo: "CIMBA", cuerpo: "Novedad en el sistema de bacheo", url: "/" };
  try {
    datos = { ...datos, ...evento.data.json() };
  } catch {
    /* payload no-JSON: usa los valores por defecto */
  }
  evento.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      icon: "/marca/isotipo-smt.png",
      badge: "/marca/isotipo-smt.png",
      data: { url: datos.url },
      tag: datos.tag || undefined,
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const url = (evento.notification.data && evento.notification.data.url) || "/";
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ("focus" in v) {
          v.navigate(url);
          return v.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

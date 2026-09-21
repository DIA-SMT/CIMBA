/**
 * Service worker de CIMBA.
 *
 * Hace dos cosas, y deliberadamente ninguna más:
 *
 *  1. PUSH. Recibe las notificaciones (Web Push / VAPID) y abre la pantalla
 *     que corresponde al tocarlas. Es lo que permite que el aviso llegue con
 *     la app cerrada.
 *
 *  2. CACHÉ DE LO QUE NO CAMBIA. Solo los archivos estáticos y pesados: el
 *     isotipo, los íconos y —sobre todo— los GeoJSON de /data, que son
 *     megabytes que hoy se vuelven a bajar en cada visita y que en un teléfono
 *     con datos móviles en la calle es la diferencia entre que el mapa abra o
 *     no.
 *
 * LO QUE NO HACE, A PROPÓSITO: no cachea ni una sola página ni una sola
 * respuesta de la API. CIMBA muestra el estado de la ciudad AHORA —cuántos
 * pedidos sin atención, qué órdenes vencen hoy—; una página servida de un
 * caché viejo sería peor que una pantalla de error, porque el error se ve y el
 * número desactualizado no. Si no hay red, que se note.
 */

const CACHE = "cimba-estaticos-v1";
/** Lo único cacheable: archivos versionados o inmutables por naturaleza. */
const CACHEABLE = [/^\/data\//, /^\/marca\//, /^\/icono\//, /^\/_next\/static\//];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      // Los cachés de versiones anteriores se tiran: si no, un /data viejo
      // sobrevive a un despliegue nuevo y el mapa dibuja calles que ya no son.
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;
  let url;
  try {
    url = new URL(pedido.url);
  } catch {
    return;
  }
  // Nada de otros orígenes (tiles del mapa, fuentes, Storage): que los maneje
  // el navegador con sus propias reglas de caché HTTP.
  if (url.origin !== self.location.origin) return;
  if (!CACHEABLE.some((re) => re.test(url.pathname))) return;

  evento.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const guardado = await cache.match(pedido);
      /* Stale-while-revalidate: se responde YA con lo guardado y se refresca
         en segundo plano. La próxima visita ve lo nuevo; ésta no espera. */
      const red = fetch(pedido)
        .then((res) => {
          if (res && res.ok) cache.put(pedido, res.clone());
          return res;
        })
        .catch(() => null);
      if (guardado) return guardado;
      const res = await red;
      if (res) return res;
      return new Response("", { status: 504, statusText: "Sin conexión" });
    })(),
  );
});

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
      icon: "/icono/cimba-192.png",
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

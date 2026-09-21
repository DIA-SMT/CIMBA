import type { MetadataRoute } from "next";

/**
 * EL MANIFEST QUE CONVIERTE A CIMBA EN UNA APP INSTALABLE.
 *
 * No es cosmético: en el teléfono del capataz, instalada, la app abre sin
 * barra del navegador (una pantalla entera más de lista), queda en la pantalla
 * de inicio al lado de WhatsApp —que es de donde viene el trabajo— y el
 * service worker puede seguir recibiendo push con la app cerrada. En el
 * escritorio de la Dirección abre como ventana propia, sin pestañas al lado.
 *
 * Ruta de metadata de Next: se sirve en /manifest.webmanifest y el <link> lo
 * pone Next solo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CIMBA · Monitoreo de Baches y Asfalto",
    short_name: "CIMBA",
    description:
      "Sistema de gestión de bacheo y reparación de pavimento — Municipalidad de San Miguel de Tucumán",
    lang: "es-AR",
    dir: "ltr",
    start_url: "/",
    id: "/",
    display: "standalone",
    orientation: "any",
    /* El azul de marca en la barra del sistema, y el fondo claro de la app
       como color de arranque: el splash no puede destellar de otro color. */
    theme_color: "#0066FF",
    background_color: "#EEF2F7",
    categories: ["government", "productivity", "utilities"],
    icons: [
      { src: "/icono/cimba-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono/cimba-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /* Android recorta el ícono a la forma de su launcher: el maskable tiene
         el isotipo al 58% sobre el azul, así que no hay recorte que lo parta. */
      { src: "/icono/cimba-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icono/cimba-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    /**
     * Los accesos directos del ícono (mantener apretado en Android, clic
     * derecho en el escritorio). Son las tres pantallas por las que se entra:
     * el mapa para mirar, las órdenes para decidir y el portal para cargar.
     */
    shortcuts: [
      { name: "Mapa", short_name: "Mapa", url: "/mapa", description: "El estado de la ciudad, en vivo" },
      { name: "Órdenes de trabajo", short_name: "Órdenes", url: "/ordenes", description: "Qué se le encargó a cada empresa" },
      { name: "Cargar trabajo", short_name: "Cargar", url: "/empresa", description: "Reportar los baches ejecutados" },
    ],
  };
}

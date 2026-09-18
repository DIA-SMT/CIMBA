"use client";

import { useEffect, useState } from "react";

/**
 * Tema visual de los mapas. El canvas de MapLibre no ve los tokens CSS del
 * tema: cada mapa lee el atributo data-tema de <html> (lo pinta el layout
 * raíz y lo alterna boton-tema) y lo observa con MutationObserver para
 * cambiar el estilo base sin recargar. Compartido por el mapa principal y
 * todos los mini-mapas flotantes: ninguno debe quedar en negro en tema claro.
 */

export type TemaMapa = "claro" | "oscuro";

export const ESTILO_MAPA_OSCURO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * VOYAGER Y NO POSITRON: el plano tiene que ayudar a ubicar el bache.
 *
 * Positron es un fondo deliberadamente mudo —gris, sin POIs, sin nombres de
 * edificios— y para el mapa de gestión estaba bien. Pero quien sale a buscar
 * un bache no se orienta por la grilla: se orienta por la escuela de la
 * esquina, por el hospital, por el nombre del pasaje.
 *
 * "Este mapa base tiene la bondad de que aparecen los edificios más
 * importantes y en las esquinas marca las alturas de las calles, lo que
 * facilita el trabajo" — Dirección de Bacheo, 17/09.
 *
 * Voyager es del mismo proveedor (CARTO), sin clave ni costo, y trae los
 * edificios, los POIs con nombre y las avenidas diferenciadas por color.
 *
 * Lo de las ALTURAS tiene una vuelta que conviene dejar escrita, porque invita
 * a diagnosticarlo mal: los DOS estilos declaran la capa `housenumber`, con el
 * mismo minzoom 17 y el mismo `text-field`. Mirando el JSON parecen iguales.
 * La diferencia está en el pintado — Positron la trae con
 * `text-color: "transparent"` y Voyager con `#d2b17d`. Positron dibuja las
 * alturas invisibles. Comprobado a ojo en Kirchner y Alem a z17: en Voyager
 * salen 800, 801, 802, 1201, 1251…; en Positron, nada.
 *
 * Se puede volver atrás sin tocar el código: NEXT_PUBLIC_MAP_STYLE_LIGHT en
 * Vercel manda sobre esto.
 */
export const ESTILO_MAPA_CLARO =
  process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT ??
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

export function estiloMapa(tema: TemaMapa): string {
  return tema === "oscuro" ? ESTILO_MAPA_OSCURO : ESTILO_MAPA_CLARO;
}

export function usarTemaMapa(): TemaMapa {
  // Lazy init: si el cliente ya arrancó en oscuro, evita cargar positron y
  // pisarlo un frame después con dark-matter.
  const [tema, setTema] = useState<TemaMapa>(() =>
    typeof document !== "undefined" && document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro",
  );
  useEffect(() => {
    const leer = () => setTema(document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro");
    leer();
    const obs = new MutationObserver(leer);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    return () => obs.disconnect();
  }, []);
  return tema;
}

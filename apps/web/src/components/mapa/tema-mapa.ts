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

export const ESTILO_MAPA_CLARO =
  process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT ??
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

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

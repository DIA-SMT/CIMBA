"use client";

import { useEffect, useState, type RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";

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

/** Imagen satelital de Esri (uso gratuito con atribución). Vive acá y no en
 *  mapa-selector para que mini-mapa y mapa-selector la usen sin importarse
 *  entre sí. */
export const TILES_SATELITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ATRIBUCION_SATELITE = "Esri, Maxar, Earthstar Geographics";

export function estiloMapa(tema: TemaMapa): string {
  return tema === "oscuro" ? ESTILO_MAPA_OSCURO : ESTILO_MAPA_CLARO;
}

/** Los realces de calle, por tema (ver usarRealceCalles). */
const NOMBRES_OSCURO = [
  { id: "roadname_minor", minzoom: 14.5, size: 10.5, color: "#b9c6d8" },
  { id: "roadname_sec", minzoom: 13.5, size: 11, color: "#c8d4e4" },
  { id: "roadname_pri", minzoom: 12.5, size: 11.5, color: "#d6e0ee" },
  { id: "roadname_major", minzoom: 11.5, size: 12, color: "#e2eaf5" },
];
const NOMBRES_CLARO = [
  { id: "roadname_minor", minzoom: 14.5, size: 10.5, color: "#5b6b7d" },
  { id: "roadname_sec", minzoom: 13.5, size: 11, color: "#4d5c6e" },
  { id: "roadname_pri", minzoom: 12.5, size: 11.5, color: "#41505f" },
  { id: "roadname_major", minzoom: 11.5, size: 12, color: "#36434f" },
];
const TRAZAS = [
  { id: "road_minor_fill", minzoom: 13.5, color: "rgba(88, 97, 118, 1)" },
  { id: "road_minor_case", minzoom: 12.5, color: "rgba(72, 79, 98, 1)" },
  { id: "road_service_fill", minzoom: 14.5, color: "rgba(70, 76, 94, 1)" },
  { id: "road_sec_fill_noramp", minzoom: 12, color: "rgba(96, 105, 126, 1)" },
];
export const ANCLA_NOMBRES = "roadname_minor";

/**
 * NOMBRES DE CALLE QUE SE LEAN, en todo mapa donde se ubica un punto.
 *
 * El estilo base pone los nombres de las calles chicas recién desde zoom 16 y
 * en letra de 9 px: el corrector de ubicación del bache abría justo en 16, así
 * que salían pocos, chicos y grises — "cuando quiero modificar la
 * geolocalización no aparecen los nombres de las calles; cuando agrando la
 * imagen aparecen" (el usuario, 29/10). Esto los adelanta y los agranda, y
 * marca más las trazas. Antes vivía solo en MapaSelector; el mini-mapa, que es
 * el que se usa en la orden y en el portal, nunca lo tuvo.
 *
 * Devuelve si el estilo tiene la capa de nombres: es el ancla para colgar
 * debajo de ella el satélite y la red vial, así ninguno tapa los nombres.
 */
export function usarRealceCalles(mapRef: RefObject<MapRef | null>, tema: TemaMapa): boolean {
  const [hayNombres, setHayNombres] = useState(false);
  useEffect(() => {
    const oscuro = tema === "oscuro";
    const nombres = oscuro ? NOMBRES_OSCURO : NOMBRES_CLARO;
    const aplicar = () => {
      const mapa = mapRef.current?.getMap();
      if (!mapa) return false;
      // isStyleLoaded() da false mientras quede una tesela pendiente (el
      // satelital tarda): alcanza con que el estilo esté parseado.
      let capas = 0;
      try {
        capas = mapa.getStyle()?.layers?.length ?? 0;
      } catch {
        capas = 0;
      }
      if (capas === 0) return false;
      setHayNombres(Boolean(mapa.getLayer(ANCLA_NOMBRES)));
      for (const c of nombres) {
        if (!mapa.getLayer(c.id)) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        mapa.setLayoutProperty(c.id, "text-size", c.size);
        mapa.setPaintProperty(c.id, "text-color", c.color);
        mapa.setPaintProperty(c.id, "text-halo-color", oscuro ? "#070a10" : "#ffffff");
        mapa.setPaintProperty(c.id, "text-halo-width", 1.7);
      }
      for (const c of TRAZAS) {
        if (!mapa.getLayer(c.id)) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        if (oscuro) mapa.setPaintProperty(c.id, "line-color", c.color);
      }
      return true;
    };
    // SIEMPRE engancharse a styledata —apenas el mapa exista, aunque no esté
    // montado en el primer intento—: el toggle de tema dispara un setStyle que
    // borra estos ajustes. aplicar() es idempotente, no hay bucle.
    let escuchado: ReturnType<MapRef["getMap"]> | null = null;
    const intentar = () => {
      const mapa = mapRef.current?.getMap();
      if (mapa && !escuchado) {
        escuchado = mapa;
        mapa.on("styledata", aplicar);
      }
      return aplicar();
    };
    let cancelado = false;
    intentar();
    const id = setInterval(() => {
      if (cancelado || intentar()) clearInterval(id);
    }, 300);
    return () => {
      cancelado = true;
      clearInterval(id);
      escuchado?.off("styledata", aplicar);
    };
  }, [mapRef, tema]);
  return hayNombres;
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

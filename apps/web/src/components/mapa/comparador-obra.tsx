"use client";

import { Camera } from "lucide-react";
import { useEffect, useState } from "react";
import { fotosDeIncidente, type FotoObra } from "@/lib/acciones-fotos";
import { urlFoto } from "@/lib/fotos";
import { StreetView } from "./street-view";

const ETIQUETA_MOMENTO: Record<string, string> = {
  antes: "Antes",
  durante: "Durante",
  despues: "Después",
};

/**
 * El bache, contrastado: la foto que sacó la cuadrilla al lado de cómo se ve
 * la calle en Street View. Sirve para dos cosas distintas según qué haya:
 *  - con fotos: comparar el estado real contra la referencia de la calle;
 *  - sin fotos (hoy, hasta que las cuadrillas empiecen a cargar): al menos
 *    ver dónde es, sin salir del mapa.
 *
 * Las fotos se piden al montar, solo para el punto seleccionado.
 */
export function ComparadorObra({
  incidenteId,
  lat,
  lon,
  alto = 150,
}: {
  /** null para demandas: un pedido no tiene fotos de obra propias. */
  incidenteId: number | null;
  lat: number;
  lon: number;
  alto?: number;
}) {
  const [fotos, setFotos] = useState<FotoObra[] | null>(null);

  useEffect(() => {
    if (incidenteId == null) {
      setFotos([]);
      return;
    }
    let vigente = true;
    setFotos(null);
    void fotosDeIncidente(incidenteId)
      .then((f) => vigente && setFotos(f))
      .catch(() => vigente && setFotos([]));
    return () => {
      vigente = false;
    };
  }, [incidenteId]);

  // La más representativa: el "después" si existe (el trabajo terminado), si no
  // la primera que haya.
  const principal = fotos?.find((f) => f.momento === "despues") ?? fotos?.[0] ?? null;
  const url = principal ? urlFoto(principal) : null;

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
        <Camera size={11} /> La obra vs. la calle
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {/* Lado foto */}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="group relative block overflow-hidden rounded-lg border border-borde"
            title="Abrir la foto en tamaño completo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- imagen de Storage, sin optimizador */}
            <img
              src={url}
              alt={`Foto ${ETIQUETA_MOMENTO[principal!.momento] ?? ""} de la obra`}
              style={{ height: alto }}
              className="w-full object-cover"
              loading="lazy"
            />
            <span className="absolute top-1.5 left-1.5 rounded bg-fondo/80 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-resuelto uppercase">
              {ETIQUETA_MOMENTO[principal!.momento] ?? "Obra"}
            </span>
            {fotos && fotos.length > 1 && (
              <span className="absolute right-1.5 bottom-1.5 rounded bg-fondo/80 px-1.5 py-0.5 text-[9px] text-texto-2">
                +{fotos.length - 1}
              </span>
            )}
          </a>
        ) : (
          <div
            style={{ height: alto }}
            className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-borde-2 bg-panel-2/60 px-2 text-center"
          >
            <Camera size={18} className="text-texto-3" />
            <span className="text-[10px] leading-snug text-texto-3">
              {fotos == null
                ? "Buscando fotos…"
                : incidenteId == null
                  ? "Los pedidos no llevan foto de obra"
                  : "Todavía sin fotos de la cuadrilla"}
            </span>
          </div>
        )}

        {/* Lado calle */}
        <StreetView lat={lat} lon={lon} alto={alto} etiqueta="La calle" />
      </div>
    </div>
  );
}

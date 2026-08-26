"use client";

import { ExternalLink, Eye } from "lucide-react";
import { useState } from "react";
import { linkStreetView, urlStreetViewEstatico } from "@/lib/fotos";

/**
 * Cómo se ve la calle en el punto. Con NEXT_PUBLIC_GOOGLE_MAPS_KEY muestra el
 * panorama embebido; sin clave (o si Google no tiene cobertura ahí) cae a un
 * botón que abre el Street View interactivo en otra pestaña.
 *
 * La degradación importa: es el estado en el que corre hoy el sistema, y tiene
 * que verse deliberado, no roto.
 */
export function StreetView({
  lat,
  lon,
  alto = 200,
  etiqueta = "Street View",
}: {
  lat: number;
  lon: number;
  alto?: number;
  etiqueta?: string;
}) {
  const [falló, setFalló] = useState(false);
  const src = urlStreetViewEstatico(lat, lon, { ancho: 640, alto: alto * 2 });
  const link = linkStreetView(lat, lon);

  if (!src || falló) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        style={{ height: alto }}
        className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-borde-2 bg-panel-2/60 px-4 text-center transition hover:border-celeste/60"
        title="Abrir Street View de este punto en Google Maps"
      >
        <Eye size={20} className="text-texto-3 transition group-hover:text-celeste" />
        <span className="text-[11px] leading-snug text-texto-3">
          {falló ? "Sin cobertura de Street View acá" : "Ver la calle en Street View"}
          <br />
          <span className="text-celeste">se abre en otra pestaña ↗</span>
        </span>
      </a>
    );
  }

  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className="group relative block overflow-hidden rounded-lg border border-borde"
      title="Abrir el Street View interactivo"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen remota de Google, no pasa por el optimizador */}
      <img
        src={src}
        alt={`Street View de ${lat.toFixed(5)}, ${lon.toFixed(5)}`}
        style={{ height: alto }}
        className="w-full object-cover"
        loading="lazy"
        onError={() => setFalló(true)}
      />
      <span className="absolute top-1.5 left-1.5 rounded bg-fondo/80 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-texto-2 uppercase">
        {etiqueta}
      </span>
      <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-fondo/80 px-1.5 py-0.5 text-[9px] text-celeste opacity-0 transition group-hover:opacity-100">
        interactivo <ExternalLink size={9} />
      </span>
    </a>
  );
}

"use client";

import { useEffect, useState } from "react";
import { numero } from "@/lib/formato";
import { LogoCimba } from "@/components/marca";

/**
 * La columna viva de la pantalla de comando: reloj, cuatro cifras grandes,
 * los últimos movimientos y las últimas fotos de trabajo. Se refresca sola
 * cada 60 segundos; la página entera se recarga cada 10 minutos para que el
 * mapa también traiga datos frescos. Cero interacción: es para MIRAR.
 */

interface DatosTv {
  cifras: { sinAtencion: number; enObra: number; reparadosAyer: number; m2Mes: number };
  feed: Array<{
    en: string;
    actor: string;
    entidad: string;
    entidadId: number;
    accion: string;
    estadoDespues: string | null;
    numero: string | null;
    marca: string | null;
    m2: number | null;
  }>;
  fotos: Array<{ url: string; direccion: string | null }>;
}

function fraseCorta(e: DatosTv["feed"][number]): string {
  const id = e.entidadId;
  if (e.entidad === "sesion") return `${e.actor} entró al sistema`;
  if (e.entidad === "demandas") {
    if (e.accion === "insert") return `${e.actor} cargó el pedido #${id}`;
    if (e.marca === "cierre") return `${e.actor} cerró el reclamo #${id}`;
    if (e.marca === "derivada") return `${e.actor} derivó el reclamo #${id}`;
    if (e.marca === "duplicada") return `${e.actor} descartó el duplicado #${id}`;
    return `${e.actor} actualizó el reclamo #${id}`;
  }
  if (e.entidad === "incidentes") {
    if (e.estadoDespues === "verificado") return `${e.actor} verificó la reparación #${id}`;
    if (e.estadoDespues) return `${e.actor}: incidente #${id} → ${e.estadoDespues.replaceAll("_", " ")}`;
    return `${e.actor} actualizó el incidente #${id}`;
  }
  if (e.entidad === "intervenciones")
    return `${e.actor} reportó un trabajo${e.m2 != null ? ` (${numero(e.m2)} m²)` : ""}`;
  if (e.entidad === "ordenes_trabajo") {
    if (e.estadoDespues === "emitida") return `${e.actor} emitió la orden ${e.numero ?? `#${id}`}`;
    if (e.estadoDespues === "completada") return `Se completó la orden ${e.numero ?? `#${id}`}`;
    return `${e.actor} actualizó la orden ${e.numero ?? `#${id}`}`;
  }
  if (e.entidad === "expedientes") return `${e.actor} registró la nota ${e.numero ?? `#${id}`}`;
  return `${e.actor}: ${e.accion} en ${e.entidad}`;
}

const hace = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso.replace(" ", "T"))) / 60000);
  if (!Number.isFinite(min) || min < 0) return "";
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
};

export function PanelTv({ conFeed }: { conFeed: boolean }) {
  const [datos, setDatos] = useState<DatosTv | null>(null);
  const [reloj, setReloj] = useState("");

  useEffect(() => {
    const cargar = () =>
      fetch("/api/tv")
        .then((r) => r.json())
        .then(setDatos)
        .catch(() => {});
    cargar();
    const idDatos = setInterval(cargar, 60_000);
    // La página completa se renueva cada 10 minutos: el mapa vuelve a pedir
    // su geojson y cualquier deploy nuevo entra solo a la pantalla.
    const idRecarga = setTimeout(() => window.location.reload(), 10 * 60_000);
    const idReloj = setInterval(
      () => setReloj(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })),
      1000,
    );
    return () => {
      clearInterval(idDatos);
      clearTimeout(idRecarga);
      clearInterval(idReloj);
    };
  }, []);

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col gap-4 overflow-hidden border-l border-borde bg-panel p-5">
      <div className="flex items-center justify-between">
        <LogoCimba />
        <div className="text-right">
          <p className="num text-4xl leading-none font-extrabold tracking-tight">{reloj}</p>
          <p className="mt-0.5 text-[11px] text-texto-3">
            {new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
      </div>

      {/* Las cuatro cifras que importan, bien grandes */}
      <div className="grid grid-cols-2 gap-3">
        <CifraTv n={datos?.cifras.sinAtencion} etiqueta="Sin atención (bacheo)" color="var(--color-sin-atencion)" />
        <CifraTv n={datos?.cifras.enObra} etiqueta="En obra ahora" color="var(--color-en-obra)" />
        <CifraTv n={datos?.cifras.reparadosAyer} etiqueta="Tapados ayer" color="var(--color-hecho)" />
        <CifraTv n={datos?.cifras.m2Mes} etiqueta="m² últimos 30 días" color="var(--color-celeste)" sufijo=" m²" />
      </div>

      {/* El vivo: qué está pasando en el sistema */}
      {conFeed && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">Pasando ahora</p>
          <ul className="space-y-1.5 overflow-hidden">
            {(datos?.feed ?? []).map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[13px] leading-snug">
                <span className="num shrink-0 text-[10px] text-texto-3">{hace(e.en)}</span>
                <span className="min-w-0 truncate text-texto-2">{fraseCorta(e)}</span>
              </li>
            ))}
            {datos && datos.feed.length === 0 && (
              <li className="text-[12px] text-texto-3">Sin movimientos recientes.</li>
            )}
          </ul>
        </div>
      )}

      {/* La prueba: las últimas fotos de trabajo terminado */}
      {datos && datos.fotos.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">Últimos trabajos</p>
          <div className="grid grid-cols-3 gap-2">
            {datos.fotos.map((f, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas
              <img
                key={i}
                src={f.url}
                alt={f.direccion ?? "Trabajo terminado"}
                title={f.direccion ?? undefined}
                className="aspect-square w-full rounded-lg border border-borde object-cover"
                loading="lazy"
              />
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-texto-3">
        Se actualiza solo cada minuto · el mapa, cada 10 · sin datos personales
      </p>
    </aside>
  );
}

function CifraTv({ n, etiqueta, color, sufijo = "" }: { n?: number; etiqueta: string; color: string; sufijo?: string }) {
  return (
    <div className="rounded-2xl border border-borde bg-panel-2 p-4">
      <p className="num text-4xl leading-none font-extrabold tracking-tight" style={{ color }}>
        {n != null ? numero(n) + sufijo : "…"}
      </p>
      <p className="mt-1.5 text-[10px] font-bold tracking-[0.12em] text-texto-3 uppercase">{etiqueta}</p>
    </div>
  );
}

"use client";

import { LocateFixed, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ItemOrden } from "@/lib/ordenes";
import { numero } from "@/lib/formato";
import { TarjetaItem } from "./tarjeta-item";
import { mejorPosicion } from "@/lib/gps";

/**
 * EL TRABAJO DEL DÍA, ORDENADO PARA LA CALLE.
 *
 * Una orden de bacheo no son cuatro baches: cuando se releva un circuito
 * entero puede traer decenas, y hasta ahora la única manera de encontrar uno
 * era bajar scrolleando una lista en el orden en que la armó el sistema. En
 * el teléfono, con guantes y el camión esperando, eso no escala.
 *
 * Tres cosas, y ninguna cambia lo que se guarda:
 *  - BUSCAR por calle, para ir directo al que se está por tapar.
 *  - ORDENAR POR CERCANÍA con el GPS del teléfono: el próximo bache es el que
 *    está a la vuelta, no el que le tocó el número más bajo.
 *  - EL MAPA DE LA ORDEN, para ver de una cuánto falta y dónde — que es como
 *    se arma el recorrido de la jornada, no leyendo direcciones sueltas.
 */

/** Distancia en metros — fórmula del haversine, alcanza y sobra para ordenar. */
function metrosEntre(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "a 180 m" / "a 1,4 km": la unidad con la que se decide a cuál ir primero. */
const distanciaCorta = (m: number) =>
  m < 1000 ? `a ${Math.round(m)} m` : `a ${(m / 1000).toFixed(1).replace(".", ",")} km`;

/** Sin tildes ni mayúsculas: "Sarmiento" tiene que encontrar "SARMIENTO" y "sarmíento". */
const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export function ListaPendientes({
  pendientes,
  hechos,
  ordenId,
}: {
  pendientes: ItemOrden[];
  /** Solo para el mapa: ver lo tapado al lado de lo que falta es el progreso real. */
  hechos: ItemOrden[];
  ordenId: number;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [porCercania, setPorCercania] = useState(false);
  const [miPunto, setMiPunto] = useState<{ lat: number; lon: number } | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(false);

  const pedirUbicacion = async () => {
    setBuscandoGps(true);
    setErrorGps(null);
    try {
      // Para ORDENAR alcanza con menos precisión que para plantar un pin:
      // se espera menos (ver lib/gps.ts).
      const fix = await mejorPosicion({ esperaMs: 4_000 });
      setMiPunto({ lat: fix.lat, lon: fix.lon });
      setPorCercania(true);
    } catch (e) {
      setErrorGps(e instanceof Error ? e.message : "No se pudo leer tu ubicación.");
    } finally {
      setBuscandoGps(false);
    }
  };

  /** La lista que se dibuja: filtrada por texto y, si se pidió, ordenada por cercanía. */
  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    let lista = pendientes;
    if (q.length > 0) lista = lista.filter((i) => normalizar(i.direccion ?? "").includes(q));
    if (porCercania && miPunto) {
      // Los que no tienen punto se van al final: no se pueden ordenar por algo
      // que no tienen, y esconderlos sería perder trabajo encargado.
      lista = [...lista].sort((a, b) => {
        const da =
          a.lat != null && a.lon != null ? metrosEntre(miPunto.lat, miPunto.lon, a.lat, a.lon) : Infinity;
        const db =
          b.lat != null && b.lon != null ? metrosEntre(miPunto.lat, miPunto.lon, b.lat, b.lon) : Infinity;
        return da - db;
      });
    }
    return lista;
  }, [pendientes, busqueda, porCercania, miPunto]);

  // Solo vale la pena la barra cuando hay lista para navegar.
  const conHerramientas = pendientes.length >= 5;

  return (
    <div>
      {conHerramientas && (
        <div className="mb-3 rounded-xl border border-borde bg-panel p-3">
          <div className="relative">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-texto-3" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por calle…"
              className="w-full rounded-xl border border-borde-2 bg-panel-2 py-3 pr-10 pl-9 text-base"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                aria-label="Borrar la búsqueda"
                className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-texto-3 hover:text-texto"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* El botón "Ver el mapa" se fue: el mapa de la orden ahora está
              siempre arriba, fuera de la lista y sin depender de cuántos
              pendientes haya. Acá queda lo que sí es de la lista. */}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => (miPunto ? setPorCercania((v) => !v) : pedirUbicacion())}
              disabled={buscandoGps}
              className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition disabled:opacity-60 ${
                porCercania
                  ? "border-celeste/60 bg-celeste/10 text-celeste"
                  : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
              }`}
            >
              <LocateFixed size={15} />
              {buscandoGps ? "Ubicando…" : porCercania ? "Más cerca mío" : "Ordenar por cercanía"}
            </button>
          </div>

          {errorGps && <p className="mt-2 text-[12px] text-peligro">{errorGps}</p>}
          <p className="mt-2 text-[12px] text-texto-3">
            {visibles.length === pendientes.length ? (
              <>
                <b className="num text-texto-2">{numero(pendientes.length)}</b> pendientes en esta orden
              </>
            ) : (
              <>
                Mostrando <b className="num text-texto-2">{numero(visibles.length)}</b> de{" "}
                <b className="num">{numero(pendientes.length)}</b> pendientes
              </>
            )}
            {porCercania && miPunto && " · ordenados desde donde estás"}
          </p>
        </div>
      )}

      {visibles.length === 0 && (
        <p className="rounded-xl border border-borde bg-panel px-4 py-8 text-center text-sm text-texto-2">
          Ninguna dirección pendiente coincide con “{busqueda}”.
        </p>
      )}

      <div className="space-y-4">
        {visibles.map((item) => {
          const d =
            porCercania && miPunto && item.lat != null && item.lon != null
              ? metrosEntre(miPunto.lat, miPunto.lon, item.lat, item.lon)
              : null;
          return (
            <div key={item.id} id={`item-${item.id}`} className="scroll-mt-4">
              {d != null && (
                <p className="num mb-1 text-[11px] font-semibold text-celeste">{distanciaCorta(d)}</p>
              )}
              <TarjetaItem item={item} ordenId={ordenId} />
            </div>
          );
        })}
      </div>
    </div>
  );
}


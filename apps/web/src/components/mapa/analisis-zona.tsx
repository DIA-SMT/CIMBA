"use client";

import { Circle, GitCompareArrows, GripVertical, Hexagon, Radar, X } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { usePanelArrastrable } from "@/lib/arrastrable";
import { COLOR_MACRO, ETIQUETA_FUENTE, ETIQUETA_TIPO, numero } from "@/lib/formato";
import { aMetros, distanciaM } from "./geo-cliente";

type FC = FeatureCollection<Point, Record<string, unknown>>;

/** La zona que se está analizando: el círculo clásico o el polígono a mano
 *  ("analizo estas 8 manzanas"). El polígono vive como lista de vértices
 *  [lon, lat] y recién mide cuando está cerrado. */
export type ZonaActiva =
  | { forma: "circulo"; centro: { lon: number; lat: number }; radio: number }
  | { forma: "poligono"; vertices: Array<[number, number]>; cerrado: boolean };

export interface StatsZona {
  demandas: number;
  pendientes: number;
  sinAtencion: number;
  porFuente: Array<[string, number]>;
  porTipo: Array<[string, number]>;
  abiertos: number;
  enCurso: number;
  resueltos: number;
  m2: number;
  topCalles: Array<[string, number]>;
  hectareas: number;
}

/** Núcleo compartido círculo/polígono: solo cambia el predicado "dentro". */
function statsConFiltro(
  dentro: (lon: number, lat: number) => boolean,
  hectareas: number,
  demandas: FC,
  incidentes: FC,
): StatsZona {
  const adentro = <T extends Feature<Point, Record<string, unknown>>>(f: T) =>
    dentro(f.geometry.coordinates[0] ?? 0, f.geometry.coordinates[1] ?? 0);

  const d = demandas.features.filter(adentro);
  const i = incidentes.features.filter(adentro);

  const cuenta = (fs: typeof d, clave: string) => {
    const m = new Map<string, number>();
    for (const f of fs) {
      const v = String(f.properties[clave] ?? "—");
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const m2 = i.reduce((acc, f) => acc + (Number(f.properties.m2) || 0), 0);
  const porDireccion = new Map<string, number>();
  for (const f of d) {
    const dir = String(f.properties.direccion ?? "").trim();
    if (dir) porDireccion.set(dir, (porDireccion.get(dir) ?? 0) + 1);
  }

  return {
    demandas: d.length,
    pendientes: d.filter((f) => ["recibida", "en_validacion"].includes(String(f.properties.estado))).length,
    sinAtencion: d.filter((f) => f.properties.brecha === "sin_atencion").length,
    porFuente: cuenta(d, "fuente").slice(0, 3),
    porTipo: cuenta(d, "tipo").slice(0, 3),
    abiertos: i.filter((f) => f.properties.macro === "abierto").length,
    enCurso: i.filter((f) => f.properties.macro === "en_curso").length,
    resueltos: i.filter((f) => f.properties.macro === "resuelto").length,
    m2: Math.round(m2),
    topCalles: [...porDireccion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    hectareas,
  };
}

/** Estadísticas de un círculo, puras: se usan para la zona activa y la comparación A/B. */
export function statsDeZona(
  centro: { lon: number; lat: number },
  radio: number,
  demandas: FC,
  incidentes: FC,
): StatsZona {
  return statsConFiltro(
    (lon, lat) => distanciaM(lon, lat, centro.lon, centro.lat) <= radio,
    (Math.PI * radio * radio) / 10000,
    demandas,
    incidentes,
  );
}

/**
 * Punto en polígono por ray casting, directo sobre lon/lat: a escala de una
 * ciudad la proyección no cambia de qué lado de una arista cae un punto.
 */
export function puntoEnPoligono(lon: number, lat: number, vertices: Array<[number, number]>): boolean {
  let dentro = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Superficie del polígono en hectáreas (shoelace sobre la proyección local en metros). */
export function hectareasDePoligono(vertices: Array<[number, number]>): number {
  if (vertices.length < 3) return 0;
  const pts = vertices.map(([lon, lat]) => aMetros(lon, lat));
  let area2 = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (!a || !b) continue;
    area2 += b[0] * a[1] - a[0] * b[1];
  }
  return Math.abs(area2 / 2) / 10000;
}

/** Estadísticas de un polígono cerrado (point-in-polygon en vez de distancia al centro). */
export function statsDePoligono(vertices: Array<[number, number]>, demandas: FC, incidentes: FC): StatsZona {
  return statsConFiltro(
    (lon, lat) => puntoEnPoligono(lon, lat, vertices),
    hectareasDePoligono(vertices),
    demandas,
    incidentes,
  );
}

/**
 * Analizador de zona: estadísticas instantáneas calculadas en el navegador
 * sobre los datos ya cargados, para un círculo dibujado con un clic o un
 * polígono a mano ("analizo estas 8 manzanas"). Con "Fijar como Zona A" se
 * congela el círculo actual y el siguiente se compara contra él, con
 * densidades por hectárea para que radios distintos sean comparables.
 */
export function AnalisisZona({
  zona,
  setRadio,
  alCambiarForma,
  demandas,
  incidentes,
  alCerrar,
  zonaA,
  alFijarA,
  alQuitarA,
  arr,
}: {
  zona: ZonaActiva;
  setRadio: (r: number) => void;
  alCambiarForma: (forma: "circulo" | "poligono") => void;
  demandas: FC;
  incidentes: FC;
  alCerrar: () => void;
  zonaA?: { centro: { lon: number; lat: number }; radio: number } | null;
  alFijarA?: () => void;
  alQuitarA?: () => void;
  arr: ReturnType<typeof usePanelArrastrable>;
}) {
  const esCirculo = zona.forma === "circulo";
  const poligonoListo = zona.forma === "poligono" && zona.cerrado && zona.vertices.length >= 3;

  const stats = useMemo(() => {
    if (zona.forma === "circulo") return statsDeZona(zona.centro, zona.radio, demandas, incidentes);
    if (zona.cerrado && zona.vertices.length >= 3) return statsDePoligono(zona.vertices, demandas, incidentes);
    return null; // polígono a medio dibujar: todavía no hay nada que medir
  }, [zona, demandas, incidentes]);

  const statsA = useMemo(
    () => (zonaA ? statsDeZona(zonaA.centro, zonaA.radio, demandas, incidentes) : null),
    [zonaA, demandas, incidentes],
  );

  // Street View necesita UN punto: el centro del círculo o el centroide simple
  // de los vértices (alcanza para caer parado en la zona).
  const puntoVista = useMemo(() => {
    if (zona.forma === "circulo") return zona.centro;
    if (zona.vertices.length === 0) return null;
    const s = zona.vertices.reduce<[number, number]>((acc, [ln, la]) => [acc[0] + ln, acc[1] + la], [0, 0]);
    return { lon: s[0] / zona.vertices.length, lat: s[1] / zona.vertices.length };
  }, [zona]);

  return (
    <aside className="panel-vidrio absolute top-28 right-3 bottom-6 z-20 flex w-80 flex-col rounded-xl" style={arr.estilo}>
      <div
        {...arr.asaProps}
        className="flex items-center justify-between border-b border-borde px-4 py-3 select-none"
        title="Arrastrá de acá para mover el panel"
      >
        <span className="flex items-center gap-2 text-sm font-bold">
          <GripVertical size={13} className="text-texto-3" />
          <Radar size={15} className="text-amarillo" /> {statsA ? "Zona A vs. Zona B" : "Análisis de zona"}
        </span>
        <button onClick={alCerrar} className="text-texto-3 hover:text-texto">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px]">
        {/* Forma de la zona: círculo (arrastre) o polígono (clic a clic).
            La comparación A/B quedó pensada para círculos: mientras hay una
            Zona A fijada, el toggle se esconde para no mezclar geometrías. */}
        {!statsA && (
          <div className="flex items-center gap-1 rounded-lg border border-borde bg-panel-2/60 p-1">
            {(
              [
                ["circulo", "Círculo", <Circle key="c" size={12} />],
                ["poligono", "Polígono", <Hexagon key="p" size={12} />],
              ] as const
            ).map(([forma, etiqueta, icono]) => (
              <button
                key={forma}
                onClick={() => alCambiarForma(forma)}
                title={
                  forma === "circulo"
                    ? "Mantené clic y arrastrá en el mapa para dibujar un círculo"
                    : "Clic a clic marcás los vértices; doble clic (o clic en el primero) cierra el polígono"
                }
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                  zona.forma === forma ? "bg-azul text-white" : "text-texto-2 hover:text-texto"
                }`}
              >
                {icono}
                {etiqueta}
              </button>
            ))}
          </div>
        )}

        {esCirculo ? (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                Radio {statsA ? "de B" : ""}
              </span>
              <span className="num text-xs font-bold text-amarillo">{numero(zona.radio)} m</span>
            </div>
            <input
              type="range"
              min={60}
              max={2000}
              step={50}
              value={zona.radio}
              onChange={(e) => setRadio(Number(e.target.value))}
              className="w-full accent-[#f4dc00]"
            />
            <p className="mt-1 text-[10px] text-texto-3">
              Mantené clic y arrastrá en el mapa para dibujar otro círculo, o afiná el radio acá.
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Polígono</span>
              <span className="num text-xs font-bold text-amarillo">
                {zona.vertices.length} vértice{zona.vertices.length === 1 ? "" : "s"}
                {poligonoListo && stats ? ` · ${stats.hectareas.toFixed(1)} ha` : ""}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-texto-3">
              {zona.cerrado
                ? "Polígono cerrado. Un clic en el mapa arranca uno nuevo."
                : "Clic a clic vas marcando los vértices. Cerralo con doble clic, o con un clic sobre el primer vértice."}
            </p>
          </div>
        )}

        {statsA && stats ? (
          <ComparacionAB a={statsA} b={stats} />
        ) : stats ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Cifra n={stats.pendientes} etiqueta="pedidos pendientes" color="var(--color-amarillo)" />
              <Cifra n={stats.sinAtencion} etiqueta="sin atención (brecha)" color={COLOR_MACRO.en_curso} />
              <Cifra n={stats.enCurso + stats.abiertos} etiqueta="incidentes activos" color={COLOR_MACRO.abierto} />
              <Cifra n={stats.resueltos} etiqueta="reparaciones hechas" color={COLOR_MACRO.resuelto} />
            </div>

            {stats.m2 > 0 && (
              <p className="text-texto-2">
                <span className="num font-bold text-texto">{numero(stats.m2)} m²</span> intervenidos en la zona.
              </p>
            )}

            {stats.porTipo.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Qué se pide acá</p>
                {stats.porTipo.map(([tipo, n]) => (
                  <div key={tipo} className="flex items-baseline justify-between">
                    <span>{ETIQUETA_TIPO[tipo as keyof typeof ETIQUETA_TIPO] ?? tipo}</span>
                    <span className="num text-xs text-texto-2">{numero(n)}</span>
                  </div>
                ))}
              </div>
            )}

            {stats.porFuente.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Quién lo pide</p>
                {stats.porFuente.map(([fuente, n]) => (
                  <div key={fuente} className="flex items-baseline justify-between">
                    <span>{ETIQUETA_FUENTE[fuente as keyof typeof ETIQUETA_FUENTE] ?? fuente}</span>
                    <span className="num text-xs text-texto-2">{numero(n)}</span>
                  </div>
                ))}
              </div>
            )}

            {stats.topCalles.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Puntos calientes de la zona</p>
                {stats.topCalles.map(([dir, n]) => (
                  <div key={dir} className="flex items-baseline justify-between gap-2">
                    <span className="truncate" title={dir}>{dir}</span>
                    <span className="num shrink-0 text-xs font-bold text-encurso">{numero(n)}</span>
                  </div>
                ))}
              </div>
            )}

            {stats.demandas === 0 && stats.resueltos === 0 && (
              <p className="py-4 text-center text-texto-3">
                Nada registrado en esta zona. Probá {esCirculo ? "agrandar el radio" : "un polígono más grande"}.
              </p>
            )}
          </>
        ) : (
          <p className="py-6 text-center text-texto-3">
            Dibujá el polígono sobre el mapa: las estadísticas aparecen al cerrarlo.
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-borde p-3">
        {statsA ? (
          <button
            onClick={alQuitarA}
            className="block w-full rounded-lg border border-borde-2 px-3 py-2 text-center text-xs font-semibold text-texto-2 transition hover:border-peligro/60 hover:text-peligro"
          >
            Quitar comparación A/B
          </button>
        ) : (
          esCirculo &&
          alFijarA && (
            <button
              onClick={alFijarA}
              title="Congela este círculo como Zona A: el próximo que dibujes se compara contra él, con densidades por hectárea"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-celeste/50 bg-celeste/10 px-3 py-2 text-center text-xs font-semibold text-celeste transition hover:bg-celeste/20"
            >
              <GitCompareArrows size={13} /> Fijar como Zona A y comparar
            </button>
          )
        )}
        {puntoVista && (
          <Link
            href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${puntoVista.lat},${puntoVista.lon}`}
            target="_blank"
            className="block rounded-lg border border-borde-2 px-3 py-2 text-center text-xs font-semibold text-texto-2 transition hover:border-celeste hover:text-celeste"
          >
            Ver la zona en Street View ↗
          </Link>
        )}
      </div>
    </aside>
  );
}

/** Tabla comparativa A vs. B con densidades por hectárea (radios distintos comparables). */
function ComparacionAB({ a, b }: { a: StatsZona; b: StatsZona }) {
  const filas: Array<{ etiqueta: string; va: number; vb: number; color?: string }> = [
    { etiqueta: "Pedidos pendientes", va: a.pendientes, vb: b.pendientes, color: "var(--color-amarillo)" },
    { etiqueta: "Sin atención (brecha)", va: a.sinAtencion, vb: b.sinAtencion, color: COLOR_MACRO.en_curso },
    { etiqueta: "Incidentes activos", va: a.abiertos + a.enCurso, vb: b.abiertos + b.enCurso, color: COLOR_MACRO.abierto },
    { etiqueta: "Reparaciones hechas", va: a.resueltos, vb: b.resueltos, color: COLOR_MACRO.resuelto },
    { etiqueta: "m² intervenidos", va: a.m2, vb: b.m2 },
  ];
  return (
    <div>
      <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
        <span />
        <span className="text-celeste">A · {a.hectareas.toFixed(1)} ha</span>
        <span className="text-amarillo">B · {b.hectareas.toFixed(1)} ha</span>
      </div>
      <div className="space-y-1.5">
        {filas.map((f) => (
          <div key={f.etiqueta} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3">
            <span className="truncate text-[12px]" style={f.color ? { color: f.color } : undefined}>
              {f.etiqueta}
            </span>
            <span className="num text-right text-[13px] font-bold">{numero(f.va)}</span>
            <span className="num text-right text-[13px] font-bold">{numero(f.vb)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 mb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
        Por hectárea (comparación justa)
      </p>
      <div className="space-y-1.5">
        {filas.slice(0, 4).map((f) => (
          <div key={f.etiqueta} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3">
            <span className="truncate text-[12px] text-texto-2">{f.etiqueta}</span>
            <span className="num text-right text-xs">{(f.va / a.hectareas).toFixed(2)}</span>
            <span className="num text-right text-xs">{(f.vb / b.hectareas).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-texto-3">
        La densidad por hectárea permite comparar zonas de distinto tamaño: si B duplica a A en
        "sin atención" por hectárea, la deuda relativa de B es el doble.
      </p>
    </div>
  );
}

function Cifra({ n, etiqueta, color }: { n: number; etiqueta: string; color: string }) {
  return (
    <div className="rounded-lg border border-borde bg-panel-2/60 px-2.5 py-2">
      <div className="num text-lg font-extrabold" style={{ color }}>{numero(n)}</div>
      <div className="text-[10px] leading-tight text-texto-3">{etiqueta}</div>
    </div>
  );
}

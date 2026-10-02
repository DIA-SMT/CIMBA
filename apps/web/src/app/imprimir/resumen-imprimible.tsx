"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Layer, Map as MapaGL, Source } from "react-map-gl/maplibre";
import { etiquetaVentana, fechaLarga, nombreRecorte, type DatosAvance, type DiasVentana } from "@/lib/avance-tipos";
import { colorDeEmpresaEn } from "@/lib/color-empresa";
import { fechaCorta, numero } from "@/lib/formato";
import { ESTILO_MAPA_CLARO } from "@/components/mapa/tema-mapa";

/**
 * La hoja. Colores explícitos y no tokens del tema: el papel es blanco sea
 * cual sea el tema de la pantalla, y la impresora no sabe de modo oscuro. El
 * mapa va sobre el plano claro, fijo, sin controles, encuadrado en el recorte
 * o en la ciudad.
 */

const CIUDAD: [[number, number], [number, number]] = [[-65.29, -26.88], [-65.15, -26.76]];

function cajaDe(datos: DatosAvance): [[number, number], [number, number]] {
  const g = datos.territorio?.contorno;
  if (!g) return CIUDAD;
  const anillos = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const anillo of anillos) {
    for (const [lon, lat] of anillo as Array<[number, number]>) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return Number.isFinite(minLon) ? [[minLon, minLat], [maxLon, maxLat]] : CIUDAD;
}

export function ResumenImprimible({ datos, dias }: { datos: DatosAvance; dias: DiasVentana }) {
  const c = datos.cifras;
  const color = (e: string) => colorDeEmpresaEn(e, "claro");
  const hechos = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: datos.hechos.features.map((f) => ({ ...f, properties: { ...f.properties, color: color(f.properties.empresa) } })),
    }),
    [datos.hechos],
  );
  const contorno = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: datos.territorio ? [{ type: "Feature" as const, geometry: datos.territorio.contorno, properties: {} }] : [],
    }),
    [datos.territorio],
  );
  const caja = cajaDe(datos);
  const usaM2 = datos.porEmpresa.some((e) => e.m2 > 0);
  const maxEmpresa = Math.max(1, ...datos.porEmpresa.map((e) => (usaM2 ? e.m2 : e.n)));
  const maxSerie = Math.max(1, ...datos.serie.map((s) => s.m2));
  const generado = new Date(datos.generadoEn);
  const volver = `/avance?${new URLSearchParams({
    ...(dias !== 30 ? { dias: String(dias) } : {}),
    ...(datos.territorio ? { [datos.territorio.tipo]: String(datos.territorio.id) } : {}),
  }).toString()}`;

  return (
    <div className="min-h-screen bg-[#e9edf3] text-[#16202e] print:bg-white">
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          .hoja { box-shadow: none !important; margin: 0 !important; width: auto !important; padding: 0 !important; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-3 text-sm">
        <Link href={volver} className="flex items-center gap-1.5 font-semibold text-[#0b7fd1]">
          <ArrowLeft size={15} />
          Volver a Avance
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg bg-[#0066ff] px-4 py-2 font-bold text-white shadow"
        >
          <Printer size={15} />
          Imprimir
        </button>
      </div>

      <article className="hoja mx-auto mb-8 w-[210mm] bg-white p-[10mm] shadow-xl" style={{ fontFamily: "var(--font-sans)" }}>
        {/* Encabezado */}
        <header className="flex items-start justify-between border-b-2 border-[#16202e] pb-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-[#4a5a72] uppercase">Municipalidad de San Miguel de Tucumán · CIMBA</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Avance de bacheo</h1>
            <p className="text-sm text-[#4a5a72]">
              {etiquetaVentana(dias, c.total.desde)} · {nombreRecorte(datos.territorio)}
            </p>
          </div>
          <div className="text-right text-[11px] text-[#4a5a72]">
            <p className="font-semibold text-[#16202e]">
              {generado.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            <p>{generado.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })} hs · datos del sistema CIMBA</p>
          </div>
        </header>

        {/* El mapa, fijo */}
        <div className="mt-4 h-[92mm] overflow-hidden rounded-lg border border-[#d8e0eb]">
          <MapaGL
            initialViewState={{ bounds: caja, fitBoundsOptions: { padding: 24 } }}
            mapStyle={ESTILO_MAPA_CLARO}
            interactive={false}
            attributionControl={false}
            canvasContextAttributes={{ preserveDrawingBuffer: true }}
          >
            <Source id="imp-terr" type="geojson" data={contorno}>
              <Layer id="imp-terr-borde" type="line" paint={{ "line-color": "#a89400", "line-width": 2 }} />
            </Source>
            <Source id="imp-hechos" type="geojson" data={hechos}>
              <Layer
                id="imp-hechos-punto"
                type="circle"
                paint={{
                  "circle-color": ["get", "color"],
                  "circle-radius": ["min", 14, ["+", 3, ["*", 0.6, ["sqrt", ["max", 0, ["coalesce", ["get", "m2"], 0]]]]]],
                  "circle-opacity": 0.85,
                  "circle-stroke-color": "#16202e",
                  "circle-stroke-width": 0.6,
                  "circle-stroke-opacity": 0.5,
                }}
              />
            </Source>
          </MapaGL>
        </div>
        <p className="mt-1 text-[9px] text-[#66758d]">
          Cada círculo es un trabajo terminado, del color de su empresa y del tamaño de sus m². Plano © CARTO, © OpenStreetMap.
        </p>

        {/* Las cifras */}
        <section className="mt-4 grid grid-cols-4 gap-3">
          <Cifra etiqueta="Baches reparados" valor={numero(c.ventana.n)} />
          <Cifra etiqueta="Metros cuadrados" valor={`${numero(c.ventana.m2)} m²`} nota={c.ventana.sinMedida > 0 ? `${numero(c.ventana.sinMedida)} sin medida cargada` : undefined} />
          <Cifra etiqueta="Mezcla asfáltica" valor={`${numero(c.ventana.toneladas)} t`} />
          <Cifra etiqueta="Empresas" valor={numero(c.ventana.empresas)} nota={c.ventana.vecinos > 0 ? `${numero(c.ventana.vecinos)} vecinos con su pedido cerrado` : undefined} />
        </section>

        <div className="mt-4 grid grid-cols-2 gap-5 text-[11px]">
          <div>
            <Titulo>Quién produjo</Titulo>
            <table className="w-full">
              <tbody>
                {datos.porEmpresa.slice(0, 10).map((e) => (
                  <tr key={e.empresa} className="border-b border-[#eef2f7]">
                    <td className="py-1 pr-2">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color(e.empresa) }} />
                      {e.empresa}
                    </td>
                    <td className="w-[38%] py-1">
                      <div className="h-1.5 overflow-hidden rounded bg-[#eef2f7]">
                        <div className="h-full rounded" style={{ width: `${Math.max(2, Math.round(((usaM2 ? e.m2 : e.n) / maxEmpresa) * 100))}%`, background: color(e.empresa) }} />
                      </div>
                    </td>
                    <td className="num py-1 pl-2 text-right whitespace-nowrap">
                      {e.m2 > 0 ? `${numero(e.m2)} m²` : "sin m²"} · {numero(e.n)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {datos.topBarrios.length > 0 && (
              <>
                <Titulo className="mt-4">Dónde se avanzó más</Titulo>
                <ol className="space-y-0.5">
                  {datos.topBarrios.map((b, i) => (
                    <li key={b.id} className="flex justify-between border-b border-[#eef2f7] py-0.5">
                      <span>
                        <span className="num mr-1.5 text-[#66758d]">{i + 1}</span>
                        {b.nombre}
                      </span>
                      <span className="num text-[#4a5a72]">
                        {numero(b.n)} baches{b.m2 > 0 ? ` · ${numero(b.m2)} m²` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

          <div>
            <Titulo>En obra ahora</Titulo>
            <p>
              <b>{numero(c.ahora.ordenesActivas)}</b> {c.ahora.ordenesActivas === 1 ? "orden activa" : "órdenes activas"} ·{" "}
              <b>{numero(c.ahora.obras)}</b> {c.ahora.obras === 1 ? "obra" : "obras"} en curso
              {c.ahora.m2 > 0 ? ` (${numero(c.ahora.m2)} m²)` : ""}
            </p>
            {datos.ordenes.length > 0 && (
              <table className="mt-1.5 w-full">
                <tbody>
                  {datos.ordenes.slice(0, 8).map((o) => (
                    <tr key={o.id} className="border-b border-[#eef2f7]">
                      <td className="num py-0.5 pr-2 font-semibold">{o.numero}</td>
                      <td className="py-0.5 pr-2">{o.empresa}</td>
                      <td className="num py-0.5 text-right whitespace-nowrap">
                        {numero(o.hechos)}/{numero(o.items)} · {o.ultimo ? fechaCorta(o.ultimo) : "sin reporte"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <Titulo className="mt-4">Queda por hacer</Titulo>
            <p>
              <b>{numero(c.pendientes.pedidos)}</b> pedidos de bacheo en cola · <b>{numero(c.pendientes.incidentes)}</b> baches en agenda
              {c.pendientes.asignadas > 0 && (
                <>
                  {" "}· <b>{numero(c.pendientes.asignadas)}</b> obras asignadas sin empezar
                  {c.pendientes.asignadasM2 > 0 ? ` (${numero(c.pendientes.asignadasM2)} m²)` : ""}
                </>
              )}
            </p>

            <Titulo className="mt-4">Ritmo · m² por semana, últimas 26 semanas</Titulo>
            <svg viewBox={`0 0 ${datos.serie.length * 12 - 3} 44`} className="block h-12 w-full" role="img" aria-label="m² por semana">
              {datos.serie.map((s, i) => {
                const h = Math.max(1.5, Math.round((s.m2 / maxSerie) * 40));
                const actual = i === datos.serie.length - 1;
                const enVentana = !datos.ventana.desde || s.semana >= datos.ventana.desde || actual;
                return <rect key={s.semana} x={i * 12} y={44 - h} width={9} height={h} rx="1" fill={actual ? "#a89400" : enVentana ? "#0b7fd1" : "#c9d4e5"} />;
              })}
            </svg>
            <div className="flex justify-between text-[9px] text-[#66758d]">
              <span>hace 26 semanas</span>
              <span>esta semana</span>
            </div>
          </div>
        </div>

        {/* Las fotos */}
        {datos.fotos.length > 0 && (
          <section className="mt-4">
            <Titulo>Últimos trabajos terminados</Titulo>
            <div className="grid grid-cols-6 gap-2">
              {datos.fotos.slice(0, 6).map((f, i) => (
                <figure key={`${f.url}-${i}`} className="m-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas */}
                  <img src={f.url} alt={f.direccion ?? "Trabajo terminado"} className="aspect-square w-full rounded border border-[#d8e0eb] object-cover" />
                  <figcaption className="mt-0.5 truncate text-[9px] text-[#4a5a72]">
                    {f.direccion ?? ""}
                    {f.empresa ? ` · ${f.empresa}` : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-4 border-t border-[#d8e0eb] pt-2 text-[9px] text-[#66758d]">
          "Hecho" son las intervenciones finalizadas registradas en CIMBA; la fecha es la del trabajo, no la de la carga.
          {c.total.desde ? ` Datos desde el ${fechaLarga(c.total.desde, true)}.` : ""} Generado el{" "}
          {generado.toLocaleDateString("es-AR")} a las {generado.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}.
        </footer>
      </article>
    </div>
  );
}

function Cifra({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border border-[#d8e0eb] bg-[#f4f7fb] px-3 py-2">
      <p className="text-[9px] font-bold tracking-[0.14em] text-[#66758d] uppercase">{etiqueta}</p>
      <p className="num mt-0.5 text-xl leading-none font-extrabold">{valor}</p>
      {nota && <p className="mt-1 text-[9px] text-[#66758d]">{nota}</p>}
    </div>
  );
}

function Titulo({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`mb-1.5 text-[9px] font-bold tracking-[0.14em] text-[#66758d] uppercase ${className}`}>{children}</p>;
}

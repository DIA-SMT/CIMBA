import Link from "next/link";
import { Info } from "lucide-react";
import { ESTADOS_INCIDENTE, TIPOS_PROBLEMA, type EstadoIncidente } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { listarCuadrillas, listarIncidentes, resumenIncidentes } from "@/lib/consultas";
import { COLOR_MACRO, ETIQUETA_ESTADO_INCIDENTE, ETIQUETA_TIPO, fechaCorta, macroDeEstado, numero } from "@/lib/formato";
import { BadgeEstadoIncidente, BadgeTipo, Panel, TituloPagina } from "@/components/ui";
import { AccionesIncidente } from "./acciones-incidente";
import { VerEnMapa } from "@/components/mapa/ver-en-mapa";
import { BusquedaNatural } from "@/components/busqueda-natural";
import { CadenaFlujo } from "@/components/cadena-flujo";

export const dynamic = "force-dynamic";

const EXPLICACION_SCORE =
  "Score de prioridad (0-100): decide qué se repara primero. Suma presión de pedidos (hasta 35 pts), antigüedad (20), severidad del tipo (25), reincidencia (12) y corredor principal (8).";

export default async function PaginaIncidentes({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; tipo?: string; q?: string; pagina?: string; orden?: string; foco?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const pagina = Math.max(1, Number(filtros.pagina ?? 1) || 1);
  const [{ filas, total }, resumen, cuadrillas] = await Promise.all([
    listarIncidentes(sesion, {
      estado: filtros.estado,
      tipo: filtros.tipo,
      q: filtros.q,
      pagina,
      limite: 50,
      orden: filtros.orden === "fecha" ? "fecha" : "prioridad",
    }),
    resumenIncidentes(sesion),
    listarCuadrillas(sesion),
  ]);
  const paginas = Math.max(1, Math.ceil(total / 50));
  const puedePlanificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";
  const puedeVerificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "supervision";
  const foco = filtros.foco ? Number(filtros.foco) : null;
  const maxScore = Math.max(1, ...filas.map((f) => f.scorePrioridad ?? 0));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Cola de incidentes: qué se repara primero"
        sub="Cada fila es un problema del territorio. El score de prioridad ordena la fila: más alto, antes le toca."
      />

      <CadenaFlujo actual={2} />

      {/* La cola en números: cada estado es un filtro de un clic */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Link
          href="/incidentes"
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${!filtros.estado ? "border-celeste/60 bg-celeste/10 text-celeste" : "border-borde-2 text-texto-2 hover:border-celeste/50 hover:text-texto"}`}
        >
          Todos <span className="num">{numero(resumen.total)}</span>
        </Link>
        {ESTADOS_INCIDENTE.map((e) => {
          const n = resumen.porEstado[e] ?? 0;
          if (n === 0) return null;
          const color = COLOR_MACRO[macroDeEstado(e)];
          const activo = filtros.estado === e;
          return (
            <Link
              key={e}
              href={`/incidentes?estado=${e}`}
              title={`Ver solo los ${ETIQUETA_ESTADO_INCIDENTE[e].toLowerCase()}`}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${activo ? "border-borde-2 bg-panel-2 text-texto" : "border-borde text-texto-2 hover:border-borde-2 hover:text-texto"}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {ETIQUETA_ESTADO_INCIDENTE[e]} <span className="num text-texto-3">{numero(n)}</span>
            </Link>
          );
        })}
      </div>

      {/* Qué significa el score, de una vez y para siempre */}
      <p className="mb-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-texto-3">
        <Info size={13} className="mt-0.5 shrink-0 text-celeste" />
        <span>
          {EXPLICACION_SCORE}
          {resumen.sinScore > 0 && (
            <>
              {" "}Los <b className="num">{numero(resumen.sinScore)}</b> con “—” todavía no pasaron por la{" "}
              <Link href="/calidad" className="text-celeste hover:underline">consolidación</Link>, que es la que calcula el score.
            </>
          )}
        </span>
      </p>

      <BusquedaNatural
        destino="incidentes"
        ejemplo="baches reparados en mate de luna"
        inicial={filtros.q ?? ""}
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/incidentes" method="get">
        {filtros.q && <input type="hidden" name="q" value={filtros.q} />}
        <select name="estado" defaultValue={filtros.estado ?? ""} className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
          <option value="">Todos los estados</option>
          {ESTADOS_INCIDENTE.map((e) => (
            <option key={e} value={e}>{ETIQUETA_ESTADO_INCIDENTE[e]}</option>
          ))}
        </select>
        <select name="tipo" defaultValue={filtros.tipo ?? ""} className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
          <option value="">Todos los tipos</option>
          {TIPOS_PROBLEMA.map((t) => (
            <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>
          ))}
        </select>
        <select name="orden" defaultValue={filtros.orden ?? "prioridad"} className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
          <option value="prioridad">Por prioridad</option>
          <option value="fecha">Por fecha</option>
        </select>
        <button className="rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
          Filtrar
        </button>
        <span className="ml-auto text-xs text-texto-3">{numero(total)} con estos filtros</span>
        <a
          href={`/api/exportar?entidad=incidentes&${new URLSearchParams(
            Object.fromEntries(
              Object.entries({ estado: filtros.estado, tipo: filtros.tipo, q: filtros.q, orden: filtros.orden }).filter(
                ([, v]) => v,
              ),
            ) as Record<string, string>,
          ).toString()}`}
          className="text-xs font-semibold text-celeste hover:underline"
          title="Descargar lo filtrado como CSV (Excel, PowerBI, QGIS)"
        >
          ⤓ CSV
        </a>
      </form>

      <Panel className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3" title={EXPLICACION_SCORE}>Prioridad ⓘ</th>
              <th className="px-4 py-3">Problema</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" title="Cuántos pedidos (demandas) apuntan a este problema">Pedidos</th>
              <th className="px-4 py-3" title="Cuántos trabajos (intervenciones) lo atendieron">Trabajos</th>
              <th className="px-4 py-3">Detectado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filas.map((i) => (
              <tr
                key={i.id}
                className={`border-b border-borde/60 transition hover:bg-panel-2 ${foco === i.id ? "bg-azul/10" : ""}`}
              >
                <td className="px-4 py-2.5">
                  {i.scorePrioridad != null ? (
                    <div className="w-20" title={EXPLICACION_SCORE}>
                      <span
                        className={`num text-[13px] font-bold ${i.scorePrioridad >= 60 ? "text-amarillo" : i.scorePrioridad >= 35 ? "text-celeste" : "text-texto-2"}`}
                      >
                        {i.scorePrioridad.toFixed(1)}
                      </span>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-3">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, (100 * i.scorePrioridad) / maxScore)}%`,
                            background: i.scorePrioridad >= 60 ? "var(--color-amarillo)" : i.scorePrioridad >= 35 ? "var(--color-celeste)" : "#8b94a3",
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-texto-3" title="Sin score todavía: se calcula al pasar por la consolidación (Calidad)">—</span>
                  )}
                </td>
                <td className="max-w-64 px-4 py-2.5">
                  <Link
                    href={`/incidentes/${i.id}`}
                    className="block truncate font-medium hover:text-celeste hover:underline"
                    title={i.direccion ? `${i.direccion} — ver la historia completa` : "Ver la historia completa de este incidente"}
                  >
                    {i.direccion ?? `Incidente #${i.id}`}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <BadgeTipo tipo={i.tipo} />
                    <span className="num text-[10px] text-texto-3">#{i.id}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5"><BadgeEstadoIncidente estado={i.estado} /></td>
                <td className="px-4 py-2.5">
                  <span
                    className={`num text-[13px] font-bold ${i.demandas > 0 ? "" : "text-texto-3"}`}
                    style={i.demandas > 0 ? { color: "var(--color-abierto)" } : undefined}
                    title={i.demandas === 0 ? "Nadie lo pidió: se detectó trabajando" : `${i.demandas} pedido(s) apuntan acá`}
                  >
                    {i.demandas}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`num text-[13px] font-bold ${i.intervenciones > 0 ? "" : "text-texto-3"}`}
                    style={i.intervenciones > 0 ? { color: "var(--color-ok)" } : undefined}
                    title={i.intervenciones === 0 ? "Todavía sin trabajo asignado" : `${i.intervenciones} trabajo(s) lo atendieron`}
                  >
                    {i.intervenciones}
                  </span>
                </td>
                <td className="num px-4 py-2.5 text-texto-2">{fechaCorta(i.detectadoEn)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    <VerEnMapa lat={i.lat} lon={i.lon} etiqueta={i.direccion ?? `Incidente #${i.id}`} />
                    <AccionesIncidente
                      incidenteId={i.id}
                      estado={i.estado}
                      cuadrillas={cuadrillas}
                      puedePlanificar={puedePlanificar}
                      puedeVerificar={puedeVerificar}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-texto-3">Sin incidentes con estos filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      {paginas > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {pagina > 1 && (
            <Link className="text-celeste hover:underline" href={urlPagina(filtros, pagina - 1)}>← Anterior</Link>
          )}
          <span className="num text-texto-3">{pagina} / {paginas}</span>
          {pagina < paginas && (
            <Link className="text-celeste hover:underline" href={urlPagina(filtros, pagina + 1)}>Siguiente →</Link>
          )}
        </div>
      )}
    </div>
  );
}

function urlPagina(filtros: { estado?: string; tipo?: string; q?: string; orden?: string }, pagina: number): string {
  const p = new URLSearchParams();
  if (filtros.estado) p.set("estado", filtros.estado);
  if (filtros.tipo) p.set("tipo", filtros.tipo);
  if (filtros.q) p.set("q", filtros.q);
  if (filtros.orden) p.set("orden", filtros.orden);
  p.set("pagina", String(pagina));
  return `/incidentes?${p.toString()}`;
}

import Link from "next/link";
import { ESTADOS_ORDEN, type EstadoOrden } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { listarEmpresas, listarOrdenes, obtenerCapacidad, resumenCircuitos } from "@/lib/ordenes";
import { fechaCorta, hoyISO, numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { AsignacionCircuito } from "./asignacion-circuito";
import { PanelProyeccion } from "./panel-proyeccion";
import {
  COLOR_ESTADO_ORDEN,
  COLOR_PRIORIDAD,
  ETIQUETA_ESTADO_ORDEN,
  ETIQUETA_PRIORIDAD,
} from "./etiquetas";

export const dynamic = "force-dynamic";

export default async function PaginaOrdenes({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const [circuitos, empresas, ordenes, parametros] = await Promise.all([
    resumenCircuitos(sesion),
    listarEmpresas(sesion),
    // Sin filtro en la consulta: los KPIs necesitan el total y el listado se
    // filtra acá mismo (son ≤200 filas).
    listarOrdenes(sesion),
    obtenerCapacidad(sesion),
  ]);
  const puedePlanificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";

  const estadoFiltro = ESTADOS_ORDEN.includes(filtros.estado as EstadoOrden)
    ? (filtros.estado as EstadoOrden)
    : undefined;
  const ordenesFiltradas = estadoFiltro ? ordenes.filter((o) => o.estado === estadoFiltro) : ordenes;

  // KPIs del tablero
  const ordenesActivas = ordenes.filter((o) => o.estado === "emitida" || o.estado === "en_ejecucion");
  const itemsPendientes = empresas.reduce((a, e) => a + e.itemsPendientes, 0);
  const m2Reportados = ordenes.reduce((a, o) => a + o.m2Reportados, 0);
  const empresasConCarga = empresas.filter((e) => e.itemsPendientes > 0).length;

  // Insumos de la proyección: todo lo pendiente de la ciudad contra la
  // dotación total de las contratistas activas. No sabemos cuántos pendientes
  // son carpetas, así que se precargan como baches: el usuario lo ajusta.
  const totalPendientes = circuitos.reduce((a, c) => a + c.pendientes, 0);
  const cuadrillasActivas = empresas.filter((e) => e.activa).reduce((a, e) => a + e.cuadrillas, 0);

  const empresasParaAsignar = empresas.filter((e) => e.activa).map((e) => ({ id: e.id, nombre: e.nombre }));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <TituloPagina
        titulo="Órdenes de trabajo"
        sub="El circuito como unidad de planificación: qué se releva, quién lo trabaja y con qué prioridad."
        extra={
          <div className="flex items-center gap-3">
            <Link
              href="/ordenes/empresas"
              className="rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
            >
              Empresas y accesos
            </Link>
            {puedePlanificar && (
              <Link
                href="/ordenes/nueva"
                className="rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
              >
                + Nueva orden
              </Link>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi n={ordenesActivas.length} etiqueta="órdenes activas" color="#3987e5" nota="emitidas o en ejecución" />
        <Kpi n={itemsPendientes} etiqueta="items pendientes" color="#d95926" nota="baches y tramos ya asignados a empresas" />
        <Kpi n={m2Reportados} etiqueta="m² reportados" color="#199e70" nota="superficie cargada por las empresas" />
        <Kpi n={empresasConCarga} etiqueta="empresas con carga" color="#f4dc00" nota={`de ${empresas.length} registradas`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Tabla de circuitos: la vista de relevamiento del Director */}
        <div className="min-w-0">
          <h2 className="mb-3 text-sm font-bold tracking-wide uppercase">
            Los 47 circuitos{" "}
            <span className="font-normal text-texto-3 normal-case">
              — ordenados por pendientes; la prioridad y la empresa se editan acá mismo
            </span>
          </h2>
          <Panel className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                  <th className="px-3 py-3">Circuito</th>
                  <th className="px-3 py-3">Prioridad</th>
                  <th className="px-3 py-3">Empresa</th>
                  <th className="num px-3 py-3 text-right">Pendientes</th>
                  <th className="num px-3 py-3 text-right" title="Reclamos abiertos de vecinos e instituciones que caen en el circuito">
                    Reclamos
                  </th>
                  <th className="num px-3 py-3 text-right">Reparados</th>
                  <th className="num px-3 py-3 text-right" title="Órdenes emitidas o en ejecución ahora">
                    OTs
                  </th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {circuitos.map((c) => (
                  <tr key={c.id} className="border-b border-borde/60 transition hover:bg-panel-2">
                    <td className="px-3 py-2 font-bold">{c.codigo}</td>
                    {puedePlanificar ? (
                      <AsignacionCircuito
                        circuitoId={c.id}
                        prioridad={c.prioridad}
                        empresaId={c.empresaId}
                        empresas={empresasParaAsignar}
                      />
                    ) : (
                      <>
                        <td className="px-3 py-2 text-xs" style={{ color: c.prioridad ? COLOR_PRIORIDAD[c.prioridad] : undefined }}>
                          {c.prioridad ? ETIQUETA_PRIORIDAD[c.prioridad] : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-texto-2">{c.empresaNombre ?? "—"}</td>
                      </>
                    )}
                    <td className="num px-3 py-2 text-right font-bold" style={{ color: c.pendientes > 0 ? "#d95926" : "#5c6b84" }}>
                      {numero(c.pendientes)}
                    </td>
                    <td className="num px-3 py-2 text-right text-amarillo">{numero(c.demandasAbiertas)}</td>
                    <td className="num px-3 py-2 text-right" style={{ color: "#199e70" }}>
                      {numero(c.reparados)}
                    </td>
                    <td className="num px-3 py-2 text-right text-texto-2">{numero(c.ordenesActivas)}</td>
                    <td className="px-3 py-2 text-right">
                      {/* Deep-link al centroide: el mapa todavía no filtra por circuito */}
                      <Link
                        href={
                          c.lat != null && c.lon != null
                            ? `/mapa?lat=${c.lat.toFixed(6)}&lon=${c.lon.toFixed(6)}&z=15`
                            : "/mapa"
                        }
                        title={`Ver la zona del circuito ${c.codigo} en el mapa`}
                        className="text-xs font-semibold whitespace-nowrap text-celeste hover:underline"
                      >
                        ver en mapa →
                      </Link>
                    </td>
                  </tr>
                ))}
                {circuitos.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-texto-3">
                      Sin circuitos cargados todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>
        </div>

        {/* Proyección de capacidad */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold tracking-wide uppercase">Proyección</h2>
          <PanelProyeccion
            parametros={parametros}
            bachesIniciales={totalPendientes}
            carpetasIniciales={0}
            cuadrillasIniciales={cuadrillasActivas}
            puedeEditar={puedePlanificar}
          />
          <p className="text-[11px] leading-relaxed text-texto-3">
            {numero(totalPendientes)} pendientes en toda la ciudad y {numero(cuadrillasActivas)} cuadrillas
            contratadas activas.
          </p>
        </div>
      </div>

      {/* Listado de órdenes */}
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide uppercase">
        Órdenes <span className="font-normal text-texto-3 normal-case">— las últimas 200</span>
      </h2>
      <form className="mb-3 flex flex-wrap items-center gap-2" action="/ordenes" method="get">
        <select
          name="estado"
          defaultValue={estadoFiltro ?? ""}
          className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_ORDEN.map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO_ORDEN[e]}
            </option>
          ))}
        </select>
        <button className="rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste">
          Filtrar
        </button>
        {estadoFiltro && (
          <Link href="/ordenes" className="text-sm text-texto-2 hover:text-texto">
            Limpiar
          </Link>
        )}
      </form>
      <Panel className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3">Número</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Circuito</th>
              <th className="px-4 py-3">Prioridad</th>
              <th className="px-4 py-3">Progreso</th>
              <th className="num px-4 py-3 text-right">m²</th>
              <th className="px-4 py-3">Vence</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {ordenesFiltradas.map((o) => {
              const pct = o.items > 0 ? Math.round((100 * o.hechos) / o.items) : 0;
              // venceEn ya es "YYYY-MM-DD" local: comparar como texto evita el
              // corrimiento UTC que marcaba vencida una orden desde la víspera.
              const vencida =
                o.venceEn != null &&
                (o.estado === "emitida" || o.estado === "en_ejecucion") &&
                o.venceEn < hoyISO();
              return (
                <tr key={o.id} className="border-b border-borde/60 transition hover:bg-panel-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/ordenes/${o.id}`} className="num font-bold text-celeste hover:underline">
                      {o.numero}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: `${COLOR_ESTADO_ORDEN[o.estado]}22`, color: COLOR_ESTADO_ORDEN[o.estado] }}
                    >
                      {ETIQUETA_ESTADO_ORDEN[o.estado]}
                    </span>
                  </td>
                  <td className="max-w-44 truncate px-4 py-2.5" title={o.empresaNombre}>
                    {o.empresaNombre}
                  </td>
                  <td className="px-4 py-2.5 font-semibold">{o.circuitoCodigo ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: COLOR_PRIORIDAD[o.prioridad] }}>
                    {ETIQUETA_PRIORIDAD[o.prioridad]}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="num text-xs text-texto-2">
                        {numero(o.hechos)}/{numero(o.items)}
                      </span>
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "#199e70" }} />
                      </span>
                    </div>
                  </td>
                  <td className="num px-4 py-2.5 text-right" style={{ color: o.m2Reportados > 0 ? "#199e70" : "#5c6b84" }}>
                    {o.m2Reportados > 0 ? numero(o.m2Reportados) : "—"}
                  </td>
                  <td className={`num px-4 py-2.5 ${vencida ? "font-bold text-peligro" : "text-texto-2"}`} title={vencida ? "Vencida y todavía activa" : undefined}>
                    {fechaCorta(o.venceEn)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/ordenes/${o.id}`} className="text-xs font-semibold text-celeste hover:underline">
                      Abrir →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {ordenesFiltradas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-texto-3">
                  {estadoFiltro
                    ? "No hay órdenes en este estado."
                    : "Todavía no hay órdenes: creá la primera con “+ Nueva orden”."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Kpi({ n, etiqueta, color, nota }: { n: number; etiqueta: string; color: string; nota?: string }) {
  return (
    <div className="panel-vidrio rounded-xl border-t-2 px-4 py-3" style={{ borderTopColor: color }}>
      <p className="num text-2xl font-extrabold" style={{ color }}>
        {numero(n)}
      </p>
      <p className="text-[11px] leading-tight text-texto-2">{etiqueta}</p>
      {nota && <p className="mt-0.5 text-[10px] leading-tight text-texto-3">{nota}</p>}
    </div>
  );
}

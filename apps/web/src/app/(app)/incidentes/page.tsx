import Link from "next/link";
import { ESTADOS_INCIDENTE, TIPOS_PROBLEMA } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { listarCuadrillas, listarIncidentes } from "@/lib/consultas";
import { ETIQUETA_ESTADO_INCIDENTE, ETIQUETA_TIPO, fechaCorta, numero } from "@/lib/formato";
import { BadgeEstadoIncidente, BadgeTipo, Panel, TituloPagina } from "@/components/ui";
import { AccionesIncidente } from "./acciones-incidente";
import { VerEnMapa } from "@/components/mapa/ver-en-mapa";

export const dynamic = "force-dynamic";

export default async function PaginaIncidentes({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; tipo?: string; pagina?: string; orden?: string; foco?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const pagina = Math.max(1, Number(filtros.pagina ?? 1) || 1);
  const { filas, total } = await listarIncidentes(sesion, {
    estado: filtros.estado,
    tipo: filtros.tipo,
    pagina,
    limite: 50,
    orden: filtros.orden === "fecha" ? "fecha" : "prioridad",
  });
  const cuadrillas = await listarCuadrillas(sesion);
  const paginas = Math.max(1, Math.ceil(total / 50));
  const puedePlanificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";
  const puedeVerificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "supervision";
  const foco = filtros.foco ? Number(filtros.foco) : null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Cola de incidentes"
        sub={`${numero(total)} incidentes · ordenados por score de prioridad`}
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/incidentes" method="get">
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
      </form>

      <Panel className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Prioridad</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Dirección</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Dem.</th>
              <th className="px-4 py-3">Interv.</th>
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
                <td className="num px-4 py-2.5 text-texto-3">{i.id}</td>
                <td className="px-4 py-2.5">
                  {i.scorePrioridad != null ? (
                    <span
                      className={`num font-bold ${i.scorePrioridad >= 60 ? "text-amarillo" : i.scorePrioridad >= 35 ? "text-celeste" : "text-texto-2"}`}
                    >
                      {i.scorePrioridad.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-texto-3">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5"><BadgeTipo tipo={i.tipo} /></td>
                <td className="max-w-56 truncate px-4 py-2.5" title={i.direccion ?? ""}>{i.direccion ?? "—"}</td>
                <td className="px-4 py-2.5"><BadgeEstadoIncidente estado={i.estado} /></td>
                <td className="num px-4 py-2.5">{i.demandas}</td>
                <td className="num px-4 py-2.5">{i.intervenciones}</td>
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
                <td colSpan={9} className="px-4 py-10 text-center text-texto-3">Sin incidentes con estos filtros.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      {paginas > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {pagina > 1 && (
            <Link className="text-celeste hover:underline" href={`/incidentes?pagina=${pagina - 1}`}>← Anterior</Link>
          )}
          <span className="num text-texto-3">{pagina} / {paginas}</span>
          {pagina < paginas && (
            <Link className="text-celeste hover:underline" href={`/incidentes?pagina=${pagina + 1}`}>Siguiente →</Link>
          )}
        </div>
      )}
    </div>
  );
}

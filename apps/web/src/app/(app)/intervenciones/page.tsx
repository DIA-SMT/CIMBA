import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { listarEjecutores, listarIntervenciones, resumenIntervenciones } from "@/lib/consultas";
import { fechaCorta, numero } from "@/lib/formato";
import { BadgeTipo, Panel, TituloPagina } from "@/components/ui";
import { VerEnMapa } from "@/components/mapa/ver-en-mapa";
import { BusquedaNatural } from "@/components/busqueda-natural";
import { CadenaFlujo } from "@/components/cadena-flujo";

export const dynamic = "force-dynamic";

const ETIQUETA: Record<string, string> = {
  asignada: "Asignada",
  en_curso: "En curso",
  finalizada: "Finalizada",
  anulada: "Anulada",
};

/** Paleta funcional (la misma del mapa y de Brecha). */
const C = { pedido: "#3987e5", curso: "#d95926", hecho: "#199e70" } as const;

export default async function PaginaIntervenciones({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; ejecutor?: string; q?: string; pagina?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const pagina = Math.max(1, Number(filtros.pagina ?? 1) || 1);
  const [{ filas, total }, ejecutores, resumen] = await Promise.all([
    listarIntervenciones(sesion, { estado: filtros.estado, ejecutor: filtros.ejecutor, q: filtros.q, pagina, limite: 50 }),
    listarEjecutores(sesion),
    resumenIntervenciones(sesion),
  ]);
  const paginas = Math.max(1, Math.ceil(total / 50));
  const maxM2 = Math.max(1, ...filas.map((f) => f.superficieM2 ?? 0));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Intervenciones: el trabajo en la calle"
        sub="Cada fila es un trabajo concreto de reparación — de una cuadrilla municipal o de una obra contratada (SIGOV)."
      />

      <CadenaFlujo actual={3} />

      {/* El panorama en números */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Cifra n={resumen.finalizadas} etiqueta="trabajos finalizados" color={C.hecho}
          nota={`${numero(resumen.m2)} m² reparados`} />
        <Cifra n={resumen.enCurso} etiqueta="en curso ahora" color={C.curso} />
        <Cifra n={resumen.asignadas} etiqueta="asignados, por empezar" color="#f4dc00" />
        <Cifra n={resumen.contratadas} etiqueta="obras contratadas (SIGOV)" color={C.pedido}
          nota={`${numero(resumen.municipales)} de gestión municipal (bacheo y cuadrillas)`} />
      </div>

      <BusquedaNatural
        destino="intervenciones"
        ejemplo="trabajos terminados en avenida colón"
        inicial={filtros.q ?? ""}
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/intervenciones" method="get">
        {filtros.q && <input type="hidden" name="q" value={filtros.q} />}
        <select name="estado" defaultValue={filtros.estado ?? ""} className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
          <option value="">Todos los estados</option>
          {Object.entries(ETIQUETA).map(([v, e]) => (
            <option key={v} value={v}>{e}</option>
          ))}
        </select>
        <select name="ejecutor" defaultValue={filtros.ejecutor ?? ""} className="max-w-64 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
          <option value="">Todos los ejecutores</option>
          {ejecutores.map((e) => (
            <option key={e.nombre} value={e.nombre}>{e.nombre} ({e.n})</option>
          ))}
        </select>
        <button className="rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
          Filtrar
        </button>
        {(filtros.estado || filtros.ejecutor) && (
          <Link href="/intervenciones" className="text-sm text-texto-2 hover:text-texto">Limpiar</Link>
        )}
        <span className="ml-auto text-xs text-texto-3">{numero(total)} trabajos con estos filtros</span>
        <a
          href={`/api/exportar?entidad=intervenciones&${new URLSearchParams(
            Object.fromEntries(
              Object.entries({ estado: filtros.estado, ejecutor: filtros.ejecutor, q: filtros.q }).filter(([, v]) => v),
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
              <th className="px-4 py-3">Dónde</th>
              <th className="px-4 py-3">Quién lo hace</th>
              <th className="px-4 py-3">Avance</th>
              <th className="px-4 py-3">Superficie</th>
              <th className="px-4 py-3">Fin</th>
              <th className="px-4 py-3" title="La historia del problema que originó este trabajo: qué se pidió, qué se hizo">Historia</th>
              <th className="px-4 py-3">Mapa</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((iv) => {
              const contratista = (iv.metadata.contratista as string) ?? null;
              const esContratada = contratista != null || iv.metadata.obra_id != null;
              const ejecutor = iv.cuadrilla ?? contratista ?? "Sin asignar";
              return (
                <tr key={iv.id} className="border-b border-borde/60 transition hover:bg-panel-2">
                  <td className="max-w-60 px-4 py-2.5">
                    <p className="truncate font-medium" title={iv.direccion ?? ""}>{iv.direccion ?? "—"}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <BadgeTipo tipo={iv.tipo} />
                      {iv.fotos > 0 && <span className="num text-[10px] text-texto-3">📷 {iv.fotos}</span>}
                    </div>
                  </td>
                  <td className="max-w-44 px-4 py-2.5">
                    <p className="truncate text-[13px]" title={ejecutor}>{ejecutor}</p>
                    <p className="text-[10px] text-texto-3">
                      {iv.cuadrilla ? "Cuadrilla municipal" : esContratada ? "Obra contratada (SIGOV)" : "Sin datos del ejecutor"}
                    </p>
                  </td>
                  <td className="px-4 py-2.5"><Avance estado={iv.estado} /></td>
                  <td className="px-4 py-2.5">
                    {iv.superficieM2 != null ? (
                      <div className="w-24">
                        <span className="num text-[13px] font-semibold">{numero(Math.round(iv.superficieM2))} m²</span>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-3">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(4, (100 * iv.superficieM2) / maxM2)}%`, background: C.hecho }} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-texto-3">—</span>
                    )}
                  </td>
                  <td className="num px-4 py-2.5 text-texto-2">
                    {iv.estado === "finalizada" ? fechaCorta(iv.finalizadaEn) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/incidentes/${iv.incidenteId}`}
                      className="text-xs font-semibold whitespace-nowrap text-celeste hover:underline"
                      title="Ver la historia completa del problema: qué se pidió, qué se hizo y en qué quedó"
                    >
                      Ver historia →
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <VerEnMapa lat={iv.lat} lon={iv.lon} etiqueta={iv.direccion ?? `Intervención #${iv.id}`} color="#199e70" />
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-texto-3">
                  Sin trabajos con estos filtros. Probá limpiarlos.
                </td>
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

function urlPagina(filtros: { estado?: string; ejecutor?: string; q?: string }, pagina: number): string {
  const p = new URLSearchParams();
  if (filtros.estado) p.set("estado", filtros.estado);
  if (filtros.ejecutor) p.set("ejecutor", filtros.ejecutor);
  if (filtros.q) p.set("q", filtros.q);
  p.set("pagina", String(pagina));
  return `/intervenciones?${p.toString()}`;
}

/** El recorrido asignada → en curso → finalizada como tres puntos conectados. */
function Avance({ estado }: { estado: string }) {
  if (estado === "anulada") {
    return <span className="rounded-md bg-panel-3 px-2 py-0.5 text-[11px] text-texto-3 line-through">Anulada</span>;
  }
  const pasos = ["asignada", "en_curso", "finalizada"] as const;
  const idx = pasos.indexOf(estado as (typeof pasos)[number]);
  const colores = ["#f4dc00", C.curso, C.hecho];
  const color = colores[idx] ?? "#8b94a3";
  return (
    <div title={`${ETIQUETA[estado] ?? estado}: asignada → en curso → finalizada`}>
      <div className="flex items-center">
        {pasos.map((p, i) => (
          <span key={p} className="flex items-center">
            {i > 0 && <span className={`h-px w-3 ${i <= idx ? "" : "bg-borde-2"}`} style={i <= idx ? { background: color } : undefined} />}
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${i <= idx ? "" : "border border-borde-2 bg-transparent"}`}
              style={i <= idx ? { background: color } : undefined}
            />
          </span>
        ))}
      </div>
      <p className="mt-1 text-[10px] font-semibold" style={{ color }}>{ETIQUETA[estado] ?? estado}</p>
    </div>
  );
}

function Cifra({ n, etiqueta, color, nota }: { n: number; etiqueta: string; color: string; nota?: string }) {
  return (
    <div className="panel-vidrio rounded-xl px-3.5 py-3">
      <div className="num text-2xl font-extrabold" style={{ color }}>{numero(n)}</div>
      <p className="text-[11px] leading-tight text-texto-2">{etiqueta}</p>
      {nota && <p className="mt-0.5 text-[10px] text-texto-3">{nota}</p>}
    </div>
  );
}

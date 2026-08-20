import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { listarEjecutores, listarIntervenciones } from "@/lib/consultas";
import { fechaCorta, numero } from "@/lib/formato";
import { Chip, Panel, TituloPagina } from "@/components/ui";

export const dynamic = "force-dynamic";

const ETIQUETA: Record<string, string> = {
  asignada: "Asignada",
  en_curso: "En curso",
  finalizada: "Finalizada",
  anulada: "Anulada",
};

export default async function PaginaIntervenciones({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; ejecutor?: string; pagina?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const pagina = Math.max(1, Number(filtros.pagina ?? 1) || 1);
  const [{ filas, total }, ejecutores] = await Promise.all([
    listarIntervenciones(sesion, { estado: filtros.estado, ejecutor: filtros.ejecutor, pagina, limite: 50 }),
    listarEjecutores(sesion),
  ]);
  const paginas = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Intervenciones"
        sub={`${numero(total)} trabajos · cuadrillas municipales y obras contratadas (SIGOV)`}
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/intervenciones" method="get">
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
      </form>

      <Panel className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Incidente</th>
              <th className="px-4 py-3">Dirección</th>
              <th className="px-4 py-3">Ejecutor</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">m²</th>
              <th className="px-4 py-3">Fotos</th>
              <th className="px-4 py-3">Fin</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((iv) => {
              const contratista = (iv.metadata.contratista as string) ?? null;
              return (
                <tr key={iv.id} className="border-b border-borde/60 transition hover:bg-panel-2">
                  <td className="num px-4 py-2.5 text-texto-3">{iv.id}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/incidentes?foco=${iv.incidenteId}`} className="num text-celeste hover:underline">
                      #{iv.incidenteId}
                    </Link>
                  </td>
                  <td className="max-w-56 truncate px-4 py-2.5" title={iv.direccion ?? ""}>{iv.direccion ?? "—"}</td>
                  <td className="max-w-44 truncate px-4 py-2.5 text-texto-2" title={contratista ?? iv.cuadrilla ?? ""}>
                    {iv.cuadrilla ?? contratista ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip tono={iv.estado === "finalizada" ? "celeste" : iv.estado === "en_curso" ? "amarillo" : "neutro"}>
                      {ETIQUETA[iv.estado] ?? iv.estado}
                    </Chip>
                  </td>
                  <td className="num px-4 py-2.5">{iv.superficieM2 != null ? numero(Math.round(iv.superficieM2)) : "—"}</td>
                  <td className="num px-4 py-2.5">{iv.fotos > 0 ? `📷 ${iv.fotos}` : "—"}</td>
                  <td className="num px-4 py-2.5 text-texto-2">{fechaCorta(iv.finalizadaEn)}</td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-texto-3">Sin intervenciones.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      {paginas > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {pagina > 1 && (
            <Link className="text-celeste hover:underline" href={`/intervenciones?pagina=${pagina - 1}`}>← Anterior</Link>
          )}
          <span className="num text-texto-3">{pagina} / {paginas}</span>
          {pagina < paginas && (
            <Link className="text-celeste hover:underline" href={`/intervenciones?pagina=${pagina + 1}`}>Siguiente →</Link>
          )}
        </div>
      )}
    </div>
  );
}

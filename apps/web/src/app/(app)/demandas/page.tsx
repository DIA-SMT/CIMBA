import Link from "next/link";
import { FUENTES_DEMANDA, ESTADOS_DEMANDA } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { listarDemandas } from "@/lib/consultas";
import { ETIQUETA_ESTADO_DEMANDA, ETIQUETA_FUENTE, fechaCorta, numero } from "@/lib/formato";
import { BadgeEstadoDemanda, BadgeFuente, BadgeTipo, BarraConfianza, Panel, TituloPagina } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PaginaDemandas({
  searchParams,
}: {
  searchParams: Promise<{ fuente?: string; estado?: string; q?: string; pagina?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const pagina = Math.max(1, Number(filtros.pagina ?? 1) || 1);
  const { filas, total } = await listarDemandas(sesion, { ...filtros, pagina, limite: 50 });
  const paginas = Math.max(1, Math.ceil(total / 50));

  const link = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const estado = { ...filtros, pagina: undefined, ...cambios };
    for (const [k, v] of Object.entries(estado)) if (v) p.set(k, v);
    return `/demandas?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Bandeja de demandas"
        sub={`${numero(total)} demandas · todas las fuentes en un solo lugar`}
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/demandas" method="get">
        <select name="fuente" defaultValue={filtros.fuente ?? ""} className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
          <option value="">Todas las fuentes</option>
          {FUENTES_DEMANDA.map((f) => (
            <option key={f} value={f}>{ETIQUETA_FUENTE[f]}</option>
          ))}
        </select>
        <select name="estado" defaultValue={filtros.estado ?? ""} className="rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm">
          <option value="">Todos los estados</option>
          {ESTADOS_DEMANDA.map((e) => (
            <option key={e} value={e}>{ETIQUETA_ESTADO_DEMANDA[e]}</option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={filtros.q ?? ""}
          placeholder="Buscar dirección o texto…"
          className="w-64 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
        />
        <button className="rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110">
          Filtrar
        </button>
        {(filtros.fuente || filtros.estado || filtros.q) && (
          <Link href="/demandas" className="text-sm text-texto-2 hover:text-texto">Limpiar</Link>
        )}
      </form>

      <Panel className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Fuente</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Dirección</th>
              <th className="px-4 py-3">Geocod.</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filas.map((d) => (
              <tr key={d.id} className="border-b border-borde/60 transition hover:bg-panel-2">
                <td className="num px-4 py-2.5 text-texto-3">{d.id}</td>
                <td className="px-4 py-2.5"><BadgeFuente fuente={d.fuente} /></td>
                <td className="px-4 py-2.5"><BadgeTipo tipo={d.tipo} /></td>
                <td className="max-w-64 truncate px-4 py-2.5" title={d.direccion ?? ""}>{d.direccion ?? "—"}</td>
                <td className="px-4 py-2.5"><BarraConfianza valor={d.geocodConfianza} /></td>
                <td className="px-4 py-2.5"><BadgeEstadoDemanda estado={d.estado} /></td>
                <td className="num px-4 py-2.5 text-texto-2">{fechaCorta(d.creadoEn)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/demandas/${d.id}`} className="font-semibold text-celeste hover:underline">
                    Revisar →
                  </Link>
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-texto-3">
                  No hay demandas con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      {paginas > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          {pagina > 1 && <Link className="text-celeste hover:underline" href={link({ pagina: String(pagina - 1) })}>← Anterior</Link>}
          <span className="num text-texto-3">{pagina} / {paginas}</span>
          {pagina < paginas && <Link className="text-celeste hover:underline" href={link({ pagina: String(pagina + 1) })}>Siguiente →</Link>}
        </div>
      )}
    </div>
  );
}

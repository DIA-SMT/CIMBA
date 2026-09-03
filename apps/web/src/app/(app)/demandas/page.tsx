import Link from "next/link";
import { FUENTES_DEMANDA, ESTADOS_DEMANDA, type FuenteDemanda } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { listarDemandas, resumenDemandas } from "@/lib/consultas";
import { ETIQUETA_ESTADO_DEMANDA, ETIQUETA_FUENTE, fechaCorta, numero } from "@/lib/formato";
import { CadenaFlujo } from "@/components/cadena-flujo";
import { BadgeEstadoDemanda, BadgeFuente, BadgeTipo, BarraConfianza, Panel, TituloPagina } from "@/components/ui";
import { VerEnMapa } from "@/components/mapa/ver-en-mapa";
import { BusquedaNatural } from "@/components/busqueda-natural";

export const dynamic = "force-dynamic";

/**
 * demandas.destino (enum destino_resolucion): quién resuelve cada pedido.
 * Etiquetas y colores locales — formato.ts no se toca en esta tarea; los
 * colores son tokens del tema, así flipean solos en claro/oscuro.
 */
const DESTINOS = [
  ["bacheo", "Bacheo", "var(--color-abierto)", "Lo resuelven las cuadrillas y empresas de bacheo"],
  ["sat", "SAT (Aguas)", "var(--color-celeste)", "Pérdidas de agua, tapas y sumideros: los resuelve la SAT"],
  ["ingenieria", "Ingeniería (ripio)", "var(--color-amarillo)", "Calles de ripio: pasado de máquina de Ingeniería"],
] as const;

export default async function PaginaDemandas({
  searchParams,
}: {
  searchParams: Promise<{ fuente?: string; estado?: string; destino?: string; q?: string; calidad?: string; mes?: string; pagina?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const pagina = Math.max(1, Number(filtros.pagina ?? 1) || 1);
  const [{ filas, total }, resumen] = await Promise.all([
    listarDemandas(sesion, { ...filtros, pagina, limite: 50 }),
    resumenDemandas(sesion),
  ]);
  const ETIQUETA_CALIDAD: Record<string, string> = {
    geocod_baja: "geocodificación imprecisa",
    sin_ubicacion: "sin ubicación",
    sin_fecha: "sin fecha de origen",
    antiguas: "antiguas (> 1 año)",
  };
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
        titulo="Bandeja de demandas: todo lo que se pide"
        sub="Cada fila es un pedido de un vecino o institución. El trabajo acá es revisarlos y vincularlos a un problema real del territorio."
      />

      <CadenaFlujo actual={1} />

      {/* La bandeja en números: cada estado y cada fuente es un filtro de un clic */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Link
          href="/demandas"
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${!filtros.estado && !filtros.fuente && !filtros.destino ? "border-celeste/60 bg-celeste/10 text-celeste" : "border-borde-2 text-texto-2 hover:border-celeste/50 hover:text-texto"}`}
        >
          Todas <span className="num">{numero(resumen.total)}</span>
        </Link>
        {(
          [
            ["recibida", "#3987e5", "Llegaron y nadie las revisó todavía: acá está el trabajo pendiente"],
            ["en_validacion", "var(--color-amarillo)", "Alguien las está revisando o esperan un dato"],
            ["vinculada", "#199e70", "Ya cotejadas: apuntan a un problema real del territorio"],
            ["cerrada", "#199e70", "Circuito completo: el problema se reparó y se le respondió al vecino"],
            ["descartada", "#6b7280", "Revisadas y descartadas con motivo"],
            ["fuera_de_alcance", "#6b7280", "No corresponden a bacheo (otra área)"],
          ] as const
        ).map(([e, color, ayuda]) => {
          const n = resumen.porEstado[e] ?? 0;
          if (n === 0) return null;
          return (
            <Link
              key={e}
              href={link({ estado: e })}
              title={ayuda}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${filtros.estado === e ? "border-borde-2 bg-panel-2 text-texto" : "border-borde text-texto-2 hover:border-borde-2 hover:text-texto"}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {ETIQUETA_ESTADO_DEMANDA[e]} <span className="num text-texto-3">{numero(n)}</span>
            </Link>
          );
        })}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Quién pide:</span>
        {resumen.porFuente.map(({ fuente, n }) => (
          <Link
            key={fuente}
            href={link({ fuente })}
            title={`Ver solo los pedidos de ${ETIQUETA_FUENTE[fuente as FuenteDemanda] ?? fuente}`}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${filtros.fuente === fuente ? "border-celeste/60 bg-celeste/10 text-celeste" : "border-borde text-texto-2 hover:border-borde-2 hover:text-texto"}`}
          >
            {ETIQUETA_FUENTE[fuente as FuenteDemanda] ?? fuente} <span className="num text-texto-3">{numero(n)}</span>
          </Link>
        ))}
      </div>
      {/* Salido de la reunión con el Director: separar lo que es de bacheo de lo
          que resuelven la SAT (agua) o Ingeniería (ripio). Cada chip filtra y se
          des-filtra con otro clic. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">¿Quién lo resuelve?</span>
        {DESTINOS.map(([clave, etiqueta, color, ayuda]) => {
          const n = resumen.porDestino[clave] ?? 0;
          if (n === 0) return null;
          const activo = filtros.destino === clave;
          return (
            <Link
              key={clave}
              href={link({ destino: activo ? undefined : clave })}
              title={ayuda}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${activo ? "border-borde-2 bg-panel-2 font-semibold text-texto" : "border-borde text-texto-2 hover:border-borde-2 hover:text-texto"}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {etiqueta} <span className="num text-texto-3">{numero(n)}</span>
            </Link>
          );
        })}
      </div>

      {filtros.mes && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-celeste/40 bg-celeste/10 px-4 py-2.5 text-sm">
          <span>Mostrando pedidos ingresados en <b className="num">{filtros.mes}</b></span>
          <Link href="/demandas" className="text-celeste hover:underline">Quitar</Link>
          <Link href="/brecha" className="ml-auto text-texto-3 hover:text-texto">← Volver a Brecha</Link>
        </div>
      )}

      {filtros.calidad && ETIQUETA_CALIDAD[filtros.calidad] && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amarillo/40 bg-amarillo/10 px-4 py-2.5 text-sm">
          <span>
            Filtro de calidad activo: <b>{ETIQUETA_CALIDAD[filtros.calidad]}</b>
          </span>
          <Link href="/demandas" className="text-celeste hover:underline">Quitar</Link>
          <Link href="/calidad" className="ml-auto text-texto-3 hover:text-texto">← Volver a Calidad</Link>
        </div>
      )}

      <BusquedaNatural
        destino="demandas"
        ejemplo="lo que pidió el concejo en barrio norte"
        inicial={filtros.q ?? ""}
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/demandas" method="get">
        {/* El filtro de destino vive en los chips: se preserva al re-filtrar por acá */}
        {filtros.destino && <input type="hidden" name="destino" value={filtros.destino} />}
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
        {(filtros.fuente || filtros.estado || filtros.destino || filtros.q) && (
          <Link href="/demandas" className="text-sm text-texto-2 hover:text-texto">Limpiar</Link>
        )}
        <a
          href={`/api/exportar?entidad=demandas&${new URLSearchParams(
            Object.fromEntries(
              Object.entries({
                fuente: filtros.fuente,
                estado: filtros.estado,
                destino: filtros.destino,
                q: filtros.q,
                calidad: filtros.calidad,
                mes: filtros.mes,
              }).filter(([, v]) => v),
            ) as Record<string, string>,
          ).toString()}`}
          className="ml-auto text-xs font-semibold text-celeste hover:underline"
          title="Descargar lo filtrado como CSV (Excel, PowerBI, QGIS) — sin datos de contacto"
        >
          ⤓ CSV
        </a>
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
                <td className="px-4 py-2.5">
                  <BadgeTipo tipo={d.tipo} />
                  {/* Quién lo resuelve, en chico y con su color, debajo del tipo */}
                  {d.destino && (
                    <span
                      className="mt-0.5 block text-[10px] font-semibold"
                      style={{ color: DESTINOS.find(([clave]) => clave === d.destino)?.[2] }}
                    >
                      {DESTINOS.find(([clave]) => clave === d.destino)?.[1] ?? d.destino}
                    </span>
                  )}
                </td>
                <td className="max-w-64 truncate px-4 py-2.5" title={d.direccion ?? ""}>{d.direccion ?? "—"}</td>
                <td className="px-4 py-2.5"><BarraConfianza valor={d.geocodConfianza} /></td>
                <td className="px-4 py-2.5"><BadgeEstadoDemanda estado={d.estado} /></td>
                <td className="num px-4 py-2.5 text-texto-2">{fechaCorta(d.creadoEn)}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <VerEnMapa lat={d.lat} lon={d.lon} etiqueta={d.direccion ?? `Demanda #${d.id}`} color="#8fa3bf" />
                    <Link href={`/demandas/${d.id}`} className="font-semibold text-celeste hover:underline">
                      Revisar →
                    </Link>
                  </div>
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

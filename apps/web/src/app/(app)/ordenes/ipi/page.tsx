import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { CORTES_ESTADO, NIVEL_IPI, gradoEstado, nombreCorredor, rankingIpi } from "@/lib/ipi";
import { fechaCorta, numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { BotonRecalcularIpi } from "./boton-recalcular";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * El ranking IPI: la metodología oficial del municipio, calculada con los
 * datos de la operación. No es un score de CIMBA — es el mismo índice con el
 * que se arma el Plan de Obras, y por eso cada puntaje muestra de dónde sale.
 */
export default async function PaginaIpi({
  searchParams,
}: {
  searchParams: Promise<{ sector?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const sp = await searchParams;
  const corredores = await rankingIpi(sesion);
  const puedeRecalcular = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";

  const sectores = [...new Set(corredores.map((c) => c.sector).filter(Boolean))].sort((a, b) =>
    (a ?? "").localeCompare(b ?? "", "es", { numeric: true }),
  );
  const sectorFoco = sp.sector && sectores.includes(sp.sector) ? sp.sector : (sectores[0] ?? null);
  const delSector = corredores.filter((c) => c.sector === sectorFoco);
  const calculado = corredores.find((c) => c.calculadoEn)?.calculadoEn ?? null;
  const sinCalcular = corredores.filter((c) => c.ipi == null).length;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link href="/ordenes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto">
        <ArrowLeft size={15} /> Órdenes
      </Link>
      <TituloPagina
        titulo="Prioridad de corredores (IPI)"
        sub="El índice oficial del municipio, calculado con lo que pasa en la calle. Ordena qué corredor se interviene primero dentro de cada sector."
        extra={puedeRecalcular ? <BotonRecalcularIpi /> : undefined}
      />

      <Panel className="mb-5 p-4 text-[13px] leading-relaxed text-texto-2">
        <b className="text-texto">Cómo se lee.</b> Cada corredor recibe un puntaje de 0 a 100 que combina seis
        variables con distinto peso según su jerarquía: en un eje de <b>interconexión urbana</b> pesa más
        conectar barrios (35%) que el estado del pavimento (20%); en una <b>calle barrial</b> es al revés
        (40% estado). El ranking se compara <b>dentro de cada sector y dentro de cada nivel</b> — nunca un
        sector contra otro, porque cada uno ya tiene su cupo de obra licitado.
        <span className="mt-2 block">
          <b className="text-texto">Lo que aporta CIMBA.</b> La metodología pide reemplazar la apreciación
          cualitativa del estado por una medición: acá el <b>Estado</b> sale de la densidad de patologías por
          kilómetro de los últimos 24 meses —lo reparado más lo que sigue pendiente—, con los cortes
          bueno &lt;{CORTES_ESTADO.bueno}, regular &lt;{CORTES_ESTADO.regular}, malo &lt;{CORTES_ESTADO.malo}, crítico de ahí
          en más. Es lo único que ninguna planilla puede calcular sola.
        </span>
        <span className="mt-2 block text-texto-3">
          Falta la capa de <b>equipamientos urbanos</b> (escuelas, centros de salud y edificios públicos a
          150 m): mientras no esté, esa variable no puntúa y los pesos se reparten entre las demás, para que
          el índice siga siendo comparable con el que calcula la Subsecretaría a mano. Hay que pedírsela a la
          DOV. La <b>factibilidad</b> arranca en «sin interferencias» hasta que alguien registre lo contrario.
        </span>
      </Panel>

      {corredores.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-texto-3">
          Todavía no hay corredores cargados. Se construyen con{" "}
          <code className="rounded bg-panel-3 px-1 text-xs">node scripts/cargar-corredores.mjs</code>.
        </Panel>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {sectores.map((s) => (
              <Link
                key={s}
                href={`/ordenes/ipi?sector=${encodeURIComponent(s ?? "")}`}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  s === sectorFoco
                    ? "border-azul bg-azul text-white"
                    : "border-borde-2 text-texto-2 hover:border-celeste/50 hover:text-celeste"
                }`}
              >
                {s}
              </Link>
            ))}
            <span className="ml-auto text-[11px] text-texto-3">
              {calculado ? `calculado ${fechaCorta(calculado)}` : "sin calcular todavía"}
              {sinCalcular > 0 && ` · ${numero(sinCalcular)} corredores sin puntaje`}
            </span>
          </div>

          {[1, 2, 3].map((nivel) => {
            const delNivel = delSector.filter((c) => c.nivel === nivel);
            if (delNivel.length === 0) return null;
            return (
              <Panel key={nivel} className="mb-4 overflow-x-auto p-0">
                <div className="px-5 pt-4 pb-2">
                  <p className="text-sm font-bold">
                    Nivel {nivel} — {NIVEL_IPI[nivel as 1 | 2 | 3]}
                    <span className="ml-2 text-[11px] font-normal text-texto-3">
                      {numero(delNivel.length)} corredores · se interviene en este orden
                    </span>
                  </p>
                </div>
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
                      <th className="px-5 py-2">#</th>
                      <th className="px-3 py-2">Corredor</th>
                      <th className="px-3 py-2 text-right">IPI</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2 text-right" title="Patologías por km en 24 meses: reparadas + pendientes">
                        Patol./km
                      </th>
                      <th className="px-3 py-2 text-right">Barrios</th>
                      <th className="px-3 py-2 text-center" title="Pasa transporte público">TP</th>
                      <th className="px-3 py-2 text-right">Largo</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {delNivel.map((c, i) => (
                      <tr key={c.id} className={`border-b border-borde/60 ${c.excluido ? "opacity-45" : ""}`}>
                        <td className="num px-5 py-2.5 text-texto-3">{c.excluido ? "—" : i + 1}</td>
                        <td className="px-3 py-2.5 font-semibold">
                          {nombreCorredor(c.nombre)}
                          {c.compromiso && (
                            <span className="ml-2 rounded bg-amarillo/15 px-1.5 py-0.5 text-[10px] font-bold text-amarillo">
                              COMPROMISO
                            </span>
                          )}
                          {c.excluido && (
                            <span className="ml-2 text-[10px] font-bold text-texto-3">NO FACTIBLE</span>
                          )}
                        </td>
                        <td className="num px-3 py-2.5 text-right text-base font-bold">
                          {c.ipi != null ? c.ipi.toFixed(1) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className="text-xs font-semibold"
                            style={{
                              color:
                                c.vEstado == null
                                  ? "var(--color-texto-3)"
                                  : c.vEstado >= 100
                                    ? "var(--color-sin-atencion)"
                                    : c.vEstado >= 75
                                      ? "var(--color-en-cola)"
                                      : c.vEstado >= 25
                                        ? "var(--color-en-obra)"
                                        : "var(--color-hecho)",
                            }}
                          >
                            {gradoEstado(c.vEstado)}
                          </span>
                        </td>
                        <td className="num px-3 py-2.5 text-right" title={`${numero(c.baches24m ?? 0)} patologías en 24 meses`}>
                          {c.densidadKm != null ? c.densidadKm.toFixed(1) : "—"}
                        </td>
                        <td className="num px-3 py-2.5 text-right">{c.barriosConectados ?? "—"}</td>
                        <td className="px-3 py-2.5 text-center text-xs">{c.tieneTransporte ? "sí" : "—"}</td>
                        <td className="num px-3 py-2.5 text-right text-texto-2">
                          {(c.longitudM / 1000).toFixed(1)} km
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <Link
                            href={`/mapa?buscar=${encodeURIComponent(nombreCorredor(c.nombre))}`}
                            className="text-xs font-semibold text-celeste hover:underline"
                          >
                            ver →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })}
        </>
      )}
    </div>
  );
}

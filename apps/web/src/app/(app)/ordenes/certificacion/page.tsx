import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import {
  REGIMEN,
  VENTANA_INSPECCION,
  conteoInspecciones,
  inspeccionesPendientes,
  listarActas,
  regimenPorEmpresa,
} from "@/lib/certificacion";
import { fechaCorta, numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { FilaInspeccion } from "./fila-inspeccion";
import { PanelTabla } from "@/components/tabla-deslizable";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ETIQUETA_MOMENTO: Record<string, string> = {
  "24h": "A las 24 horas",
  "30d": "A los 30 días",
  "90d": "A los 90 días (muestra 10%)",
  "6m": "A los 6 meses (muestra 10%)",
};

/**
 * Certificación: lo que hay que inspeccionar hoy y qué se puede pagar.
 * Sin acta de medición conjunta firmada, lo que informa la contratista no se
 * certifica — y las actas son la pieza que protege a la administración frente
 * al Tribunal de Cuentas.
 */
export default async function PaginaCertificacion() {
  const sesion = (await leerSesion())!;
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-sm text-texto-3">
        Esta pantalla es del cuerpo de inspectores y de planificación.
      </div>
    );
  }
  const puedeInspeccionar = ["admin", "planificacion", "supervision"].includes(sesion.rol_cimba);

  const [pendientes, totales, regimenes, actas] = await Promise.all([
    inspeccionesPendientes(sesion),
    conteoInspecciones(sesion),
    regimenPorEmpresa(sesion),
    listarActas(sesion),
  ]);

  const porMomento = (["24h", "30d", "90d", "6m"] as const).map((m) => ({
    momento: m,
    lista: pendientes.filter((p) => p.momento === m),
  }));
  const conDeuda = regimenes.filter((r) => r.itemsSinCertificar > 0);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link href="/ordenes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto">
        <ArrowLeft size={15} /> Órdenes
      </Link>
      <TituloPagina
        titulo="Certificación y control de calidad"
        sub="Qué hay que ir a mirar hoy, y qué está en condiciones de pagarse. Los dos regímenes del protocolo de la Dirección de Obras Viales."
      />

      {/* ── Qué se puede pagar ─────────────────────────────────────────── */}
      <Panel className="mb-5 p-4 text-[13px] leading-relaxed text-texto-2">
        <b className="text-texto">La regla del pago.</b> Sin acta de medición conjunta firmada, los metros
        que informa la contratista <b>no se certifican</b>. Se mide el <b>100% de los puntos las primeras{" "}
        {REGIMEN.semanasMedicionTotal} semanas</b>; después alcanza con un muestreo aleatorio de al menos el{" "}
        <b>{REGIMEN.muestreoMinimoPct}%</b>; y si aparece <b>más de {REGIMEN.desviacionQueObligaTotal}% de
        desviación</b> entre lo informado y lo medido, se vuelve a medir todo.
      </Panel>

      <PanelTabla className="mb-6 p-0">
        <div className="px-5 pt-4 pb-2">
          <p className="text-sm font-bold">
            Pendiente de certificar
            <span className="ml-2 text-[11px] font-normal text-texto-3">
              trabajo cargado, con foto y medidas, que todavía no pasó por acta
            </span>
          </p>
        </div>
        {conDeuda.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-texto-3">
            No hay trabajo pendiente de certificar: todo lo reportado ya tiene acta.
          </p>
        ) : (
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
                <th className="px-5 py-2">Ejecutor</th>
                <th className="px-3 py-2">Régimen de medición</th>
                <th className="px-3 py-2 text-right">Puntos</th>
                <th className="px-3 py-2 text-right">m²</th>
                <th className="px-5 py-2">Última acta</th>
              </tr>
            </thead>
            <tbody>
              {conDeuda.map((r) => (
                <tr key={r.empresaId} className="border-b border-borde/60">
                  <td className="px-5 py-2.5 font-semibold">{r.empresa}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="text-xs font-bold"
                      style={{ color: r.modalidad === "total" ? "var(--color-en-cola)" : "var(--color-hecho)" }}
                    >
                      {r.modalidad === "total" ? "MEDICIÓN TOTAL" : "MUESTREO"}
                    </span>
                    <span className="block text-[11px] leading-snug text-texto-3">{r.motivo}</span>
                  </td>
                  <td className="num px-3 py-2.5 text-right font-bold">{numero(r.itemsSinCertificar)}</td>
                  <td className="num px-3 py-2.5 text-right">{numero(Math.round(r.m2SinCertificar))}</td>
                  <td className="px-5 py-2.5 text-[12px] text-texto-2">
                    {r.ultimaActa ? fechaCorta(r.ultimaActa) : "—"}
                    {r.ultimaDesviacion != null && (
                      <span
                        className="block text-[11px]"
                        style={{
                          color: r.ultimaDesviacion > REGIMEN.desviacionQueObligaTotal
                            ? "var(--color-sin-atencion)"
                            : "var(--color-texto-3)",
                        }}
                      >
                        desvío {r.ultimaDesviacion.toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelTabla>

      {/* ── Qué inspeccionar ───────────────────────────────────────────── */}
      <Panel className="mb-5 p-4 text-[13px] leading-relaxed text-texto-2">
        <b className="text-texto">El control de calidad.</b> Cada reparación se mira cuatro veces: a las
        24 horas y a los 30 días se revisan todas; a los 90 días y a los 6 meses, una muestra del{" "}
        {REGIMEN.muestreoDiferidoPct}% del período. La muestra se sortea por el número de la reparación, así
        es la misma cada vez que se abre la pantalla y cualquiera puede reproducirla. Aplica igual a las
        empresas y a las cuadrillas propias.
      </Panel>

      {pendientes.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-texto-3">
          No hay inspecciones vencidas. Vuelven a aparecer solas cuando las reparaciones cumplan 24 horas,
          30 días, 90 días o 6 meses.
        </Panel>
      ) : (
        porMomento.map(({ momento, lista }) => {
          if (lista.length === 0) return null;
          return (
            <Panel key={momento} className="mb-4 overflow-x-auto p-0">
              <div className="px-5 pt-4 pb-2">
                <p className="text-sm font-bold">
                  {ETIQUETA_MOMENTO[momento]}
                  <span className="ml-2 text-[11px] font-normal text-texto-3">
                    {numero(totales[momento] ?? lista.length)} por mirar · {VENTANA_INSPECCION[momento]?.mira}
                  </span>
                </p>
              </div>
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
                    <th className="px-5 py-2">Dónde</th>
                    <th className="px-3 py-2">Ejecutor</th>
                    <th className="px-3 py-2 text-right">m²</th>
                    <th className="px-3 py-2 text-right">Reparado hace</th>
                    <th className="px-5 py-2 text-right">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.slice(0, 25).map((p) => (
                    <tr key={`${p.intervencionId}-${p.momento}`} className="border-b border-borde/60">
                      <td className="px-5 py-2.5">
                        <span className="font-semibold">{p.direccion ?? `Reparación #${p.intervencionId}`}</span>
                        {p.lat != null && p.lon != null && (
                          <Link
                            href={`/mapa?lat=${p.lat}&lon=${p.lon}&z=18`}
                            className="ml-2 text-[11px] font-semibold text-celeste hover:underline"
                          >
                            ver en el mapa
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-texto-2">{p.ejecutor ?? "—"}</td>
                      <td className="num px-3 py-2.5 text-right">{p.superficieM2 ?? "—"}</td>
                      <td className="num px-3 py-2.5 text-right text-texto-2">{numero(p.diasDesde)} días</td>
                      <td className="px-5 py-2.5 text-right">
                        {puedeInspeccionar ? (
                          <FilaInspeccion intervencionId={p.intervencionId} momento={p.momento} />
                        ) : (
                          <span className="text-[11px] text-texto-3">solo inspectores</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lista.length > 25 && (
                <p className="px-5 py-3 text-[11px] text-texto-3">
                  Se muestran las 25 más viejas de {numero(totales[momento] ?? lista.length)}.
                </p>
              )}
            </Panel>
          );
        })
      )}

      {/* ── Actas ──────────────────────────────────────────────────────── */}
      {actas.length > 0 && (
        <PanelTabla className="mt-6 p-0">
          <div className="px-5 pt-4 pb-2">
            <p className="text-sm font-bold">Actas de medición conjunta</p>
          </div>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
                <th className="px-5 py-2">Acta</th>
                <th className="px-3 py-2">Ejecutor</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Modalidad</th>
                <th className="px-3 py-2 text-right">Puntos</th>
                <th className="px-3 py-2 text-right">m² informados</th>
                <th className="px-3 py-2 text-right">m² medidos</th>
                <th className="px-5 py-2 text-right">Desvío</th>
              </tr>
            </thead>
            <tbody>
              {actas.map((a) => (
                <tr key={a.id} className="border-b border-borde/60">
                  <td className="px-5 py-2.5 font-semibold">{a.numero}</td>
                  <td className="px-3 py-2.5">{a.empresa}</td>
                  <td className="px-3 py-2.5 text-texto-2">{fechaCorta(a.fecha)}</td>
                  <td className="px-3 py-2.5 text-[11px] tracking-wide text-texto-3 uppercase">{a.modalidad}</td>
                  <td className="num px-3 py-2.5 text-right">{numero(a.puntosInformados)}</td>
                  <td className="num px-3 py-2.5 text-right">{numero(Math.round(a.m2Informados))}</td>
                  <td className="num px-3 py-2.5 text-right">{numero(Math.round(a.m2Medidos))}</td>
                  <td
                    className="num px-5 py-2.5 text-right font-bold"
                    style={{
                      color: (a.desviacionPct ?? 0) > REGIMEN.desviacionQueObligaTotal
                        ? "var(--color-sin-atencion)"
                        : "var(--color-hecho)",
                    }}
                  >
                    {a.desviacionPct != null ? `${a.desviacionPct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelTabla>
      )}
    </div>
  );
}

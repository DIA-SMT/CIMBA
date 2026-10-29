import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { obtenerActa } from "@/lib/certificacion";
import { fechaCorta, numero } from "@/lib/formato";
import { BotonImprimir } from "./boton-imprimir";

export const dynamic = "force-dynamic";

/**
 * EL ACTA FIRMADA, para imprimir y firmar en papel. El sistema registra la
 * firma; no la reemplaza: lo que respalda el pago ante el Tribunal de Cuentas
 * es el papel con las dos firmas, y este es su detalle congelado.
 */
const CSS_IMPRESION = `
@media print {
  @page { margin: 12mm; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > div { display: block !important; height: auto !important; overflow: visible !important; }
  main { overflow: visible !important; }
  header, nav, .no-imprimir { display: none !important; }
  .hoja-acta { color: #000 !important; }
  .hoja-acta * { color: #000 !important; border-color: #555 !important; }
}
`;

export default async function PaginaActa({ params }: { params: Promise<{ id: string }> }) {
  const sesion = (await leerSesion())!;
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) notFound();
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const a = await obtenerActa(sesion, Number(id));
  if (!a) notFound();

  const celda = "border border-borde-2 px-2 py-1.5";
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <style>{CSS_IMPRESION}</style>
      <div className="no-imprimir mb-4 flex items-center justify-between gap-3">
        <Link href="/ordenes/certificacion" className="inline-flex items-center gap-1.5 text-sm text-texto-2 hover:text-texto">
          <ArrowLeft size={15} /> Certificación
        </Link>
        <BotonImprimir numero={a.numero} />
      </div>

      <section className="hoja-acta rounded-xl border border-borde bg-panel p-6 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xl font-extrabold">ACTA DE MEDICIÓN CONJUNTA</p>
            <p className="num text-lg font-bold">{a.numero}</p>
            <p className="text-xs">Dirección de Obras Viales — Municipalidad de San Miguel de Tucumán</p>
          </div>
          <div className="text-right text-xs">
            <p>
              Fecha: <b>{fechaCorta(a.fecha)}</b>
            </p>
            <p>
              Empresa: <b>{a.empresa}</b>
            </p>
            <p>
              Régimen: <b>{a.modalidad === "total" ? "medición total (100%)" : "muestreo aleatorio"}</b>
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed">
          En la fecha, el inspector municipal y el representante de la empresa midieron en conjunto los puntos de
          bacheo que siguen.{" "}
          {a.modalidad === "muestreo"
            ? "Por régimen de muestreo se midió la muestra sorteada por el sistema; los puntos no medidos se certifican por la superficie informada por la empresa."
            : "Por régimen de medición total se midieron todos los puntos."}
        </p>

        <table className="mt-3 w-full border-collapse text-xs">
          <thead>
            <tr className="text-left">
              <th className={celda}>#</th>
              <th className={celda}>Orden</th>
              <th className={celda}>Dirección</th>
              <th className={celda}>Trabajo del</th>
              <th className={`${celda} text-right`}>Informado (m²)</th>
              <th className={`${celda} text-right`}>Medido (m²)</th>
              <th className={`${celda} text-right`}>Se certifica (m²)</th>
            </tr>
          </thead>
          <tbody>
            {a.items.map((i, n) => (
              <tr key={`${i.itemId}-${n}`}>
                <td className={`${celda} num`}>{n + 1}</td>
                <td className={`${celda} num`}>{i.ordenNumero ?? "—"}</td>
                <td className={celda}>{i.direccion ?? "—"}</td>
                <td className={`${celda} num`}>{i.reportadoEn ? fechaCorta(i.reportadoEn) : "—"}</td>
                <td className={`${celda} num text-right`}>{i.m2Informado != null ? numero(i.m2Informado) : "—"}</td>
                <td className={`${celda} num text-right`}>{i.m2Medido != null ? numero(i.m2Medido) : "no sorteado"}</td>
                <td className={`${celda} num text-right font-semibold`}>
                  {numero(i.m2Medido ?? i.m2Informado ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className={celda} colSpan={4}>
                {numero(a.puntosInformados)} puntos · {numero(a.puntosMedidos)} medidos
              </td>
              <td className={`${celda} num text-right`}>{numero(a.m2Informados)}</td>
              <td className={celda} />
              <td className={`${celda} num text-right`}>{numero(a.m2Medidos)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-xs">
          Desviación entre lo informado y lo medido, sobre los puntos medidos:{" "}
          <b>{a.desviacionPct != null ? `${a.desviacionPct.toFixed(1)}%` : "—"}</b>
          {a.desviacionPct != null && a.desviacionPct > 5 && " — supera el 5%: la próxima acta es de medición total."}
        </p>
        {a.observaciones && (
          <p className="mt-2 text-xs">
            <b>Observaciones:</b> {a.observaciones}
          </p>
        )}

        <div className="mt-14 grid grid-cols-2 gap-10 text-center text-xs">
          <div>
            <div className="border-t border-texto-3 pt-1">{a.firmaInspector ?? "—"}</div>
            <p>Inspector municipal</p>
          </div>
          <div>
            <div className="border-t border-texto-3 pt-1">{a.firmaContratista ?? "—"}</div>
            <p>Por {a.empresa}</p>
          </div>
        </div>
        <p className="no-imprimir mt-6 text-[11px] text-texto-3">
          Registrada en CIMBA por {a.creadaPor ?? "—"}
          {a.firmadaEn && ` el ${fechaCorta(a.firmadaEn)}`}.
        </p>
      </section>
    </div>
  );
}

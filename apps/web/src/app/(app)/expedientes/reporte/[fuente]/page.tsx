import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FUENTES_DEMANDA, type FuenteDemanda } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { ETIQUETA_FUENTE, ETIQUETA_TIPO, numero } from "@/lib/formato";
import { ETIQUETA_RENDICION, reporteDeCanal, type EstadoRendicion } from "@/lib/reportes-canal";
import { Panel, TituloPagina } from "@/components/ui";
import { CSS_IMPRESION_NOTA, fechaLarga } from "../../nota-sat";
import { BotonImprimir } from "./boton-imprimir";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * EL REPORTE DE VUELTA AL QUE PIDIÓ.
 *
 * "Reporte para DIE para presentarle a Colmenares. Lo mismo para el Concejo
 * Deliberante y para Atención Ciudadana. Para entregarle a la Doctora reportes
 * individuales" (12/09).
 *
 * Es una rendición, no una derivación: no cambia el estado de nada, solo
 * contesta qué pasó con lo que pidieron. Y contesta completo — los sin atender
 * salen contados igual que los reparados, porque el que lo recibe tiene la
 * lista original y la va a comparar.
 */

/** Los canales que piden y esperan respuesta. El resto (cuadrilla, carga
 *  manual, BachIA) son entradas nuestras: no hay a quién rendirle. */
const CANALES: FuenteDemanda[] = ["hcd", "redes_sociales", "atencion_ciudadana", "secretaria", "sat"];

const COLOR: Record<EstadoRendicion, string> = {
  reparado: "var(--color-hecho)",
  en_curso: "var(--color-en-obra)",
  derivado: "var(--color-celeste)",
  sin_atender: "var(--color-en-cola)",
  descartado: "var(--color-inactivo)",
};

export default async function PaginaReporteCanal({
  params,
}: {
  params: Promise<{ fuente: string }>;
}) {
  const { fuente: crudo } = await params;
  if (!(FUENTES_DEMANDA as readonly string[]).includes(crudo)) notFound();
  const fuente = crudo as FuenteDemanda;
  if (!CANALES.includes(fuente)) notFound();

  const sesion = (await leerSesion())!;
  const r = await reporteDeCanal(sesion, fuente);
  const nombre = ETIQUETA_FUENTE[fuente];

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <style>{CSS_IMPRESION_NOTA}</style>

      <div className="print:hidden">
        <Link
          href="/expedientes"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto"
        >
          <ArrowLeft size={15} /> Expedientes
        </Link>
        <TituloPagina
          titulo={`Reporte a ${nombre}`}
          sub="Qué pidieron por este canal y qué pasó con cada pedido. No cambia nada: es para imprimir y entregar."
          extra={<BotonImprimir />}
        />

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(Object.keys(ETIQUETA_RENDICION) as EstadoRendicion[]).map((e) => (
            <Panel key={e} className="p-3">
              <p className="num text-2xl leading-tight font-extrabold" style={{ color: COLOR[e] }}>
                {numero(r.porEstado[e])}
              </p>
              <p className="text-[12px] font-semibold text-texto-2">{ETIQUETA_RENDICION[e]}</p>
            </Panel>
          ))}
        </div>

        {/**
         * Los del consolidado HCD/DIE entraron sin fecha de origen. Decirlo acá
         * y no esconderlo: si el reporte afirmara "reparado en 12 días" sobre
         * un pedido cuya fecha es la de la carga del archivo, estaría
         * inventando un plazo que nadie midió.
         */}
        {r.sinFecha > 0 && (
          <p className="mb-4 rounded-xl border border-amarillo/40 bg-amarillo/5 px-4 py-3 text-[13px] leading-snug">
            <b className="text-amarillo">{numero(r.sinFecha)} pedidos entraron sin fecha de origen</b>
            <span className="text-texto-2">
              {" "}
              (vinieron en el archivo consolidado, no con fecha propia). Salen listados igual, con la fecha
              en blanco: poner la de la carga del archivo sería inventar un plazo que nadie midió.
            </span>
          </p>
        )}
      </div>

      {/* ══ La hoja que se entrega ══ */}
      <section className="hoja-impresion">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>REPORTE DE GESTIÓN — {nombre.toUpperCase()}</p>
            <p style={{ fontSize: 11, margin: "2px 0 0" }}>
              Dirección de Bacheo — Municipalidad de San Miguel de Tucumán
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <p style={{ margin: 0 }}>{fechaLarga()}</p>
            <p style={{ margin: 0 }}>
              <b>{numero(r.total)}</b> pedidos
            </p>
          </div>
        </div>

        <table style={{ marginTop: 12 }}>
          <tbody>
            <tr>
              {(Object.keys(ETIQUETA_RENDICION) as EstadoRendicion[]).map((e) => (
                <td key={e} style={{ width: "20%" }}>
                  <b>{ETIQUETA_RENDICION[e]}:</b> {numero(r.porEstado[e])}
                </td>
              ))}
            </tr>
            {r.m2 > 0 && (
              <tr>
                <td colSpan={5}>
                  <b>Superficie ejecutada sobre estos pedidos:</b> {numero(r.m2)} m²
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: "4%" }}>#</th>
              <th style={{ width: "10%" }}>Fecha</th>
              <th style={{ width: "34%" }}>Dirección</th>
              <th style={{ width: "16%" }}>Barrio</th>
              <th style={{ width: "14%" }}>Tipo</th>
              <th style={{ width: "22%" }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {r.renglones.map((x, i) => (
              <tr key={x.demandaId}>
                <td>{i + 1}</td>
                <td>{x.fechaPedido ?? "s/f"}</td>
                <td>{x.direccion ?? "—"}</td>
                <td>{x.barrio ?? "—"}</td>
                <td>{x.tipo ? (ETIQUETA_TIPO[x.tipo as keyof typeof ETIQUETA_TIPO] ?? x.tipo) : "—"}</td>
                <td>
                  {ETIQUETA_RENDICION[x.estado]}
                  {x.reparadoEn && <> · {x.reparadoEn}</>}
                  {x.estado === "reparado" && x.superficieM2 != null && <> · {x.superficieM2} m²</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ marginTop: 16, fontSize: 10 }}>
          Los pedidos marcados “s/f” ingresaron sin fecha de origen: vinieron en el archivo consolidado y no
          con fecha propia.
        </p>

        <div style={{ marginTop: 28, display: "flex", gap: 40, fontSize: 11 }}>
          <div style={{ flex: 1, borderTop: "1px solid #555", paddingTop: 4 }}>
            Dirección de Bacheo
            <br />
            Aclaración y fecha
          </div>
          <div style={{ flex: 1, borderTop: "1px solid #555", paddingTop: 4 }}>
            Recibí conforme — {nombre}
            <br />
            Aclaración y fecha
          </div>
        </div>
      </section>
    </div>
  );
}

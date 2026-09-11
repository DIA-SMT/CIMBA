import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { certificacionDeEmpresa } from "@/lib/certificacion-empresa";
import { fechaCorta, numero } from "@/lib/formato";
import { Panel } from "@/components/ui";
import { resolverVistaPortal } from "../vista";

export const dynamic = "force-dynamic";

const m2 = (v: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(v);
/** "1 punto cargado" / "12 puntos cargados": el plural forzado sobre un 1 se
 *  lee como sistema mal hecho, y acá se está hablando de plata. */
const conc = (n: number, singular: string, plural: string) =>
  `${numero(n)} ${n === 1 ? singular : plural}`;

/**
 * "¿Esto se puede cobrar?" — el estado de certificación de la propia empresa.
 *
 * Solo lectura: la empresa ve en qué régimen de medición está, cuánto tiene
 * cargado sin acta y cómo le fue en las actas anteriores. No puede firmar ni
 * cambiar nada — el acta la hace la medición conjunta, no el portal.
 */
export default async function PaginaCertificacionEmpresa({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const vista = await resolverVistaPortal(sesion, await searchParams);
  if (!vista.empresaId) redirect("/empresa");
  const c = await certificacionDeEmpresa(sesion, vista.empresaId);
  if (!c) notFound();
  const sufijoEspejo = vista.esVistaEspejo ? `?empresa=${vista.empresaId}` : "";

  return (
    <div className="mx-auto max-w-xl p-4 pb-16">
      <Link
        href={`/empresa${sufijoEspejo}`}
        className="inline-flex min-h-12 items-center text-sm font-medium text-texto-2 hover:text-texto"
      >
        ← Mis órdenes
      </Link>

      <h1 className="mb-1 text-2xl font-bold tracking-tight">Mi certificación</h1>
      <p className="mb-4 text-sm leading-relaxed text-texto-2">
        Sin acta de medición conjunta firmada, lo informado <b>no se certifica a los fines del pago</b>.
        Acá está en qué régimen están y qué falta medir.
      </p>

      {/* El régimen manda sobre todo lo demás: define cuánto se mide. */}
      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-1 text-[11px] font-bold ${
              c.modalidad === "total" ? "bg-amarillo/15 text-amarillo" : "bg-resuelto/15 text-resuelto"
            }`}
          >
            {c.modalidad === "total" ? "MEDICIÓN TOTAL" : "MUESTREO"}
          </span>
          {c.ultimaActa && (
            <span className="text-xs text-texto-3">última acta {fechaCorta(c.ultimaActa)}</span>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-texto-2">{c.motivo}</p>
      </Panel>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Cifra
          valor={m2(c.sinCertificar.m2)}
          unidad="m² sin certificar"
          detalle={`${conc(c.sinCertificar.items, "punto cargado", "puntos cargados")} que ${c.sinCertificar.items === 1 ? "todavía no entró" : "todavía no entraron"} en un acta`}
          color="var(--color-en-cola)"
        />
        <Cifra
          valor={m2(c.certificado.m2)}
          unidad="m² ya en acta"
          detalle={conc(c.certificado.items, "punto medido y certificado", "puntos medidos y certificados")}
          color="var(--color-resuelto)"
        />
        <Cifra
          valor={m2(c.ultimos30.m2)}
          unidad="m² en 30 días"
          detalle={`${conc(c.ultimos30.items, "punto cargado", "puntos cargados")} en el último mes`}
          color="var(--color-celeste)"
        />
        <Cifra
          valor={m2(c.sinOrden.m2)}
          unidad="m² sin orden"
          detalle={`${conc(c.sinOrden.items, "trabajo cargado", "trabajos cargados")} sin orden previa: ${c.sinOrden.items === 1 ? "se mira" : "se miran"} aparte`}
          color="var(--color-texto-2)"
        />
      </div>

      <h2 className="mt-6 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
        Actas de medición
      </h2>
      {c.actas.length === 0 ? (
        <p className="rounded-xl border border-borde bg-panel px-4 py-8 text-center text-sm text-texto-2">
          Todavía no hay actas. Mientras no haya una firmada, se mide el 100% de los puntos.
        </p>
      ) : (
        <div className="space-y-2">
          {c.actas.map((a) => (
            <Panel key={a.numero} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-sm font-bold">{a.numero}</span>
                <span className="rounded bg-panel-3 px-2 py-0.5 text-[10px] font-bold text-texto-2 uppercase">
                  {a.estado}
                </span>
                <span className="ml-auto text-xs text-texto-3">{fechaCorta(a.fecha)}</span>
              </div>
              <p className="num mt-1 text-[13px] text-texto-2">
                {numero(a.puntosMedidos)} de{" "}
                {conc(a.puntosInformados, "punto medido", "puntos medidos")} ·{" "}
                {m2(a.m2Medidos)} de {m2(a.m2Informados)} m²
              </p>
              {a.desviacionPct != null && (
                /* La desviación es el número que decide el régimen siguiente:
                   arriba de 5% se vuelve a medir todo. */
                <p
                  className="num mt-0.5 text-[13px] font-semibold"
                  style={{
                    color: a.desviacionPct > 5 ? "var(--color-sin-atencion)" : "var(--color-resuelto)",
                  }}
                >
                  {a.desviacionPct.toFixed(1).replace(".", ",")}% de desviación entre lo informado y lo
                  medido
                </p>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function Cifra({
  valor,
  unidad,
  detalle,
  color,
}: {
  valor: string;
  unidad: string;
  detalle: string;
  color: string;
}) {
  return (
    <Panel className="p-3">
      <p className="num text-2xl leading-tight font-extrabold" style={{ color }}>
        {valor}
      </p>
      <p className="text-[12px] font-semibold text-texto-2">{unidad}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-3">{detalle}</p>
    </Panel>
  );
}

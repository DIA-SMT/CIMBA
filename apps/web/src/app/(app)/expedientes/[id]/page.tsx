import Link from "next/link";
import { notFound } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { obtenerExpediente } from "@/lib/expedientes";
import { fechaCorta } from "@/lib/formato";
import { CSS_IMPRESION_NOTA, NotaSat } from "../nota-sat";
import { BotonImprimirNota } from "./boton-imprimir";

export const dynamic = "force-dynamic";

/**
 * La nota registrada: el documento histórico, con su detalle congelado al
 * momento de la firma. Reimprimible siempre; inmutable siempre.
 */
export default async function PaginaExpediente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const sesion = (await leerSesion())!;
  const exp = await obtenerExpediente(sesion, Number(id));
  if (!exp) notFound();

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <style>{CSS_IMPRESION_NOTA}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/expedientes" className="text-sm text-texto-2 hover:text-texto">
            ← Registro de expedientes
          </Link>
          <p className="mt-1 text-xs text-texto-3">
            Registrada el {fechaCorta(exp.generadoEn)}
            {exp.generadoPor && <> por {exp.generadoPor}</>} · el detalle quedó congelado al
            momento de la firma.
          </p>
        </div>
        <BotonImprimirNota />
      </div>

      <NotaSat
        numero={exp.numero}
        fechaIso={exp.generadoEn}
        destinatario={exp.destinatario}
        observaciones={exp.observaciones}
        renglones={exp.renglones}
        generadoPor={exp.generadoPor}
        cuerpo={exp.cuerpo}
        firma={exp.firma}
      />

      {/* La trazabilidad de la gestión: lo que se dejó afuera del papel no se
          borra del registro — pantalla interna, jamás se imprime. */}
      {exp.exclusiones && exp.exclusiones.reclamos.length > 0 && (
        <div className="mx-auto mt-4 max-w-3xl rounded-xl border border-borde bg-panel p-4 text-xs text-texto-2 print:hidden">
          <p className="mb-1 font-bold tracking-wider text-texto-3 uppercase">Exclusiones registradas</p>
          <p>
            {exp.exclusiones.por} dejó fuera de esta nota {exp.exclusiones.reclamos.length} reclamo(s) el{" "}
            {fechaCorta(exp.exclusiones.en)}:{" "}
            {exp.exclusiones.reclamos.map((r, i) => (
              <span key={r.demanda_id}>
                {i > 0 && ", "}
                <Link href={`/demandas/${r.demanda_id}`} className="font-semibold text-celeste hover:underline">
                  #{r.demanda_id}
                </Link>
                {r.ticket && <> (ticket {r.ticket})</>}
              </span>
            ))}
            . Siguieron abiertos en la cola.
          </p>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { listarIntervenciones } from "@/lib/consultas";
import { TituloPagina } from "@/components/ui";
import { ListaCampo } from "./lista-campo";

export const dynamic = "force-dynamic";

/**
 * Vista de campo para cuadrillas (reemplazo del Apps Script "Ingeco"):
 * GPS + foto de antes/durante/después, pensada para el teléfono del capataz.
 * El rol cuadrilla solo ve sus intervenciones (RLS).
 */
export default async function PaginaCampo() {
  const sesion = (await leerSesion())!;
  const [asignadas, enCurso] = await Promise.all([
    listarIntervenciones(sesion, { estado: "asignada", limite: 30 }),
    listarIntervenciones(sesion, { estado: "en_curso", limite: 30 }),
  ]);
  const trabajos = [...enCurso.filas, ...asignadas.filas];

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <TituloPagina titulo="Trabajo en campo" sub="Antes / después georreferenciado. Sin planillas." />

      {/* La unificación Campo ↔ Órdenes: las cuadrillas propias son un
          ejecutor más. Sus órdenes de trabajo se reportan en el portal de la
          Administración, con la misma mecánica que las empresas (medidas +
          foto + tipo de intervención). Esta pantalla queda para las
          intervenciones programadas directas. */}
      <Link
        href="/empresa"
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-celeste/40 bg-celeste/10 px-4 py-3 text-sm transition hover:border-celeste"
      >
        <span>
          <b className="text-celeste">Órdenes de trabajo de la Administración</b>
          <span className="mt-0.5 block text-xs text-texto-2">
            Las cuadrillas propias también trabajan por órdenes: se reportan con medidas, foto y tipo
            de intervención, igual que las empresas.
          </span>
        </span>
        <span className="shrink-0 text-celeste">→</span>
      </Link>
      {trabajos.length === 0 ? (
        <p className="rounded-xl border border-borde bg-panel px-4 py-10 text-center text-sm text-texto-3">
          No hay intervenciones asignadas ni en curso.
        </p>
      ) : (
        // La isla filtra en vivo por dirección sobre lo ya cargado: encontrar
        // "Baltazar Aguirre 2521" es tipear, no recorrer tarjetas a mano.
        <ListaCampo
          trabajos={trabajos.map((iv) => ({
            id: iv.id,
            incidenteId: iv.incidenteId,
            estado: iv.estado,
            direccion: iv.direccion,
            lat: iv.lat,
            lon: iv.lon,
            cuadrilla: iv.cuadrilla,
            fotos: iv.fotos,
          }))}
        />
      )}
    </div>
  );
}

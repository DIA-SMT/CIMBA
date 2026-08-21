import { leerSesion } from "@/lib/auth";
import { listarIntervenciones } from "@/lib/consultas";
import { TituloPagina } from "@/components/ui";
import { TarjetaCampo } from "./tarjeta-campo";

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
      {trabajos.length === 0 ? (
        <p className="rounded-xl border border-borde bg-panel px-4 py-10 text-center text-sm text-texto-3">
          No hay intervenciones asignadas ni en curso.
        </p>
      ) : (
        <div className="space-y-4">
          {trabajos.map((iv) => (
            <TarjetaCampo
              key={iv.id}
              intervencion={{
                id: iv.id,
                incidenteId: iv.incidenteId,
                estado: iv.estado,
                direccion: iv.direccion,
                lat: iv.lat,
                lon: iv.lon,
                cuadrilla: iv.cuadrilla,
                fotos: iv.fotos,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

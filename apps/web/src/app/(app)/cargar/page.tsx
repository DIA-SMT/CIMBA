import { leerSesion } from "@/lib/auth";
import { TituloPagina } from "@/components/ui";
import { FormularioCarga } from "./formulario-carga";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function PaginaCargar() {
  const sesion = (await leerSesion())!;
  const puede = ["admin", "atencion_ciudadana", "planificacion", "informacion_estrategica"].includes(
    sesion.rol_cimba,
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
      <TituloPagina
        titulo="Cargar datos"
        sub="Archivos de las fuentes conocidas o una demanda puntual. Repetir un archivo no duplica: cada fila se reconoce por su id de origen. La excepción son las planillas mensuales de bacheo, que se cargan con la CLI porque su identidad depende de la etiqueta del mes."
      />
      {puede ? (
        <FormularioCarga />
      ) : (
        <p className="rounded-lg border border-borde bg-panel px-4 py-6 text-sm text-texto-2">
          Tu rol (<b>{sesion.rol_cimba}</b>) no tiene permiso de carga. Pedile acceso al administrador.
        </p>
      )}
    </div>
  );
}

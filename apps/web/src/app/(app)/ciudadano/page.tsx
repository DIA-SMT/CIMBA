import { leerSesion } from "@/lib/auth";
import { TituloPagina } from "@/components/ui";
import { FormularioCiudadano } from "./formulario";

export const dynamic = "force-dynamic";

export default async function PaginaCiudadano() {
  const sesion = (await leerSesion())!;
  const puede = ["funcionario", "planificacion", "supervision", "atencion_ciudadana", "admin"].includes(sesion.rol_cimba);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <TituloPagina
        titulo="Pedido de un ciudadano"
        sub="Para cuando un vecino reclama en persona o por teléfono y el personal lo carga acá. Podés dictar la dirección y la descripción con el micrófono. Entra como demanda de carga manual."
      />
      {puede ? (
        <FormularioCiudadano />
      ) : (
        <p className="rounded-lg border border-borde bg-panel px-4 py-6 text-sm text-texto-2">
          Este formulario es para el personal municipal que atiende vecinos (perfiles{" "}
          <b>funcionario</b>, <b>planificación</b>, <b>supervisión</b> o <b>atención ciudadana</b>). Tu rol actual es{" "}
          <b>{sesion.rol_cimba}</b>.
        </p>
      )}
    </div>
  );
}

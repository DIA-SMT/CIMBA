import { leerSesion } from "@/lib/auth";
import { TituloPagina } from "@/components/ui";
import { FormularioHcd } from "./formulario";

export const dynamic = "force-dynamic";

export default async function PaginaHcdNuevo() {
  const sesion = (await leerSesion())!;
  const puede = sesion.rol_cimba === "hcd" || sesion.rol_cimba === "admin";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <TituloPagina
        titulo="Nuevo pedido del Concejo Deliberante"
        sub="Reemplaza el Excel del HCD: el pedido entra directo como demanda con fuente institucional propia."
      />
      {puede ? (
        <FormularioHcd />
      ) : (
        <p className="rounded-lg border border-borde bg-panel px-4 py-6 text-sm text-texto-2">
          Este formulario es para el perfil <b>HCD</b>. Tu rol actual es <b>{sesion.rol_cimba}</b>.
        </p>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { LogoCimba } from "@/components/marca";
import { TituloPagina } from "@/components/ui";
import { FormularioClave } from "./formulario-clave";

export const dynamic = "force-dynamic";

/**
 * Cambio de la propia clave.
 *
 * Vive FUERA del grupo (app) a propósito. Ese layout manda a /empresa a todo
 * rol empresa, así que una contratista con clave temporal quedaba en un
 * bucle: el middleware la empujaba a /clave y el layout la devolvía a
 * /empresa. Y de paso: acá no hace falta el menú del personal municipal —
 * esta pantalla es una sola cosa y hay que hacerla.
 */
export default async function PaginaClave() {
  const sesion = await leerSesion();
  if (!sesion) redirect("/acceso");
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-6">
        <LogoCimba />
      </div>
      <TituloPagina
        titulo="Tu clave"
        sub="Si entraste con una clave temporal, cambiala ahora: es tuya y no se la digas a nadie."
      />
      <FormularioClave nombre={sesion.nombre} />
    </div>
  );
}

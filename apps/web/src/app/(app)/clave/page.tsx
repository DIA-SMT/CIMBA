import { leerSesion } from "@/lib/auth";
import { TituloPagina } from "@/components/ui";
import { FormularioClave } from "./formulario-clave";

export const dynamic = "force-dynamic";

/**
 * Cambio de la propia clave. Los usuarios locales con clave temporal caen acá
 * directo al entrar; también sirve para renovarla cuando quieran.
 */
export default async function PaginaClave() {
  const sesion = (await leerSesion())!;
  return (
    <div className="mx-auto max-w-md p-6">
      <TituloPagina
        titulo="Tu clave"
        sub="Si entraste con una clave temporal, cambiala ahora: es tuya y no se la digas a nadie."
      />
      <FormularioClave nombre={sesion.nombre} />
    </div>
  );
}

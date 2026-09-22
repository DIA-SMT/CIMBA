import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { datosAvance, ventanaValida } from "@/lib/avance";
import { PantallaAvance } from "@/app/(app)/avance/pantalla-avance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CIMBA EN LA PANTALLA GRANDE: el modo pantalla para el televisor de la
 * Dirección (y para cuando entra una visita). Vive FUERA del route group (app)
 * a propósito: sin menú, sin encabezado.
 *
 * Mostraba la Brecha —el mapa de lo que falta, en rojo—. Desde el 22/9
 * muestra Avance: el trabajo del mes con cada empresa en su color, lo que se
 * está haciendo ahora latiendo, y lo pendiente de fondo. Es la misma pantalla
 * que la portada, con reloj y recargándose sola cada diez minutos.
 *
 * `?dias=` cambia la ventana (1, 7, 30, 90, 0 = todo); el default es el mes.
 */
export default async function PaginaTv({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const sesion = await leerSesion();
  if (!sesion) redirect("/acceso");
  // La pantalla es del personal: el rol empresa tiene su portal.
  if (sesion.rol_cimba === "empresa") redirect("/empresa");

  const dias = ventanaValida((await searchParams).dias);
  const datos = await datosAvance(sesion, dias);

  return <PantallaAvance inicial={datos} rol={sesion.rol_cimba} pantalla />;
}

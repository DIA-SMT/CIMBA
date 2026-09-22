import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { datosAvance, ventanaValida } from "@/lib/avance";

export const maxDuration = 60;

/**
 * Los datos de Avance para el refresco en vivo: la pantalla los pide cada
 * minuto con la ventana que tenga puesta. La primera carga no pasa por acá
 * —la página los trae ya renderizados— así que esto es solo para mantenerla
 * fresca sin recargar.
 *
 * Es del personal. El rol empresa tiene su portal y no debe poder enumerar el
 * trabajo de las demás contratistas; la RLS no lo tapa hoy, así que se corta acá.
 */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (sesion.rol_cimba === "empresa") return NextResponse.json({ error: "sin permiso" }, { status: 403 });

  const dias = ventanaValida(req.nextUrl.searchParams.get("dias"));
  const datos = await datosAvance(sesion, dias);
  return NextResponse.json(datos, { headers: { "cache-control": "private, max-age=30" } });
}

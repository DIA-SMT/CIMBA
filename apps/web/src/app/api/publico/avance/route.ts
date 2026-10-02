import { NextResponse, type NextRequest } from "next/server";
import { datosAvance, leerTerritorio, ventanaValida } from "@/lib/avance";

export const maxDuration = 60;

/**
 * AVANCE PARA AFUERA: los mismos datos, sin sesión, sin nombres de personas,
 * sin direcciones de pedidos y sin feed. Solo existe si la Dirección prendió
 * la llave AVANCE_PUBLICO en el hosting: hasta entonces responde 404, igual
 * que cualquier ruta inexistente, y nada de CIMBA queda a la vista sin que
 * alguien lo haya decidido.
 *
 * Se cachea un minuto en el borde (y sirve lo viejo hasta diez minutos
 * mientras se renueva): mil vecinos mirando la pantalla no son mil consultas
 * a la base.
 */
export async function GET(req: NextRequest) {
  if (process.env.AVANCE_PUBLICO !== "1") return NextResponse.json({ error: "no existe" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const datos = await datosAvance(null, {
    dias: ventanaValida(sp.get("dias")),
    territorio: leerTerritorio({ distrito: sp.get("distrito") ?? undefined, barrio: sp.get("barrio") ?? undefined }),
    publico: true,
  });
  return NextResponse.json(datos, {
    headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=600" },
  });
}

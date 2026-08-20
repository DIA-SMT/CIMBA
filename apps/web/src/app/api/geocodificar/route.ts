import { NextResponse, type NextRequest } from "next/server";
import { crearGeocoderNominatim } from "@cimba/integrations";
import { leerSesion } from "@/lib/auth";

/** Búsqueda de direcciones para el mapa. Server-side + caché en geocode_cache. */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 4) return NextResponse.json({ resultado: null });

  try {
    const geocoder = crearGeocoderNominatim();
    const resultado = await geocoder.geocodificar(q);
    return NextResponse.json({ resultado });
  } catch {
    return NextResponse.json({ resultado: null });
  }
}

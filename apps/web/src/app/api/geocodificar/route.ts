import { NextResponse, type NextRequest } from "next/server";
import { crearGeocoderNominatim } from "@cimba/integrations";
import { dentroDeSMT } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";

/** Búsqueda de direcciones para el mapa. Server-side + caché en geocode_cache. */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 4) return NextResponse.json({ resultado: null });

  /**
   * Punto de referencia opcional, "lat,lon". Cuando OSM no tiene la altura,
   * Nominatim devuelve varios tramos de la misma calle y hay que elegir uno:
   * con esto se elige el más cercano a lo que el usuario ya ubicó, en vez del
   * primero que vino. Se valida contra el bbox de la ciudad — no se confía en
   * el query para mover el resultado a cualquier lado.
   */
  const crudo = (req.nextUrl.searchParams.get("cerca") ?? "").split(",").map(Number);
  const cerca =
    crudo.length === 2 && crudo.every(Number.isFinite) && dentroDeSMT({ lat: crudo[0]!, lon: crudo[1]! })
      ? { lat: crudo[0]!, lon: crudo[1]! }
      : undefined;

  try {
    const geocoder = crearGeocoderNominatim();
    const resultado = await geocoder.geocodificar(q, { cerca });
    return NextResponse.json({ resultado });
  } catch {
    return NextResponse.json({ resultado: null });
  }
}

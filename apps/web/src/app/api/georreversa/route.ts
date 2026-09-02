import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";

/**
 * Reverse geocoding para autocompletar la dirección al marcar un punto en el
 * mapa (pedido de un ciudadano, carga manual). Server-side contra Nominatim, con caché en
 * memoria y redondeo a ~10 m para reutilizar resultados cercanos.
 */
const cache = new Map<string, string | null>();
let ultimaLlamada = 0;

export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ direccion: null });
  }

  const clave = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (cache.has(clave)) return NextResponse.json({ direccion: cache.get(clave) });

  const espera = Math.max(0, ultimaLlamada + 1100 - Date.now());
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaLlamada = Date.now();

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("zoom", "18");
    const res = await fetch(url, {
      headers: { "user-agent": "CIMBA/0.1 (Municipalidad de San Miguel de Tucuman)" },
    });
    if (!res.ok) return NextResponse.json({ direccion: null });
    const data = (await res.json()) as {
      address?: { road?: string; house_number?: string; neighbourhood?: string; suburb?: string };
    };
    const a = data.address ?? {};
    const direccion = a.road
      ? [a.road, a.house_number].filter(Boolean).join(" ") +
        (a.neighbourhood || a.suburb ? `, ${a.neighbourhood ?? a.suburb}` : "")
      : null;
    if (cache.size > 500) cache.clear();
    cache.set(clave, direccion);
    return NextResponse.json({ direccion });
  } catch {
    return NextResponse.json({ direccion: null });
  }
}

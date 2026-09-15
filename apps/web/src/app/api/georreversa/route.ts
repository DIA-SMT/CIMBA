import { NextResponse, type NextRequest } from "next/server";
import { getDb, sql } from "@cimba/db";
import { leerSesion } from "@/lib/auth";

/**
 * Reverse geocoding para autocompletar la dirección al marcar un punto en el
 * mapa (pedido de un ciudadano, carga manual). Server-side contra Nominatim, con caché en
 * memoria y redondeo a ~10 m para reutilizar resultados cercanos.
 *
 * Devuelve TRES cosas, y conviene no confundirlas:
 *
 *  direccion   lo que dice Nominatim. En San Miguel de Tucumán casi nunca trae
 *              altura: el dato no está en OSM. Por eso viaja `altura: false`
 *              cuando falta, para que la pantalla lo pida en vez de dejar que
 *              se guarde "Avenida Independencia" a secas y después nadie sepa
 *              a qué cuadra ir.
 *  territorio  distrito, barrio y circuito, resueltos contra NUESTROS
 *              polígonos, que sí son confiables. Es exactamente lo que el
 *              trigger autocompletar_territorio() va a grabar al insertar, así
 *              que mostrarlo acá no adivina nada: adelanta lo que va a pasar.
 */
const cache = new Map<string, string | null>();
let ultimaLlamada = 0;

/** El territorio del punto, con los mismos polígonos que usa el trigger. */
async function territorioDe(lat: number, lon: number) {
  try {
    const filas = (await getDb().execute(sql`
      select
        (select d.id from distritos d where st_contains(d.geom, p.geom) limit 1) as distrito,
        (select b.nombre from barrios b where st_contains(b.geom, p.geom) limit 1) as barrio,
        (select c.codigo from circuitos c where st_contains(c.geom, p.geom) limit 1) as circuito
      from (select st_setsrid(st_makepoint(${lon}, ${lat}), 4326) as geom) p
    `)) as unknown as Array<{ distrito: number | null; barrio: string | null; circuito: string | null }>;
    const t = filas[0];
    if (!t) return null;
    return {
      distrito: t.distrito != null ? Number(t.distrito) : null,
      barrio: t.barrio ?? null,
      circuito: t.circuito ?? null,
    };
  } catch {
    // Sin territorio no se rompe la carga: la dirección alcanza para registrar.
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ direccion: null, altura: false, territorio: null });
  }

  // El territorio sale de nuestra base y no depende de Nominatim: se resuelve
  // igual aunque el reverse geocoding falle o esté cacheado.
  const territorio = await territorioDe(lat, lon);

  const clave = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (cache.has(clave)) {
    const guardada = cache.get(clave) ?? null;
    return NextResponse.json({
      direccion: guardada,
      altura: guardada != null && /\d/.test(guardada),
      territorio,
    });
  }

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
    if (!res.ok) return NextResponse.json({ direccion: null, altura: false, territorio });
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
    // La altura es el dato que casi siempre falta y el que más se necesita
    // para llegar a la cuadra: se informa aparte para poder pedirlo.
    return NextResponse.json({ direccion, altura: Boolean(a.house_number), territorio });
  } catch {
    return NextResponse.json({ direccion: null, altura: false, territorio });
  }
}

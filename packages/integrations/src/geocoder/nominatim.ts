import { getDb, sql } from "@cimba/db";
import type { Geocoder, ResultadoGeocod } from "@cimba/domain";
import { claveDireccion, dentroDeSMT } from "@cimba/domain";

/**
 * Geocodificador Nominatim (OSM) — SOLO para desarrollo y volúmenes mínimos.
 * Siempre server-side y siempre detrás de geocode_cache. La política de uso
 * de Nominatim público prohíbe volumen alto y no ofrece SLA: el proveedor
 * definitivo (Nominatim propio o callejero municipal) queda abierto en
 * docs/decisiones.md.
 */
export function crearGeocoderNominatim(): Geocoder {
  let ultimaLlamada = 0;
  return {
    async geocodificar(direccion: string): Promise<ResultadoGeocod | null> {
      const clave = claveDireccion(direccion);
      const db = getDb();

      const cacheado = (await db.execute(sql`
        select st_y(geom) as lat, st_x(geom) as lon, confianza, proveedor
        from geocode_cache where direccion_norm = ${clave}
      `)) as unknown as Array<{ lat: number; lon: number; confianza: number; proveedor: string }>;
      const hit = cacheado[0];
      if (hit) {
        return {
          punto: { lat: hit.lat, lon: hit.lon },
          confianza: Number(hit.confianza),
          proveedor: hit.proveedor,
          direccionResuelta: null,
        };
      }

      // Rate limit duro: 1 req/segundo (política de Nominatim público)
      const ahora = Date.now();
      const espera = Math.max(0, ultimaLlamada + 1100 - ahora);
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      ultimaLlamada = Date.now();

      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", `${direccion}, San Miguel de Tucumán, Tucumán, Argentina`);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "ar");
      const res = await fetch(url, {
        headers: { "user-agent": "CIMBA/0.1 (Municipalidad de San Miguel de Tucuman; dev)" },
      });
      if (!res.ok) return null;
      const resultados = (await res.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
        type: string;
      }>;
      const mejor = resultados[0];
      if (!mejor) return null;

      const punto = { lat: Number(mejor.lat), lon: Number(mejor.lon) };
      if (!dentroDeSMT(punto)) return null;
      const confianza = mejor.type === "house" || mejor.type === "intersection" ? 0.85 : 0.55;

      await db.execute(sql`
        insert into geocode_cache (direccion_norm, geom, confianza, proveedor)
        values (${clave}, st_setsrid(st_makepoint(${punto.lon}, ${punto.lat}), 4326), ${confianza}, 'nominatim')
        on conflict (direccion_norm) do nothing
      `);

      return { punto, confianza, proveedor: "nominatim", direccionResuelta: mejor.display_name };
    },
  };
}

import { getDb, sql } from "@cimba/db";
import type { Geocoder, OpcionesGeocod, PrecisionGeocod, Punto, ResultadoGeocod } from "@cimba/domain";
import { BBOX_SMT, CONFIANZA_POR_PRECISION, claveDireccion, dentroDeSMT } from "@cimba/domain";

/**
 * Geocodificador Nominatim (OSM) — SOLO para desarrollo y volúmenes mínimos.
 * Siempre server-side y siempre detrás de geocode_cache. La política de uso
 * de Nominatim público prohíbe volumen alto y no ofrece SLA: el proveedor
 * definitivo (Nominatim propio o callejero municipal) queda abierto en
 * docs/decisiones.md.
 *
 * ── EL PROBLEMA QUE ESTE ARCHIVO TIENE QUE NO ESCONDER ──────────────────────
 *
 * OSM no tiene la altura de la mayoría de las calles de San Miguel de Tucumán.
 * Cuando no la tiene, Nominatim no dice "no sé": devuelve LOS TRAMOS de esa
 * calle, cada uno con su punto, y el código pedía limit=1 y se quedaba con el
 * primero. Medido sobre el caché de producción el 16/09: 51 de 79 direcciones
 * (65%) estaban resueltas así, y "Colombia 4500" y "Colombia 4576" —media
 * cuadra en la realidad— habían quedado a 3,2 km, en tramos distintos de la
 * misma calle.
 *
 * Nada en la pantalla lo decía. Se veía un tilde verde.
 *
 * Ahora se piden varios candidatos, se distingue si el proveedor encontró la
 * ALTURA o solo la calle, y eso viaja como `precision` hasta la pantalla. Un
 * resultado de calle es utilizable —la calle es la correcta— pero exige que
 * alguien ponga el pin, y así se lo pide.
 */

const BASE = "https://nominatim.openstreetmap.org/search";
const UA = "CIMBA/0.1 (Municipalidad de San Miguel de Tucuman; dev)";

/**
 * El rate limit es del PROCESO, no del objeto. Estaba adentro de la clausura de
 * crearGeocoderNominatim() y el route handler crea un geocoder nuevo en cada
 * request: `ultimaLlamada` arrancaba siempre en 0 y el límite de 1 req/s de la
 * política de Nominatim no se respetaba nunca. Con la IP de la Municipalidad,
 * eso termina en bloqueo.
 */
let ultimaLlamada = 0;
async function esperarTurno() {
  const espera = Math.max(0, ultimaLlamada + 1100 - Date.now());
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaLlamada = Date.now();
}

interface Candidato {
  lat: string;
  lon: string;
  category?: string;
  type?: string;
  display_name: string;
  address?: { house_number?: string; road?: string };
}

/** "Colombia 4576" → { calle: "Colombia", altura: "4576" }. Sin altura, null. */
function partirAltura(direccion: string): { calle: string; altura: string } | null {
  const m = /^(.*?)[\s,]+(\d{1,5})\s*$/.exec(direccion.trim());
  if (!m?.[1] || !m[2]) return null;
  return { calle: m[1].trim(), altura: m[2] };
}

const metros = (a: Punto, b: Punto) => {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function consultar(parametros: Record<string, string>): Promise<Candidato[]> {
  const url = new URL(BASE);
  for (const [clave, valor] of Object.entries(parametros)) url.searchParams.set(clave, valor);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ar");
  /**
   * La ciudad como caja de búsqueda, pero SIN bounded=1: con el recorte duro,
   * "Corrientes y Muñecas" devolvía cero resultados. El viewbox ordena por
   * cercanía y dentroDeSMT() descarta después lo que quedó afuera.
   */
  url.searchParams.set(
    "viewbox",
    `${BBOX_SMT.lonMin},${BBOX_SMT.latMin},${BBOX_SMT.lonMax},${BBOX_SMT.latMax}`,
  );
  await esperarTurno();
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) return [];
  return (await res.json()) as Candidato[];
}

export function crearGeocoderNominatim(): Geocoder {
  return {
    async geocodificar(direccion: string, opciones?: OpcionesGeocod): Promise<ResultadoGeocod | null> {
      const clave = claveDireccion(direccion);
      const db = getDb();

      /**
       * Solo se leen del caché las EXACTAS. Un resultado de calle depende del
       * punto de referencia con el que se desempató, así que cachearlo sería
       * congelar una respuesta que mañana debería ser otra — y era exactamente
       * lo que pasaba: las 51 direcciones mal ubicadas estaban guardadas sin
       * ninguna forma de volver a preguntar.
       */
      const cacheado = (await db.execute(sql`
        select st_y(geom) as lat, st_x(geom) as lon, confianza, proveedor
        from geocode_cache where direccion_norm = ${clave} and precision = 'exacta'
      `)) as unknown as Array<{ lat: number; lon: number; confianza: number; proveedor: string }>;
      const hit = cacheado[0];
      if (hit) {
        return {
          punto: { lat: hit.lat, lon: hit.lon },
          confianza: Number(hit.confianza),
          precision: "exacta",
          proveedor: hit.proveedor,
          direccionResuelta: null,
        };
      }

      const partes = partirAltura(direccion);
      let candidatos: Candidato[] = [];

      // Con altura, la consulta estructurada es la única que puede devolver la
      // puerta: el texto libre la resuelve peor.
      if (partes) {
        candidatos = await consultar({
          street: `${partes.altura} ${partes.calle}`,
          city: "San Miguel de Tucumán",
          state: "Tucumán",
          country: "Argentina",
          limit: "8",
        });
      }
      // Sin altura —una esquina, "Corrientes y Muñecas"— o si la estructurada
      // no trajo nada, cae al texto libre, que es lo que entiende las esquinas.
      if (candidatos.length === 0) {
        candidatos = await consultar({
          q: `${direccion}, San Miguel de Tucumán, Tucumán, Argentina`,
          limit: "8",
        });
      }

      const dentro = candidatos.filter((c) =>
        dentroDeSMT({ lat: Number(c.lat), lon: Number(c.lon) }),
      );
      const primero = dentro[0];
      if (!primero) return null;

      /**
       * LA ELECCIÓN. Primero, el candidato que trae la altura pedida: ese es la
       * puerta y no hay nada que desempatar. Si ninguno la trae, lo que queda
       * son tramos de la calle y quedarse con "el primero" es elegir al azar —
       * se toma el más cercano a la referencia (el tramo anterior que ya se
       * ubicó), y si no hay referencia, el primero, pero diciendo que es de
       * calle y no de puerta.
       */
      const conAltura = partes
        ? dentro.find((c) => c.address?.house_number === partes.altura)
        : undefined;
      const cerca = opciones?.cerca;
      const elegido =
        conAltura ??
        (cerca
          ? [...dentro].sort(
              (a, b) =>
                metros(cerca, { lat: Number(a.lat), lon: Number(a.lon) }) -
                metros(cerca, { lat: Number(b.lat), lon: Number(b.lon) }),
            )[0]!
          : primero);

      const precision: PrecisionGeocod = conAltura
        ? "exacta"
        : partes || elegido.category === "highway"
          ? "calle"
          : "aproximada";

      const punto = { lat: Number(elegido.lat), lon: Number(elegido.lon) };
      const confianza = CONFIANZA_POR_PRECISION[precision];

      if (precision === "exacta") {
        await db.execute(sql`
          insert into geocode_cache (direccion_norm, geom, confianza, proveedor, precision)
          values (${clave}, st_setsrid(st_makepoint(${punto.lon}, ${punto.lat}), 4326),
                  ${confianza}, 'nominatim', 'exacta')
          on conflict (direccion_norm) do update
            set geom = excluded.geom, confianza = excluded.confianza, precision = 'exacta'
        `);
      }

      return {
        punto,
        confianza,
        precision,
        proveedor: "nominatim",
        direccionResuelta: elegido.display_name,
      };
    },
  };
}

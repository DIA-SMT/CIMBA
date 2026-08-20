import type { DemandaNormalizada, TipoProblema } from "@cimba/domain";
import { demandaNormalizadaSchema, normalizarDireccion } from "@cimba/domain";
import type { AdaptadorFuente } from "../tipos";

/**
 * Adaptador MOCK de Atención Ciudadana: genera reclamos plausibles sobre
 * esquinas reales de SMT mientras no exista el endpoint de listado incremental
 * (GET /reclamos/listarPorRango — pedido al equipo de AC, ver docs/decisiones.md).
 */

const ESQUINAS_REALES: Array<{ dir: string; lat: number; lon: number }> = [
  { dir: "Av Mate de Luna 2400", lat: -26.8296, lon: -65.2413 },
  { dir: "Av Saenz Peña y San Lorenzo", lat: -26.83538, lon: -65.197891 },
  { dir: "Colombia y Balcarce", lat: -26.8075327, lon: -65.1928116 },
  { dir: "Lamadrid 3057", lat: -26.8290316, lon: -65.2455735 },
  { dir: "Bolivar 2553", lat: -26.8344867, lon: -65.2375994 },
  { dir: "Laprida 1900", lat: -26.8053366, lon: -65.1970686 },
  { dir: "Av Alem 1044", lat: -26.8425, lon: -65.2218 },
  { dir: "Av Adolfo de la Vega 527", lat: -26.8287165, lon: -65.2532269 },
  { dir: "Lavalle 3625", lat: -26.8298783, lon: -65.2538533 },
  { dir: "Marco Avellaneda y Av Sarmiento", lat: -26.8166814, lon: -65.2122047 },
  { dir: "Crisóstomo Álvarez 1840", lat: -26.8312, lon: -65.2258 },
  { dir: "Jose C Paz y Jose Gorriti", lat: -26.822489, lon: -65.248721 },
  { dir: "Av Roca y Libertad", lat: -26.8476, lon: -65.2118 },
  { dir: "Don Bosco y Felix Frias", lat: -26.8148, lon: -65.2205 },
  { dir: "Av Belgrano y Thames", lat: -26.8009, lon: -65.2236 },
  { dir: "9 de Julio y Avenida Roca", lat: -26.8459, lon: -65.2029 },
  { dir: "Santiago del Estero 2081", lat: -26.8203, lon: -65.2246 },
  { dir: "Av Francisco de Aguirre 1060", lat: -26.7932294, lon: -65.2052328 },
];

const TIPOS: TipoProblema[] = ["bache", "hundimiento", "pavimento_deteriorado", "perdida_agua", "tapa_registro"];

const DESCRIPCIONES: Record<TipoProblema, string[]> = {
  bache: ["Bache profundo sobre la calzada", "Pozo en la senda de circulación", "Bache que rompe cubiertas"],
  hundimiento: ["Hundimiento de calzada", "Se está hundiendo el pavimento junto al cordón"],
  pavimento_deteriorado: ["Pavimento muy deteriorado en toda la cuadra", "Calzada rota tras obra"],
  perdida_agua: ["Pérdida de agua que socava el pavimento", "Pérdida cloacal sobre la calle"],
  tapa_registro: ["Falta tapa de boca de registro", "Tapa de cámara hundida"],
  fisura: ["Fisuras longitudinales en la calzada"],
  sumidero: ["Sumidero tapado que acumula agua"],
  otro: ["Reclamo vial sin clasificar"],
};

/** PRNG determinístico (mulberry32) para que cada corrida sea reproducible por semilla. */
function crearRng(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function crearAdaptadorMock(opciones?: { cantidad?: number; semilla?: number }): AdaptadorFuente {
  return {
    sistema: "atencion_ciudadana",
    async traerDemandas(desde: Date | null): Promise<DemandaNormalizada[]> {
      const cantidad = opciones?.cantidad ?? 8;
      const semilla = opciones?.semilla ?? Math.floor(Date.now() / 3_600_000); // varía por hora
      const rng = crearRng(semilla);
      const base = desde ?? new Date(Date.now() - 7 * 86_400_000);

      return Array.from({ length: cantidad }, (_, i) => {
        const esquina = ESQUINAS_REALES[Math.floor(rng() * ESQUINAS_REALES.length)]!;
        const tipo = TIPOS[Math.floor(rng() * TIPOS.length)]!;
        const descripciones = DESCRIPCIONES[tipo];
        const jitter = () => (rng() - 0.5) * 0.0008; // ~±40 m
        const fecha = new Date(base.getTime() + rng() * (Date.now() - base.getTime()));
        const idRemoto = `mock-${semilla}-${i + 1}`;
        return demandaNormalizadaSchema.parse({
          sistema: "atencion_ciudadana",
          idRemoto,
          fuente: "atencion_ciudadana",
          tipo,
          descripcion: descripciones[Math.floor(rng() * descripciones.length)] ?? null,
          direccionTexto: esquina.dir,
          direccionNormalizada: normalizarDireccion(esquina.dir),
          punto: { lat: esquina.lat + jitter(), lon: esquina.lon + jitter() },
          geocodConfianza: rng() > 0.2 ? 0.9 : 0.4,
          distritoId: null,
          solicitante: null,
          prioridadInformada: rng() > 0.7 ? Math.ceil(rng() * 3) : null,
          menciones: rng() > 0.8 ? Math.ceil(rng() * 5) : null,
          urlOrigen: null,
          contacto: {},
          creadoEn: fecha,
          metadata: { mock: true, estado_ac: "INICIADO", origen_ac: "Chat Center (Call Center)" },
        });
      });
    },
  };
}

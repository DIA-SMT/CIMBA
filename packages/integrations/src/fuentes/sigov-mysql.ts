/**
 * SIGOV Obras Viales, leído directo del MySQL de la Dirección (172.16.8.214).
 *
 * Reemplaza al importador de `obras_SMT.xlsx`: mismo `id_remoto` (numero_obra),
 * así que las obras que ya estaban en CIMBA por el Excel se actualizan en lugar
 * de duplicarse, y por primera vez avanzan de estado solas.
 *
 * Ojo con la escala: SIGOV no son baches. La obra mediana son 172 m² —paños de
 * hormigón y tramos de asfalto— contra los 4 m² del bache promedio de las
 * empresas. Sumar las dos cosas en un mismo total de "m² reparados" hace que
 * SIGOV se coma el número. Por eso todo lo que sale de acá queda etiquetado en
 * metadata con `escala: "obra"`.
 *
 * Requiere estar adentro de la red municipal: 172.16.8.214 es IP privada y no
 * se alcanza desde Vercel. Corre en el enlace (ver docs/runner.md).
 */
import type { EstadoIntervencion, IntervencionNormalizada } from "@cimba/domain";
import { intervencionNormalizadaSchema } from "@cimba/domain";
import { limpiarTexto, mapearTipo, puntoValido } from "../archivos/util";

export const SISTEMA_SIGOV = "sigov";

/**
 * Las fotos las sirve el propio backend de SIGOV, sin autenticación. No se
 * descargan: se guarda la URL, igual que con las de Drive. Son de 250-650 KB y
 * no hay miniaturas, así que la grilla tiene que cargarlas de a poco.
 */
export const BASE_FOTOS_SIGOV = "https://estadisticas.smt.gob.ar:5010/api/uploads/";

/**
 * Una obra de 88.320 m² (8 × 11.040) es un largo mal tipeado, no una obra: son
 * 11 kilómetros de calle. El percentil 99 real está en 1.598 m². Se cargan sin
 * superficie para no inflar la obra ejecutada, y se reportan para que Bacheo
 * las corrija en SIGOV.
 */
const SUPERFICIE_MAX_CREIBLE = 3000;

export interface FilaObraSigov {
  id: number;
  numero_obra: string;
  estado_actual: string;
  ancho: string | null;
  largo: string | null;
  ubicacion_calzada: string | null;
  observaciones: string | null;
  latitud: string | null;
  longitud: string | null;
  calle: string | null;
  altura: string | null;
  prioridad: string | null;
  orden_trabajo_numero: string | null;
  monto_total: string | null;
  porcentaje_avance: number | null;
  cancelada: number;
  motivo_cancelacion: string | null;
  posible_duplicado_de_id: number | null;
  expediente_numero: string | null;
  fecha_relevamiento: Date | null;
  fecha_certificacion: Date | null;
  fecha_liquidacion: Date | null;
  estado_cambiado_en: Date | null;
  updated_at: Date | null;
  tipo_obra: string | null;
  origen_danio: string | null;
  licitacion: string | null;
  contratista: string | null;
}

export interface FilaFotoSigov {
  numero_obra: string;
  ruta_archivo: string;
  etapa: string | null;
  latitud: string | null;
  longitud: string | null;
  timestamp_foto: Date | null;
}

/**
 * El estado de SIGOV es administrativo y la parte final del recorrido
 * —certificar, liquidar, pagar— no cambia nada en la calle. Para CIMBA la
 * pregunta es si la calle está arreglada, así que EJECUTADA ya cuenta como
 * terminada aunque falte la firma.
 */
const ESTADOS_TERMINADOS = new Set([
  "EJECUTADA",
  "EN_PROCESO_CERTIFICACION",
  "CERTIFICADA",
  "LIQUIDADA",
  "FINALIZADA",
]);

function mapearEstado(fila: FilaObraSigov): EstadoIntervencion {
  if (fila.cancelada === 1) return "anulada";
  const e = (fila.estado_actual ?? "").toUpperCase();
  if (ESTADOS_TERMINADOS.has(e)) return "finalizada";
  if (e === "EN_EJECUCION") return "en_curso";
  return "asignada";
}

function numero(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fecha(v: Date | null): Date | null {
  if (!v) return null;
  return Number.isNaN(v.getTime()) ? null : v;
}

export interface LoteSigov {
  intervenciones: IntervencionNormalizada[];
  fotos: Array<{
    idRemotoIntervencion: string;
    momento: "antes" | "durante" | "despues";
    urlExterna: string;
    lat: number | null;
    lon: number | null;
    tomadaEn: Date | null;
  }>;
  sospechosos: Array<{ id: string; m2: number; direccion: string }>;
  canceladas: number;
  posiblesDuplicados: number;
  sinGeo: number;
}

/** La etapa de la foto dice en qué momento de la obra se sacó. */
function momentoDeEtapa(etapa: string | null): "antes" | "durante" | "despues" {
  switch ((etapa ?? "").toUpperCase()) {
    case "EJECUCION":
      return "durante";
    case "INSPECCION":
      return "despues";
    default:
      return "antes"; // RELEVAMIENTO
  }
}

export function mapearLoteSigov(obras: FilaObraSigov[], fotos: FilaFotoSigov[]): LoteSigov {
  const lote: LoteSigov = {
    intervenciones: [],
    fotos: [],
    sospechosos: [],
    canceladas: 0,
    posiblesDuplicados: 0,
    sinGeo: 0,
  };

  /**
   * La primera foto de ejecución es la mejor prueba de cuándo estuvo la
   * cuadrilla en la calle: SIGOV no guarda fecha de inicio de obra.
   */
  const primeraEjecucion = new Map<string, Date>();
  for (const f of fotos) {
    if ((f.etapa ?? "").toUpperCase() !== "EJECUCION") continue;
    const t = fecha(f.timestamp_foto);
    if (!t) continue;
    const previa = primeraEjecucion.get(f.numero_obra);
    if (!previa || t < previa) primeraEjecucion.set(f.numero_obra, t);
  }

  for (const o of obras) {
    const estado = mapearEstado(o);
    if (estado === "anulada") lote.canceladas++;
    if (o.posible_duplicado_de_id != null) lote.posiblesDuplicados++;

    const punto = puntoValido(o.latitud, o.longitud);
    if (!punto) lote.sinGeo++;

    const direccion =
      [limpiarTexto(o.calle), limpiarTexto(o.altura)].filter(Boolean).join(" ") || null;

    const ancho = numero(o.ancho);
    const largo = numero(o.largo);
    const bruta = ancho != null && largo != null ? ancho * largo : null;
    let superficie: number | null = null;
    if (bruta != null && bruta > 0) {
      if (bruta > SUPERFICIE_MAX_CREIBLE) {
        lote.sospechosos.push({
          id: o.numero_obra,
          m2: bruta,
          direccion: `${direccion ?? "sin dirección"} (${ancho} × ${largo})`,
        });
      } else {
        superficie = Math.round(bruta * 100) / 100;
      }
    }

    const terminada = estado === "finalizada";
    const finalizadaEn = terminada
      ? (fecha(o.fecha_certificacion) ?? fecha(o.fecha_liquidacion) ?? fecha(o.estado_cambiado_en))
      : null;
    const iniciadaEn =
      primeraEjecucion.get(o.numero_obra) ??
      (o.estado_actual === "EN_EJECUCION" ? fecha(o.estado_cambiado_en) : null);

    const tipo = mapearTipo(o.tipo_obra ?? o.observaciones ?? "");

    lote.intervenciones.push(
      intervencionNormalizadaSchema.parse({
        sistema: SISTEMA_SIGOV,
        idRemoto: o.numero_obra,
        tipo: tipo === "otro" ? "pavimento_deteriorado" : tipo,
        estado,
        punto,
        geocodConfianza: punto ? 0.9 : null, // relevado en campo con GPS
        direccionTexto: direccion,
        superficieM2: superficie,
        iniciadaEn,
        finalizadaEn,
        materiales: {
          tipo_obra: limpiarTexto(o.tipo_obra),
          ubicacion_calzada: limpiarTexto(o.ubicacion_calzada),
          ancho,
          largo,
        },
        observaciones: limpiarTexto(o.observaciones),
        metadata: {
          escala: "obra", // no es un bache: ver el comentario de arriba
          obra_id: o.id,
          fuente: "mysql",
          licitacion: limpiarTexto(o.licitacion),
          contratista: limpiarTexto(o.contratista),
          empresa: limpiarTexto(o.contratista),
          prioridad_sigov: limpiarTexto(o.prioridad),
          origen_danio: limpiarTexto(o.origen_danio),
          orden_trabajo: limpiarTexto(o.orden_trabajo_numero),
          expediente: limpiarTexto(o.expediente_numero),
          estado_sigov: o.estado_actual,
          avance_pct: o.porcentaje_avance,
          monto_total: numero(o.monto_total),
          relevamiento: fecha(o.fecha_relevamiento)?.toISOString() ?? null,
          cancelada: o.cancelada === 1 || undefined,
          motivo_cancelacion: limpiarTexto(o.motivo_cancelacion),
          // SIGOV lo marca pero no lo resuelve: se carga igual, avisando.
          posible_duplicado_de: o.posible_duplicado_de_id,
          superficie_no_creible: bruta != null && bruta > SUPERFICIE_MAX_CREIBLE ? bruta : undefined,
        },
      }),
    );
  }

  const conocidas = new Set(obras.map((o) => o.numero_obra));
  for (const f of fotos) {
    if (!conocidas.has(f.numero_obra)) continue;
    const ruta = limpiarTexto(f.ruta_archivo);
    if (!ruta) continue;
    lote.fotos.push({
      idRemotoIntervencion: f.numero_obra,
      momento: momentoDeEtapa(f.etapa),
      urlExterna: BASE_FOTOS_SIGOV + ruta.replace(/^\/+/, ""),
      lat: numero(f.latitud),
      lon: numero(f.longitud),
      tomadaEn: fecha(f.timestamp_foto),
    });
  }

  return lote;
}

// ── Lectura del MySQL ────────────────────────────────────────────────────────

const SQL_OBRAS = `
  select o.id, o.numero_obra, o.estado_actual, o.ancho, o.largo, o.ubicacion_calzada,
         o.observaciones, o.latitud, o.longitud, o.calle, o.altura, o.prioridad,
         o.orden_trabajo_numero, o.monto_total, o.porcentaje_avance, o.cancelada,
         o.motivo_cancelacion, o.posible_duplicado_de_id, o.expediente_numero,
         o.fecha_relevamiento, o.fecha_certificacion, o.fecha_liquidacion,
         o.estado_cambiado_en, o.updated_at,
         t.nombre  as tipo_obra,
         od.nombre as origen_danio,
         l.numero  as licitacion,
         coalesce(nullif(trim(u.razon_social), ''),
                  trim(concat(coalesce(u.apellido, ''), ' ', coalesce(u.nombre, '')))) as contratista
  from obras o
  left join tipos_obra     t  on t.id  = o.tipo_obra_id
  left join origenes_danio od on od.id = o.origen_danio_id
  left join licitaciones   l  on l.id  = o.licitacion_id
  left join usuarios       u  on u.cuil = l.contratista_cuil
  order by o.id
`;

const SQL_FOTOS = `
  select o.numero_obra, f.ruta_archivo, f.etapa, f.latitud, f.longitud, f.timestamp_foto
  from obra_fotos f
  join obras o on o.id = f.obra_id
  order by f.id
`;

export interface ConexionSigov {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function conexionDesdeEntorno(): ConexionSigov {
  const faltan = ["MYSQL_BACHEO_HOST", "MYSQL_BACHEO_USER", "MYSQL_BACHEO_PASSWORD"].filter(
    (k) => !process.env[k],
  );
  if (faltan.length > 0) {
    throw new Error(
      `Falta configurar ${faltan.join(", ")} en el .env: sin eso no se puede leer SIGOV.`,
    );
  }
  return {
    host: process.env.MYSQL_BACHEO_HOST as string,
    port: Number(process.env.MYSQL_BACHEO_PORT ?? 3306),
    user: process.env.MYSQL_BACHEO_USER as string,
    password: process.env.MYSQL_BACHEO_PASSWORD as string,
    database: process.env.MYSQL_SIGOV_DB ?? "smt_obrasviales",
  };
}

/**
 * Lee obras y fotos en una sola conexión. Solo SELECT: el usuario de CIMBA no
 * escribe en SIGOV ni tiene por qué poder hacerlo.
 */
export async function traerSigov(
  conf: ConexionSigov = conexionDesdeEntorno(),
): Promise<{ obras: FilaObraSigov[]; fotos: FilaFotoSigov[] }> {
  const { default: mysql } = await import("mysql2/promise");
  const cx = await mysql.createConnection({ ...conf, connectTimeout: 20_000 });
  try {
    const [obras] = await cx.query(SQL_OBRAS);
    const [fotos] = await cx.query(SQL_FOTOS);
    return {
      obras: obras as unknown as FilaObraSigov[],
      fotos: fotos as unknown as FilaFotoSigov[],
    };
  } finally {
    await cx.end();
  }
}

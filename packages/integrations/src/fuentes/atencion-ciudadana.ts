import { z } from "zod";
import type { DemandaNormalizada, TipoProblema } from "@cimba/domain";
import { demandaNormalizadaSchema, normalizarDireccion } from "@cimba/domain";
import { limpiarTexto, mapearTipo, parsearFecha, puntoValido } from "../archivos/util";
import type { AdaptadorFuente } from "../tipos";
import { postJsonSmt } from "./https-smt";

/**
 * Adaptador REAL de Atención Ciudadana (CIDITUC).
 *
 * La API no tiene endpoint de listado ni de "actualizados desde X": lo único
 * que expone es la consulta por id (POST /reclamos/traerReclamoPorID). Como los
 * ids son secuenciales y densos, la sincronización se hace BARRIENDO ids hacia
 * adelante desde el último ya importado (external_ref guarda ese cursor).
 *
 * Verificado en vivo contra el host de AC (31/08/2026): responde sin
 * autenticación, trae los reclamos del mismo día, y las coordenadas vienen bien
 * formadas en coorde1/coorde2 — no hace falta el reacomodo del decimal que sí
 * necesita el endpoint del puerto 5000 (ver el derivador, VerReclamo.jsx).
 *
 * De los 148 tipos de reclamo del catálogo, a CIMBA le competen los de la
 * categoría 1 ("Calles"): bacheo, pavimento en mal estado, tapas de desagüe,
 * cordón cuneta. El resto (alumbrado, basura, arbolado…) se descarta acá.
 */

const reclamoAcSchema = z.object({
  id_reclamo: z.number(),
  id_categoria: z.number().nullish(),
  nombre_categoria: z.string().nullish(),
  id_treclamo: z.number().nullish(),
  nombre_treclamo: z.string().nullish(),
  id_oreclamo: z.number().nullish(),
  nombre_oreclamo: z.string().nullish(),
  asunto: z.string().nullish(),
  detalle: z.string().nullish(),
  descripcion_lugar: z.string().nullish(),
  direccion: z.string().nullish(),
  coorde1: z.union([z.string(), z.number()]).nullish(),
  coorde2: z.union([z.string(), z.number()]).nullish(),
  id_distrito: z.number().nullish(),
  apellido_nombre: z.string().nullish(),
  telefono: z.string().nullish(),
  email: z.string().nullish(),
  cuit: z.union([z.string(), z.number()]).nullish(),
  id_persona: z.number().nullish(),
  fecha_hora_inicio: z.string().nullish(),
  nombre_estado: z.string().nullish(),
  nombre_prioridad: z.string().nullish(),
  id_prioridad: z.number().nullish(),
  foto: z.union([z.boolean(), z.number()]).nullish(),
});

export type ReclamoAc = z.infer<typeof reclamoAcSchema>;

export function mapearReclamoAc(r: ReclamoAc): DemandaNormalizada {
  const direccion = limpiarTexto(String(r.direccion ?? "").split(", SAN MIGUEL")[0]);
  const contacto: Record<string, unknown> = {};
  if (limpiarTexto(r.apellido_nombre)) contacto.nombre = limpiarTexto(r.apellido_nombre);
  if (limpiarTexto(r.telefono)) contacto.telefono = limpiarTexto(r.telefono);
  if (limpiarTexto(r.email)) contacto.email = limpiarTexto(r.email);
  if (limpiarTexto(r.cuit) && String(r.cuit) !== "0") contacto.cuit = limpiarTexto(r.cuit);

  return demandaNormalizadaSchema.parse({
    sistema: "atencion_ciudadana",
    idRemoto: String(r.id_reclamo),
    fuente: "atencion_ciudadana",
    tipo:
      (r.id_treclamo != null ? TIPO_CIMBA_POR_TRECLAMO[r.id_treclamo] : undefined) ??
      mapearTipo(r.nombre_treclamo),
    descripcion: limpiarTexto(r.detalle) ?? limpiarTexto(r.asunto),
    direccionTexto: direccion,
    direccionNormalizada: direccion ? normalizarDireccion(direccion) : null,
    punto: puntoValido(r.coorde1, r.coorde2),
    geocodConfianza: puntoValido(r.coorde1, r.coorde2) ? 0.5 : null,
    // FK a distritos deshabilitada hasta cargar distritosNuevo.json (ver metadata)
    distritoId: null,
    solicitante: null,
    prioridadInformada: r.id_prioridad ?? null,
    menciones: null,
    urlOrigen: null,
    contacto,
    creadoEn: parsearFecha(r.fecha_hora_inicio, "dma"),
    metadata: {
      distrito_ac: r.id_distrito ?? null,
      estado_ac: r.nombre_estado ?? null,
      categoria_ac: r.nombre_categoria ?? null,
      tipo_reclamo_ac: r.nombre_treclamo ?? null,
      origen_ac: r.nombre_oreclamo ?? null,
      id_persona: r.id_persona ?? null,
      asunto: limpiarTexto(r.asunto),
      descripcion_lugar: limpiarTexto(r.descripcion_lugar),
      tiene_foto: Boolean(r.foto),
    },
  });
}

/** Categoría 1 = "Calles": la única de vía pública/pavimento del catálogo de AC. */
export const CATEGORIA_CALLES_AC = 1;

/**
 * Tipos de reclamo de esa categoría que son un problema de pavimento. Se listan
 * explícitamente en vez de aceptar toda la categoría, para que un tipo nuevo del
 * lado de AC no entre solo y sin mapeo. Los ids salen de
 * GET /atencionCiudadana/listarTipoReclamo; los marcados (deshab) ya no se
 * pueden cargar pero siguen existiendo en el histórico.
 */
export const TIPOS_PAVIMENTO_AC = new Set([
  1, //   Solicitud de bacheo (Subir foto)
  2, //   Tapa de cámara faltante (deshab)
  3, //   Mantenimiento en calle de ripio
  4, //   Calle anegada por pérdida de agua (deshab)
  104, // Solicitud de pavimentación (deshab)
  105, // Calle de pavimento en mal estado
  126, // Tapa rota u obstruída de desagüe o boca tormenta
  135, // Pasar máquina en calle (deshab)
  148, // Reparación o construcción de cordón cuneta
]);

/**
 * Tipo CIMBA para cada tipo de reclamo de AC. Explícito por id, no por
 * heurística sobre el nombre: "Mantenimiento en calle de ripio" no contiene
 * ninguna palabra que la heurística reconozca y caía en "otro".
 */
const TIPO_CIMBA_POR_TRECLAMO: Record<number, TipoProblema> = {
  1: "bache", //     Solicitud de bacheo (Subir foto)
  2: "tapa_registro", //  Tapa de cámara faltante
  3: "otro", //      Mantenimiento en calle de ripio (calle sin pavimentar)
  4: "perdida_agua", //   Calle anegada por pérdida de agua
  104: "pavimento_deteriorado", // Solicitud de pavimentación
  105: "pavimento_deteriorado", // Calle de pavimento en mal estado
  126: "sumidero", //     Tapa rota u obstruída de desagüe o boca tormenta
  135: "otro", //    Pasar máquina en calle
  148: "otro", //    Reparación o construcción de cordón cuneta
};

export interface OpcionesBarridoAc {
  /** Último id ya importado: el barrido arranca en el siguiente. */
  desdeId: number;
  /** Cuántos ids consultar como máximo por corrida (tope de tiempo). */
  lote?: number;
  /** Consultas en paralelo. */
  concurrencia?: number;
  /** Ids vacíos consecutivos que se toman como "fin de la secuencia". */
  vaciosParaCortar?: number;
}

export interface AdaptadorAc extends AdaptadorFuente {
  /** Último id efectivamente consultado, para dejarlo en el log de la corrida. */
  ultimoIdVisto: number;
  /** Ids que existían pero no eran de pavimento (descartados). */
  descartados: number;
  /** Ids del tramo que existían (de cualquier categoría). En 0 significa que se
   *  pasó del final de la secuencia: quien itera debe detenerse. */
  existentes: number;
  /** Consultas que fallaron. Un id que falla NO es un id vacío: si se confunden,
   *  el barrido corta antes de tiempo y saltea reclamos reales en silencio. */
  fallos: Array<{ id: number; error: string }>;
}

/** Un id: devuelve el reclamo, o null si no existe. */
async function traerPorId(baseUrl: string, id: number): Promise<ReclamoAc | null> {
  const cuerpo = await postJsonSmt<unknown>(new URL("/reclamos/traerReclamoPorID", baseUrl), {
    idreclamo: id,
  });
  // Devuelve un array (join con movimientos): la primera fila trae los datos del
  // reclamo. Array vacío = ese id no existe.
  const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  const primera = filas[0];
  if (primera == null) return null;
  const parseado = reclamoAcSchema.safeParse(primera);
  return parseado.success ? parseado.data : null;
}

export function crearAdaptadorAtencionCiudadana(
  baseUrl: string,
  opciones: OpcionesBarridoAc,
): AdaptadorAc {
  const lote = Math.max(1, opciones.lote ?? 200);
  const concurrencia = Math.max(1, opciones.concurrencia ?? 8);
  const vaciosParaCortar = Math.max(1, opciones.vaciosParaCortar ?? 25);

  const adaptador: AdaptadorAc = {
    sistema: "atencion_ciudadana",
    ultimoIdVisto: opciones.desdeId,
    descartados: 0,
    existentes: 0,
    fallos: [],

    /**
     * El parámetro `desde` se ignora a propósito: la API no filtra por fecha.
     * El avance es por id y el cursor lo aporta quien construye el adaptador.
     */
    async traerDemandas(): Promise<DemandaNormalizada[]> {
      if (!baseUrl) throw new Error("Falta CIMBA_API_ATENCION_CIUDADANA");
      const demandas: DemandaNormalizada[] = [];
      let vaciosSeguidos = 0;
      let consultados = 0;
      let id = opciones.desdeId + 1;

      while (consultados < lote && vaciosSeguidos < vaciosParaCortar) {
        const tanda: number[] = [];
        for (let k = 0; k < concurrencia && consultados + k < lote; k++) tanda.push(id + k);
        const resultados = await Promise.all(
          tanda.map(async (n) => {
            try {
              return { n, reclamo: await traerPorId(baseUrl, n), fallo: null as string | null };
            } catch (e) {
              // "fetch failed" de undici no dice nada: la razón real vive en cause.
              const causa = e instanceof Error && e.cause ? ` (${String((e.cause as { message?: string }).message ?? e.cause)})` : "";
              return { n, reclamo: null, fallo: (e instanceof Error ? e.message : String(e)) + causa };
            }
          }),
        );
        // Se procesa en orden para que "vacíos consecutivos" signifique eso.
        for (const { n, reclamo, fallo } of resultados) {
          consultados++;
          adaptador.ultimoIdVisto = n;
          if (fallo) {
            // No cuenta como vacío: el id puede existir y no haberse podido leer.
            if (adaptador.fallos.length < 20) adaptador.fallos.push({ id: n, error: fallo });
            continue;
          }
          if (!reclamo) {
            vaciosSeguidos++;
            continue;
          }
          vaciosSeguidos = 0;
          adaptador.existentes++;
          const esPavimento =
            reclamo.id_categoria === CATEGORIA_CALLES_AC &&
            (reclamo.id_treclamo == null || TIPOS_PAVIMENTO_AC.has(reclamo.id_treclamo));
          if (!esPavimento) {
            adaptador.descartados++;
            continue;
          }
          try {
            demandas.push(mapearReclamoAc(reclamo));
          } catch {
            adaptador.descartados++;
          }
        }
        id += tanda.length;
      }
      return demandas;
    },
  };
  return adaptador;
}

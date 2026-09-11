import { z } from "zod";

/**
 * TRES FORMAS DE MEDIR EL MISMO BACHE.
 *
 * El formulario pedía ancho × largo × espesor, y eso da por sentado que el
 * bache es un rectángulo. No lo es: son manchas irregulares, y el capataz
 * termina inventando dos números que multiplicados den lo que él sabe que
 * tapó. Un dato inventado es peor que un dato menos preciso — y encima es el
 * dato con el que se certifica el pago.
 *
 * Ahora se carga por donde se pueda medir de verdad:
 *
 *   lados      ancho × largo × espesor   el rectángulo de siempre
 *   superficie m² medidos + espesor      "esto es como media cancha de tejo"
 *   volumen    m³ de mezcla + espesor    lo que bajó del camión
 *
 * Las tres terminan en los MISMOS dos números que guarda la base —superficie
 * y espesor— porque `orden_items.volumen_m3` es una columna generada
 * (superficie × espesor / 100) y no se puede escribir directo. O sea: son tres
 * puertas al mismo triángulo, se entra por los dos lados que se conocen.
 *
 * Qué puerta se usó QUEDA GUARDADO (`metadata.medicion`), y no es un detalle:
 * una superficie sacada del volumen de mezcla es una estimación, no una
 * medición. Quien firma el acta de medición conjunta tiene derecho a saber
 * cuál está mirando.
 */

export const MEDICIONES = ["lados", "superficie", "volumen"] as const;
export type Medicion = (typeof MEDICIONES)[number];

export const ETIQUETA_MEDICION: Record<Medicion, string> = {
  lados: "Ancho × largo",
  superficie: "Superficie",
  volumen: "Volumen de mezcla",
};

/** La ayuda que va debajo de cada opción, en el idioma de la calle. */
export const AYUDA_MEDICION: Record<Medicion, string> = {
  lados: "El bache entra en un rectángulo y lo podés medir con la cinta.",
  superficie: "Sabés cuántos m² tapaste pero no es un rectángulo.",
  volumen: "Solo sabés cuánta mezcla usaste. La superficie se calcula sola.",
};

/**
 * Los campos que viajan en el FormData. Todos opcionales acá: cuál es
 * obligatorio depende del modo, y eso lo resuelve `validarMedicion`.
 */
export const camposMedicion = {
  medicion: z.enum(MEDICIONES).default("lados"),
  anchoM: z.coerce.number().positive().max(50).optional(),
  largoM: z.coerce.number().positive().max(2000).optional(),
  /** Un paño de carpeta puede ser grande; el tope corta el error de tipeo. */
  superficieM2: z.coerce.number().positive().max(100_000).optional(),
  volumenM3: z.coerce.number().positive().max(5_000).optional(),
  espesorCm: z.coerce.number().positive().max(60),
};

export interface MedidaResuelta {
  superficieM2: number;
  espesorCm: number;
  /** Solo cuando se midió por lados: en los otros modos no existen y NO se
   *  inventan — una tabla con "— × — m" dice la verdad. */
  anchoM: number | null;
  largoM: number | null;
  medicion: Medicion;
}

/**
 * De lo que cargó el capataz a los dos números que guarda la base. Tira
 * ErrorVisible-compatible (un Error con mensaje para leer) si falta el dato
 * del modo elegido: el cliente valida igual, esto es la red de atrás.
 */
export function resolverMedicion(d: {
  medicion: Medicion;
  anchoM?: number;
  largoM?: number;
  superficieM2?: number;
  volumenM3?: number;
  espesorCm: number;
}): MedidaResuelta {
  const redondear = (n: number) => Math.round(n * 100) / 100;

  if (d.medicion === "lados") {
    if (!d.anchoM || !d.largoM) throw new Error("Faltan el ancho y el largo");
    return {
      superficieM2: redondear(d.anchoM * d.largoM),
      espesorCm: d.espesorCm,
      anchoM: d.anchoM,
      largoM: d.largoM,
      medicion: "lados",
    };
  }

  if (d.medicion === "superficie") {
    if (!d.superficieM2) throw new Error("Falta la superficie en m²");
    return {
      superficieM2: redondear(d.superficieM2),
      espesorCm: d.espesorCm,
      anchoM: null,
      largoM: null,
      medicion: "superficie",
    };
  }

  if (!d.volumenM3) throw new Error("Falta el volumen de mezcla en m³");
  /**
   * m³ ÷ (cm ÷ 100) = m². El espesor sigue siendo obligatorio justamente por
   * esto: sin él, el volumen no se puede convertir a la superficie que es la
   * unidad con la que se certifica.
   */
  return {
    superficieM2: redondear(d.volumenM3 / (d.espesorCm / 100)),
    espesorCm: d.espesorCm,
    anchoM: null,
    largoM: null,
    medicion: "volumen",
  };
}

/** El volumen que sale de la superficie y el espesor, para mostrarlo en vivo
 *  mientras se carga (en la base lo calcula la columna generada). */
export const volumenDe = (superficieM2: number, espesorCm: number) =>
  Math.round(superficieM2 * (espesorCm / 100) * 100) / 100;

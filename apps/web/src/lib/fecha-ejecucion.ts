import { sql } from "@cimba/db";
import { z } from "zod";
import { ErrorVisible } from "./errores";
import { hoyISO } from "./formato";

/**
 * LA FECHA EN QUE SE HIZO EL TRABAJO, QUE NO ES LA FECHA EN QUE SE CARGA.
 *
 * Todo el sistema escribía `now()` en `iniciada_en`, `finalizada_en` y
 * `reportado_en`: el trabajo quedaba fechado el día en que alguien tuvo tiempo
 * de sentarse a cargarlo. En la Dirección de Bacheo eso es casi nunca el mismo
 * día — la cuadrilla manda las fotos por WhatsApp y la carga se hace después,
 * a veces una semana después. El resultado era un parte diario que decía que
 * el lunes no se bacheó nada y el jueves se bachearon cuatro días juntos, y un
 * acta de medición con fechas que no coincidían con las del remito.
 *
 * Con esto, quien carga puede decir QUÉ DÍA fue. Sin decirlo, sigue siendo hoy:
 * la carga del mismo día —que es la deseable— no cambia en nada.
 */

/** El campo, para sumar a un schema de zod. */
export const campoFechaEjecucion = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de ejecución tiene que ser un día del calendario")
  .optional();

/**
 * Valida la fecha y la convierte en el instante que se guarda.
 *
 * Dos límites, los dos necesarios:
 *  - NO puede ser futura: sería certificar trabajo que todavía no pasó.
 *  - NO puede ser anterior a `desde` (la emisión de la orden, el alta del
 *    incidente): una fecha antes de que el trabajo existiera es un error de
 *    tipeo, y con el acta firmada arriba es un error caro.
 *
 * Se ancla al MEDIODÍA de Tucumán y no a la medianoche: guardado como
 * timestamptz, un '2026-09-15 00:00' local es '2026-09-15 03:00Z', y cualquier
 * consulta que agrupe por día en UTC lo mandaría al día anterior o al
 * siguiente según el signo. Al mediodía no hay corrimiento que lo mueva de día.
 */
const TZ = "America/Argentina/Tucuman";

export function instanteEjecucion(
  fecha: string | undefined,
  desde?: { fecha: string | null; que: string },
) {
  if (!fecha) return sql`now()`;
  const hoy = hoyISO();
  if (fecha > hoy) throw new ErrorVisible("La fecha de ejecución no puede ser posterior a hoy");
  if (desde?.fecha && fecha < desde.fecha) {
    throw new ErrorVisible(`La fecha de ejecución no puede ser anterior a ${desde.que} (${desde.fecha})`);
  }
  return sql`((${fecha}::date + time '12:00') at time zone ${TZ})`;
}

/* El piso del calendario (minimoEjecucion) vive en lib/formato.ts: lo necesita
   el formulario, que es cliente, y este módulo toca la base. */

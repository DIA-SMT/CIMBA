/**
 * LOS MENSAJES DE ERROR TIENEN QUE LLEGAR AL USUARIO.
 *
 * EL PROBLEMA. En una build de producción, React BORRA el mensaje de
 * cualquier error lanzado del lado del servidor antes de mandarlo al
 * navegador, y lo reemplaza por este párrafo:
 *
 *   "An error occurred in the Server Components render. The specific message
 *    is omitted in production builds to avoid leaking sensitive details."
 *
 * Es una protección razonable —un stack trace o un error de Postgres no
 * tienen por qué viajar al cliente— pero se lleva puestos también los 89
 * mensajes que este sistema escribe A PROPÓSITO para que los lea una persona:
 * "Este item ya fue reportado", "La orden no está activa", "El reclamo
 * original ya no está vigente: refrescá la bandeja". En desarrollo se ven
 * perfecto, y por eso nadie lo notó: el capataz en la calle veía un párrafo
 * en inglés hablando de digests.
 *
 * LA SALIDA. React sí deja pasar intacta la propiedad `digest` del error, y
 * Next respeta el digest que ya venga puesto en vez de generar el suyo
 * (create-error-handler.js: "If the error already has a digest, respect the
 * original digest"). Entonces el mensaje viaja ahí, con una marca adelante
 * para poder distinguirlo de un digest normal.
 *
 * CUÁNDO USARLO. `ErrorVisible` es para los errores que ESTÁN ESCRITOS PARA
 * QUE ALGUIEN LOS LEA. Un error inesperado (una caída de Postgres, un bug)
 * tiene que seguir siendo un Error común: que React lo tape es exactamente lo
 * que se quiere. La regla práctica: si el texto está en español y le habla a
 * una persona, va ErrorVisible.
 */

const MARCA = "CIMBA_MSG:";

export class ErrorVisible extends Error {
  /** React no lo borra, y Next no lo pisa si ya viene puesto. */
  digest: string;

  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorVisible";
    this.digest = MARCA + mensaje;
  }
}

/**
 * Lo que hay que mostrar en pantalla, del lado del cliente.
 *
 * Busca en este orden: el mensaje que viajó en el digest (producción), el
 * mensaje del Error (desarrollo, y cualquier error lanzado en el propio
 * cliente), y por último el texto por defecto de quien llama — que es el que
 * corresponde cuando el error NO era para mostrar.
 */
export function mensajeDeError(e: unknown, porDefecto: string): string {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith(MARCA)) {
    return digest.slice(MARCA.length);
  }
  if (esFalloDeRed(e)) return MENSAJE_RED;
  if (e instanceof Error && e.message) {
    // En producción esto es el párrafo de React, que no sirve para nadie.
    if (e.message.startsWith("An error occurred in the Server Components render")) {
      return porDefecto;
    }
    return e.message;
  }
  return porDefecto;
}

export const MENSAJE_RED =
  "Se cortó la conexión antes de que llegara la respuesta. No se hizo nada: probá de nuevo.";

/**
 * SE CORTÓ LA RED, NO SE ROMPIÓ EL SISTEMA.
 *
 * Cuando una server action se va por la red —wifi que salta a datos móviles,
 * DNS que no resuelve, el túnel de la oficina— el navegador tira un
 * `TypeError: Failed to fetch` y Next lo propaga como si fuera el error de la
 * acción. La pantalla mostraba entonces "No se pudo recalcular" / "Error", y
 * quien lo leía concluía razonablemente que la función estaba rota: pasó
 * exactamente eso con el recálculo del IPI, que del lado del servidor tarda
 * 0,4 segundos y no falla nunca.
 *
 * Distinguirlo importa por una razón práctica: ante un error del sistema no
 * hay nada que hacer, pero ante un corte de red la acción se reintenta y
 * anda. Y decir "no se hizo nada" también importa — sin eso, nadie se anima a
 * reintentar una acción que escribe.
 */
export function esFalloDeRed(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!(e instanceof Error)) return false;
  const m = `${e.name}: ${e.message}`.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network request failed") ||
    m.includes("load failed") || // Safari
    m.includes("err_name_not_resolved") ||
    m.includes("err_network_changed") ||
    m.includes("err_internet_disconnected") ||
    m.includes("err_connection")
  );
}

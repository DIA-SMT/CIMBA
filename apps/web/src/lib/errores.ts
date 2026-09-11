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
  if (e instanceof Error && e.message) {
    // En producción esto es el párrafo de React, que no sirve para nadie.
    if (e.message.startsWith("An error occurred in the Server Components render")) {
      return porDefecto;
    }
    return e.message;
  }
  return porDefecto;
}

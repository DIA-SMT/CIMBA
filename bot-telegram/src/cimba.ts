/**
 * El cliente contra CIMBA. Es lo único de este bot que no existía antes.
 *
 * CIMBA corre en Vercel y este proceso en la VPS: la pregunta sale de acá y la
 * identidad la resuelve allá. Este módulo no sabe quién es nadie — manda el id
 * del chat y CIMBA decide si está habilitado y con qué permisos contesta. Esa
 * es la razón por la que el bot no tiene credenciales de la base.
 */

/** El asistente puede dar hasta cinco vueltas de consultas: 60 s es el techo
 *  de la función del otro lado, y esperar un poco más acá evita cortar una
 *  respuesta que ya estaba lista. */
const ESPERA_MS = 70_000;

export interface Turno {
  rol: "usuario" | "migue";
  contenido: string;
}

export type Salida<T> = { ok: true; datos: T } | { ok: false; texto: string };

export type Respuesta =
  | { ok: true; texto: string; herramientas: string[] }
  | { ok: false; texto: string; reintentable: boolean };

export interface ConfigCimba {
  baseUrl: string;
  secreto: string;
}

export async function preguntarACimba(
  config: ConfigCimba,
  chatId: number,
  historial: Turno[],
): Promise<Respuesta> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/api/auth/telegram`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secreto}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ chatId: String(chatId), mensajes: historial }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (e) {
    // Sin red, o CIMBA tardó más de lo que esperamos. No se reintenta solo:
    // cada pregunta cuesta plata en el modelo, y un reintento a ciegas la
    // duplica sin que nadie lo pida.
    const agotado = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      reintentable: true,
      texto: agotado
        ? "La consulta tardó demasiado. Probá con una pregunta más acotada."
        : "No pude comunicarme con CIMBA. Probá de nuevo en un momento.",
    };
  }

  const cuerpo = (await res.json().catch(() => null)) as
    | { respuesta?: string; herramientas?: string[]; error?: string }
    | null;

  if (res.ok && cuerpo?.respuesta) {
    return { ok: true, texto: cuerpo.respuesta, herramientas: cuerpo.herramientas ?? [] };
  }

  // 401 es un problema de configuración entre este bot y CIMBA, no algo que la
  // persona pueda resolver: se le dice que avise, y el detalle va al registro.
  if (res.status === 401) {
    return {
      ok: false,
      reintentable: false,
      texto: "Este bot no está bien configurado contra CIMBA. Avisale a la Dirección de IA.",
    };
  }
  // 403 lo redacta CIMBA, que es quien sabe por qué: chat sin vincular, vínculo
  // revocado, persona dada de baja o rol sin permiso.
  if (res.status === 403 && cuerpo?.error) {
    return { ok: false, reintentable: false, texto: cuerpo.error };
  }
  return {
    ok: false,
    reintentable: true,
    texto: cuerpo?.error ?? `CIMBA respondió con un error (${res.status}).`,
  };
}

/**
 * Una llamada a una de las puertas del bot en CIMBA.
 *
 * Todas tienen la misma forma —secreto, chat, cuerpo— y devuelven o el dato o
 * un texto ya listo para mostrarle a la persona. Cuando CIMBA manda un motivo
 * propio se usa ese: sus mensajes están escritos para que los lea alguien ("La
 * orden ya estaba cerrada", "UOCRA está dada de baja") y son mejores que
 * cualquier cosa que pudiéramos inventar de este lado.
 */
export async function pedirA<T>(
  config: ConfigCimba,
  chatId: number,
  ruta: string,
  cuerpo: Record<string, unknown>,
): Promise<Salida<T>> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/api/auth/telegram/${ruta}`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.secreto}`, "content-type": "application/json" },
      body: JSON.stringify({ chatId: String(chatId), ...cuerpo }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, texto: "No pude comunicarme con CIMBA. Probá de nuevo en un momento." };
  }
  const datos = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    return { ok: false, texto: datos?.error ?? `CIMBA respondió con un error (${res.status}).` };
  }
  return { ok: true, datos: datos as T };
}

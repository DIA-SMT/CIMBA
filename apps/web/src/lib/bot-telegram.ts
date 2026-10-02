import "server-only";
import type { NextRequest } from "next/server";
import type { Sesion } from "@/lib/auth";
import { perfilPorChatTelegram } from "@/lib/perfiles";

/**
 * Los dos primeros candados de todas las puertas del bot, en un solo lugar.
 *
 * El tercero —el rol— lo pone cada ruta, porque no es el mismo: preguntar y
 * resolver un bache propuesto no exigen lo mismo, y escribirlo en cada una
 * obliga a decidirlo a conciencia en vez de heredarlo sin mirar.
 */

export type Identificacion =
  | { ok: true; sesion: Sesion }
  | { ok: false; status: 401 | 403; error: string };

export async function identificarChat(req: NextRequest, chatId: string): Promise<Identificacion> {
  /* Estas rutas cuelgan de /api/auth, que el middleware deja pasar sin sesión
     (es por donde se entra). O sea que este chequeo es lo único que las
     protege. Se valida que la variable EXISTA antes de comparar: el patrón de
     cron/vencimientos, no el de sync, que sin la env compara contra la cadena
     literal "Bearer undefined" y queda abierta. */
  const secreto = process.env.CIMBA_BOT_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return { ok: false, status: 401, error: "no autorizado" };
  }

  const perfil = await perfilPorChatTelegram(chatId);
  if (!perfil) {
    return {
      ok: false,
      status: 403,
      error: "Este chat no está habilitado en CIMBA. Pedile a la Dirección que lo vincule.",
    };
  }

  return {
    ok: true,
    sesion: {
      sub: perfil.id,
      rol_cimba: perfil.rol,
      id_persona: perfil.id_persona,
      nombre: perfil.nombre,
    },
  };
}

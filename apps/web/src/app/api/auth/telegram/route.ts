import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirRol, type Sesion } from "@/lib/auth";
import { iaDisponible } from "@/lib/ia";
import { conversarConMigue } from "@/lib/migue-conversar";
import { marcarUsoTelegram, perfilPorChatTelegram } from "@/lib/perfiles";
import { mensajeDeError } from "@/lib/errores";

export const maxDuration = 60;

/**
 * La puerta del bot de Telegram.
 *
 * El bot corre afuera, en una VPS, y NO se conecta a esta base: manda el chat
 * que escribió y el texto, y CIMBA resuelve todo lo demás. Tres candados, en
 * este orden:
 *
 *  1. El secreto compartido. Esta ruta cuelga de /api/auth, que el middleware
 *     deja pasar sin sesión (es donde se entra), así que el chequeo de acá
 *     adentro es lo único que la protege. Se valida que la variable EXISTA
 *     antes de comparar: el patrón de /api/cron/vencimientos, no el de
 *     /api/sync, que sin la env compara contra "Bearer undefined".
 *  2. Quién escribe. El chat se traduce a una persona del padrón; si no está
 *     vinculado, o el vínculo fue revocado, o la persona está desactivada, no
 *     hay sesión que armar y el bot recibe un 403.
 *  3. Qué puede hacer. El rol se chequea con la MISMA función que usan las
 *     pantallas. Y por ahora esta puerta expone una sola operación —preguntar,
 *     con herramientas de solo lectura—, así que ni siquiera un admin puede
 *     escribir nada por acá. Eso es deliberado: el bot ofrece una lista fija
 *     de operaciones, no "todo lo que tu rol permita".
 */

const entradaSchema = z.object({
  // Telegram manda enteros; viaja como string para no perder precisión.
  chatId: z.string().regex(/^\d{1,20}$/),
  mensajes: z
    .array(z.object({ rol: z.enum(["usuario", "migue"]), contenido: z.string().min(1).max(4000) }))
    .min(1)
    .max(30),
});

/** Los roles que pueden preguntarle al bot. Sin 'empresa': son externos. */
const ROLES_BOT = ["planificacion", "supervision", "atencion_ciudadana", "informacion_estrategica"] as const;

export async function POST(req: NextRequest) {
  const secreto = process.env.CIMBA_BOT_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const cuerpo = entradaSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });

  const perfil = await perfilPorChatTelegram(cuerpo.data.chatId);
  if (!perfil) {
    return NextResponse.json(
      { error: "Este chat no está habilitado en CIMBA. Pedile a la Dirección que lo vincule." },
      { status: 403 },
    );
  }

  const sesion: Sesion = {
    sub: perfil.id,
    rol_cimba: perfil.rol,
    id_persona: perfil.id_persona,
    nombre: perfil.nombre,
  };

  try {
    exigirRol(sesion, ...ROLES_BOT);
  } catch {
    return NextResponse.json(
      { error: `Tu rol en CIMBA (${perfil.rol}) no tiene habilitado el bot.` },
      { status: 403 },
    );
  }

  if (!iaDisponible()) return NextResponse.json({ error: "IA no configurada" }, { status: 501 });

  try {
    const r = await conversarConMigue(sesion, cuerpo.data.mensajes);
    await marcarUsoTelegram(cuerpo.data.chatId);
    // accionMapa no significa nada en Telegram: no hay mapa del otro lado.
    return NextResponse.json({ respuesta: r.respuesta, herramientas: r.herramientas, nombre: perfil.nombre });
  } catch (e) {
    return NextResponse.json({ error: mensajeDeError(e, "No pude responder") }, { status: 502 });
  }
}

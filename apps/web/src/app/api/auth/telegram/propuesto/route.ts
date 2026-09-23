import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirRol } from "@/lib/auth";
import { identificarChat } from "@/lib/bot-telegram";
import { resolverPropuestoConSesion } from "@/lib/acciones-ordenes";
import { propuestoParaResolver } from "@/lib/ordenes";
import { mensajeDeError } from "@/lib/errores";

export const maxDuration = 30;

/**
 * Resolver un bache propuesto desde Telegram.
 *
 * Quién puede: planificación y supervisión, lo mismo que exige la acción en la
 * pantalla. Es el ÚNICO camino de escritura que el bot tiene hoy: el resto de
 * las acciones de CIMBA no están expuestas, y eso es deliberado — la puerta
 * ofrece una lista fija de operaciones, no todo lo que el rol permita.
 *
 * Dos pasos, no uno. `ver` devuelve qué se está por resolver, incluido si ese
 * propuesto trae medidas; `validar` o `rechazar` ejecutan. El bot usa el
 * primero para pedir una segunda confirmación cuando validar significa
 * habilitar una certificación — que es plata y no se deshace desde CIMBA.
 */

const entradaSchema = z.object({
  chatId: z.string().regex(/^\d{1,20}$/),
  itemId: z.number().int().positive(),
  accion: z.enum(["ver", "validar", "rechazar"]),
  motivo: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const cuerpo = entradaSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });

  const quien = await identificarChat(req, cuerpo.data.chatId);
  if (!quien.ok) return NextResponse.json({ error: quien.error }, { status: quien.status });

  try {
    exigirRol(quien.sesion, "planificacion", "supervision");
  } catch {
    return NextResponse.json(
      { error: `Tu rol en CIMBA (${quien.sesion.rol_cimba}) no resuelve baches propuestos.` },
      { status: 403 },
    );
  }

  if (cuerpo.data.accion === "ver") {
    const propuesto = await propuestoParaResolver(quien.sesion, cuerpo.data.itemId);
    if (!propuesto) {
      return NextResponse.json({ error: "Ese bache ya no está propuesto: lo resolvió alguien antes." }, { status: 409 });
    }
    return NextResponse.json({ propuesto });
  }

  try {
    const r = await resolverPropuestoConSesion(quien.sesion, {
      itemId: cuerpo.data.itemId,
      decision: cuerpo.data.accion,
      ...(cuerpo.data.motivo ? { motivo: cuerpo.data.motivo } : {}),
    });
    return NextResponse.json(r);
  } catch (e) {
    /* La acción se blinda sola contra el doble toque: el UPDATE lleva
       `and estado = 'propuesto'` y lanza si no tocó ninguna fila. Con los
       reintentos de Telegram eso importa más que cualquier otra cosa, así que
       el mensaje de esa falla se devuelve tal cual: dice que ya se resolvió. */
    return NextResponse.json({ error: mensajeDeError(e, "No se pudo resolver") }, { status: 409 });
  }
}

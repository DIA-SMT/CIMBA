import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirRol } from "@/lib/auth";
import { identificarChat } from "@/lib/bot-telegram";
import { pendientesDe } from "@/lib/ordenes";
import { marcarUsoTelegram } from "@/lib/perfiles";
import { mensajeDeError } from "@/lib/errores";

export const maxDuration = 30;

/**
 * La bandeja: todo lo que espera una decisión de quien escribe.
 *
 * Quién puede: planificación y supervisión, los mismos que resuelven un bache
 * propuesto. No tiene sentido mostrarle a alguien una lista de decisiones que
 * después no va a poder tomar.
 *
 * Es de solo lectura. Las decisiones se toman con los botones, que van por la
 * otra puerta.
 */

const entradaSchema = z.object({
  chatId: z.string().regex(/^\d{1,20}$/),
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
      { error: `Tu rol en CIMBA (${quien.sesion.rol_cimba}) no tiene bandeja de decisiones.` },
      { status: 403 },
    );
  }

  try {
    const pendientes = await pendientesDe(quien.sesion);
    await marcarUsoTelegram(cuerpo.data.chatId);
    return NextResponse.json(pendientes);
  } catch (e) {
    return NextResponse.json({ error: mensajeDeError(e, "No pude leer los pendientes") }, { status: 502 });
  }
}

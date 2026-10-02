import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirRol } from "@/lib/auth";
import { identificarChat } from "@/lib/bot-telegram";
import { cerrarOrdenConSesion, reasignarOrdenConSesion } from "@/lib/acciones-ordenes";
import { ordenParaDecidir } from "@/lib/ordenes";
import { mensajeDeError } from "@/lib/errores";

export const maxDuration = 30;

/**
 * Cerrar o reasignar una orden desde Telegram.
 *
 * Quién puede: planificación, que es lo que exigen las dos acciones en la
 * pantalla. Supervisión NO, aunque sí resuelve baches propuestos: no es un
 * descuido, es lo que dicen las acciones y acá no se aflojan.
 *
 * `ver` devuelve lo necesario para decidir —a quién es, qué le queda pendiente,
 * y a qué empresas se puede pasar— y los dos verbos ejecutan. La lista de
 * empresas sale de la misma función que usa el alta, así que no se puede
 * ofrecer una que después la acción rechace.
 */

const entradaSchema = z.object({
  chatId: z.string().regex(/^\d{1,20}$/),
  ordenId: z.number().int().positive(),
  accion: z.enum(["ver", "cerrar", "reasignar"]),
  empresaId: z.number().int().positive().optional(),
  motivo: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const cuerpo = entradaSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });

  const quien = await identificarChat(req, cuerpo.data.chatId);
  if (!quien.ok) return NextResponse.json({ error: quien.error }, { status: quien.status });

  try {
    exigirRol(quien.sesion, "planificacion");
  } catch {
    return NextResponse.json(
      { error: `Tu rol en CIMBA (${quien.sesion.rol_cimba}) no cierra ni reasigna órdenes.` },
      { status: 403 },
    );
  }

  if (cuerpo.data.accion === "ver") {
    const orden = await ordenParaDecidir(quien.sesion, cuerpo.data.ordenId);
    if (!orden) return NextResponse.json({ error: "Esa orden no existe." }, { status: 404 });
    return NextResponse.json({ orden });
  }

  try {
    if (cuerpo.data.accion === "cerrar") {
      const r = await cerrarOrdenConSesion(quien.sesion, { ordenId: cuerpo.data.ordenId });
      return NextResponse.json(r);
    }
    if (cuerpo.data.empresaId == null) {
      return NextResponse.json({ error: "Falta a qué empresa pasarla." }, { status: 400 });
    }
    const r = await reasignarOrdenConSesion(quien.sesion, {
      ordenId: cuerpo.data.ordenId,
      empresaId: cuerpo.data.empresaId,
      ...(cuerpo.data.motivo ? { motivo: cuerpo.data.motivo } : {}),
    });
    return NextResponse.json(r);
  } catch (e) {
    /* Las dos acciones validan con ErrorVisible y sus mensajes están escritos
       para que los lea una persona ("La orden ya estaba cerrada", "UOCRA está
       dada de baja"). Se devuelven tal cual: son mejores que cualquier cosa
       que pudiéramos escribir acá. */
    return NextResponse.json({ error: mensajeDeError(e, "No se pudo") }, { status: 409 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb, sql } from "@cimba/db";
import { mensajeDeError } from "@/lib/errores";

export const maxDuration = 15;

/**
 * Canjear un código por un vínculo: así se habilita un chat de Telegram.
 *
 * Es la ÚNICA puerta del bot que no exige un chat ya vinculado — no podría,
 * porque es la que lo crea. Lo que la protege es el código: lo emite alguien
 * de adentro desde la pantalla de Configuración, vive 15 minutos y se usa una
 * sola vez. Más el secreto compartido, como todas las demás.
 *
 * Se compara contra el hash y nunca contra el código guardado, por la misma
 * razón que las claves: en claro es una llave para actuar como esa persona.
 */

const entradaSchema = z.object({
  chatId: z.string().regex(/^\d{1,20}$/),
  codigo: z.string().min(6).max(40),
  usuario: z.string().max(64).optional(),
  nombre: z.string().max(120).optional(),
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function POST(req: NextRequest) {
  const secreto = process.env.CIMBA_BOT_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const cuerpo = entradaSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });

  const { chatId, codigo, usuario, nombre } = cuerpo.data;
  /* Se normaliza igual que al emitirlo: el código se dicta por teléfono o se
     copia de un mensaje, así que llega con mayúsculas o espacios de más más
     seguido de lo que uno cree. */
  const limpio = codigo.trim().toLowerCase().replace(/\s+/g, "");

  try {
    const db = getDb();

    /* Un chat pertenece a UNA persona. Si ya está vinculado a otra, no se
       cambia en silencio: eso haría que las decisiones de alguien aparezcan a
       nombre de otro. Hay que revocarlo primero, a conciencia. */
    const ocupado = (await db.execute(sql`
      select p.nombre from telegram_vinculos v join perfiles p on p.id = v.perfil_id
      where v.chat_id = ${chatId} and v.revocado_en is null
    `)) as unknown as Array<{ nombre: string }>;
    if (ocupado[0]) {
      return NextResponse.json(
        { error: `Este chat ya está vinculado a ${ocupado[0].nombre}. Para cambiarlo hay que revocarlo primero desde CIMBA.` },
        { status: 409 },
      );
    }

    const filas = (await db.execute(sql`
      update telegram_codigos set usado_en = now(), usado_chat_id = ${chatId}
      where codigo_hash = ${sha256(limpio)} and usado_en is null and expira_en > now()
      returning perfil_id
    `)) as unknown as Array<{ perfil_id: string }>;
    const canje = filas[0];
    if (!canje) {
      /* Un solo mensaje para "no existe", "ya se usó" y "venció": distinguirlos
         le diría a quien prueba códigos cuál de las tres pasó. */
      return NextResponse.json(
        { error: "Ese código no sirve: puede estar vencido, ya usado, o mal copiado. Pedí uno nuevo." },
        { status: 403 },
      );
    }

    const perfil = (await db.execute(sql`
      select nombre, rol::text as rol, activo from perfiles where id = ${canje.perfil_id}::uuid
    `)) as unknown as Array<{ nombre: string; rol: string; activo: boolean }>;
    if (!perfil[0]?.activo) {
      return NextResponse.json({ error: "Esa persona está dada de baja en CIMBA." }, { status: 403 });
    }

    await db.execute(sql`
      insert into telegram_vinculos (perfil_id, chat_id, usuario_telegram, nombre_telegram, vinculado_por)
      values (${canje.perfil_id}::uuid, ${chatId}, ${usuario ?? null}, ${nombre ?? null}, ${canje.perfil_id}::uuid)
    `);

    return NextResponse.json({ ok: true, nombre: perfil[0].nombre, rol: perfil[0].rol });
  } catch (e) {
    return NextResponse.json({ error: mensajeDeError(e, "No se pudo vincular") }, { status: 500 });
  }
}

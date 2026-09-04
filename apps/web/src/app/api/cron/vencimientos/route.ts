import { NextResponse, type NextRequest } from "next/server";
import { getDb, sql } from "@cimba/db";
import { notificarRoles } from "@/lib/push";

export const maxDuration = 60;

/**
 * Aviso diario de vencimientos de órdenes de trabajo — "a vos te puedo hacer
 * que te surjan alertas del vencimiento". Corre por cron de Vercel; manda un
 * push al personal de planificación/supervisión por cada orden activa vencida
 * o que vence HOY, una sola vez por día por orden (marca en metadata).
 *
 * Igual que /api/sync: se autentica con CRON_SECRET, no con sesión.
 */
export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const db = getDb();
  const ordenes = (await db.execute(sql`
    select ot.id, ot.numero, ot.vence_en::text as vence, e.nombre as empresa,
      (select count(*) from orden_items oi where oi.orden_id = ot.id and oi.estado = 'pendiente')::int as pendientes
    from ordenes_trabajo ot
    join empresas e on e.id = ot.empresa_id
    where ot.estado in ('emitida', 'en_ejecucion')
      and ot.vence_en is not null
      and ot.vence_en <= current_date
      and coalesce(ot.metadata->>'aviso_vencimiento', '') <> current_date::text
  `)) as unknown as Array<{ id: number; numero: string; vence: string; empresa: string; pendientes: number }>;

  let avisadas = 0;
  for (const o of ordenes) {
    const vencida = o.vence < new Date().toISOString().slice(0, 10);
    await notificarRoles(["planificacion", "supervision", "admin"], {
      titulo: vencida ? `⚠ ${o.numero} VENCIDA` : `${o.numero} vence HOY`,
      cuerpo: `${o.empresa} · ${o.pendientes} item(s) sin reportar · vencía el ${o.vence}`,
      url: `/ordenes/${o.id}`,
    });
    await db.execute(sql`
      update ordenes_trabajo set metadata = metadata || jsonb_build_object('aviso_vencimiento', current_date::text)
      where id = ${o.id}
    `);
    avisadas++;
  }

  return NextResponse.json({ ok: true, avisadas });
}

import { NextResponse, type NextRequest } from "next/server";
import { getDb, sql } from "@cimba/db";
import { notificarEvento } from "@/lib/notificar";
import { datosPulso, emailDelPulso, guardarFotoDeuda, pushDelPulso } from "@/lib/pulso";

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

  // ── Cierres pendientes: el empujón diario ──────────────────────────────
  // Reclamos abiertos vinculados a un incidente YA reparado: el trabajo está,
  // falta responderle al vecino. Un solo aviso por día (marca en parametros),
  // solo si hay algo para cerrar.
  const hoy = new Date().toISOString().slice(0, 10);
  const cerrables = (await db.execute(sql`
    select count(distinct d.id)::int as n
    from demandas d
    join demanda_incidente di on di.demanda_id = d.id
    join incidentes i on i.id = di.incidente_id
    where d.estado in ('recibida','en_validacion','vinculada')
      and i.estado in ('reparado','verificado')
  `)) as unknown as Array<{ n: number }>;
  const nCerrables = Number(cerrables[0]?.n ?? 0);
  let avisoCierres = 0;
  if (nCerrables > 0) {
    const marca = (await db.execute(sql`
      insert into parametros (clave, valor)
      values ('aviso_cierres_pendientes', jsonb_build_object('fecha', ${hoy}::text, 'n', ${nCerrables}::int))
      on conflict (clave) do update set valor = excluded.valor
      where parametros.valor->>'fecha' is distinct from ${hoy}::text
      returning clave
    `)) as unknown as Array<{ clave: string }>;
    if (marca[0]) {
      const r = await notificarEvento("cierres_pendientes", {
        titulo: `${nCerrables} reclamo(s) listos para cerrar`,
        cuerpo: "El problema ya está reparado: falta responderle al vecino y cerrar el ticket.",
        url: "/cierres",
      });
      avisoCierres = r.push + r.emails;
    }
  }

  let avisadas = 0;
  for (const o of ordenes) {
    const vencida = o.vence < new Date().toISOString().slice(0, 10);
    // A quién le llega lo decide el Director en /ordenes/avisos.
    await notificarEvento("orden_vencida", {
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

  // ── El pulso de las 7:00: el parte diario, una sola vez por día ─────────
  let pulsoEnviado = 0;
  {
    const marca = (await db.execute(sql`
      insert into parametros (clave, valor)
      values ('pulso_diario', jsonb_build_object('fecha', ${hoy}::text))
      on conflict (clave) do update set valor = excluded.valor
      where parametros.valor->>'fecha' is distinct from ${hoy}::text
      returning clave
    `)) as unknown as Array<{ clave: string }>;
    if (marca[0]) {
      const pulso = await datosPulso();
      // La foto del día ANTES de mandar nada: si el envío falla, la serie no
      // se corta. Es la única fuente de la comparación semanal del parte.
      await guardarFotoDeuda(pulso);
      const push = pushDelPulso(pulso);
      const r = await notificarEvento("pulso_diario", {
        titulo: push.titulo,
        cuerpo: push.cuerpo,
        url: "/pulso",
        cuerpoEmail: emailDelPulso(pulso),
      });
      pulsoEnviado = r.push + r.emails;
    }
  }

  return NextResponse.json({ ok: true, avisadas , cerrables: nCerrables, avisoCierres, pulsoEnviado });
}

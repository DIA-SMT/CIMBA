import { NextResponse } from "next/server";
import { conRls, sql } from "@cimba/db";
import type { FuenteDemanda, TipoProblema } from "@cimba/domain";
import { leerSesion, type Sesion } from "@/lib/auth";
import { ETIQUETA_FUENTE, ETIQUETA_TIPO } from "@/lib/formato";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * El EXPEDIENTE SAT: el CSV que Atención Ciudadana le manda a la SAT con las
 * demandas de agua/tapas/sumideros que siguen abiertas — "yo eso lo filtro y
 * genero el expediente que se va a la SAT… con dirección, tipo, y número de
 * ticket, porque si ellos lo devuelven yo lo puedo cerrar".
 *
 * El número de ticket es el id_remoto de external_ref (sistema
 * atencion_ciudadana): es la clave con la que la SAT puede devolver el caso y
 * AC lo encuentra en SU sistema. Va vacío si el pedido no vino de AC.
 *
 * Mismo formato que /api/exportar: separador ";" (convención local), BOM para
 * que Excel abra los acentos bien, y sin datos de contacto del vecino.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

function celda(v: unknown): string {
  if (v == null) return "";
  // Los números (ids, coordenadas negativas) pasan tal cual.
  if (typeof v === "number") return String(v);
  let s = String(v);
  // Neutralizar CSV injection: Excel evalúa como fórmula las celdas que
  // empiezan con = + - @ o tab (el texto viene de vecinos y archivos externos).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n']/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function csv(columnas: string[], filas: unknown[][]): string {
  const lineas = [columnas.join(";"), ...filas.map((f) => f.map(celda).join(";"))];
  return "﻿" + lineas.join("\r\n");
}

export async function GET() {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  // El expediente es de quien gestiona el circuito con la SAT: Atención
  // Ciudadana, planificación o admin. El resto de los roles, afuera.
  if (!["admin", "planificacion", "atencion_ciudadana"].includes(sesion.rol_cimba)) {
    return NextResponse.json({ error: "rol sin permiso para generar el expediente SAT" }, { status: 403 });
  }

  const filas = await conRls(claims(sesion), async (tx) => {
    return (await tx.execute(sql`
      select d.id,
             -- Subconsulta y no LEFT JOIN directo: si una demanda tuviera más
             -- de una referencia externa, el join duplicaría la fila del CSV.
             (select er.id_remoto from external_ref er
                where er.sistema = 'atencion_ciudadana'
                  and er.entidad_local = 'demanda'
                  and er.id_local = d.id
                order by er.sincronizado_en desc
                limit 1) as ticket,
             d.fuente::text as fuente,
             d.tipo::text as tipo,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             b.nombre as barrio,
             -- Fecha del pedido: vacía si el origen no la trajo (sin_fecha) —
             -- a un organismo externo no se le manda una fecha inventada.
             case when d.metadata->>'sin_fecha' = 'true' then null
                  else to_char(d.creado_en, 'YYYY-MM-DD') end as fecha_pedido
      from demandas d
      left join barrios b on b.id = d.barrio_id
      where d.destino = 'sat'
        and d.estado in ('recibida','en_validacion')
      order by d.creado_en desc
    `)) as unknown as Array<Record<string, unknown>>;
  });

  const contenido = csv(
    ["nro_ticket", "fuente", "tipo", "direccion", "barrio", "fecha_pedido", "id_cimba"],
    filas.map((f) => [
      (f.ticket as string) ?? null,
      f.fuente != null ? (ETIQUETA_FUENTE[f.fuente as FuenteDemanda] ?? String(f.fuente)) : null,
      f.tipo != null ? (ETIQUETA_TIPO[f.tipo as TipoProblema] ?? String(f.tipo)) : null,
      (f.direccion as string) ?? null,
      (f.barrio as string) ?? null,
      (f.fecha_pedido as string) ?? null,
      Number(f.id),
    ]),
  );

  return new NextResponse(contenido, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="expediente-sat-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

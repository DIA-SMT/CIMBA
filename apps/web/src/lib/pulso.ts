import { getDb, sql } from "@cimba/db";

/**
 * EL PULSO DE LAS 7:00 — el parte diario que el sistema arma solo y te busca
 * a vos: qué entró ayer, qué se reparó, dónde se concentró la deuda nueva,
 * qué órdenes vencen hoy y la anomalía del día. El mismo dato alimenta el
 * push de la mañana, el email y la página /pulso.
 *
 * Corre con getDb() directo (lo llama el cron, sin sesión) y NO trae ningún
 * dato personal: solo agregados. "Ayer" y "hoy" son días calendario de
 * Tucumán, no de UTC — a las 7:00 el parte habla del día que la gente vivió.
 */

const TZ = "America/Argentina/Buenos_Aires";

export interface Pulso {
  /** El día del que habla el parte (ayer), como dd/mm. */
  fechaAyer: string;
  entradas: { total: number; bacheo: number; sat: number; ingenieria: number };
  reparados: { baches: number; m2: number; ejecutores: Array<{ ejecutor: string; baches: number }> };
  cerradas: number;
  /** Barrios con más pedidos NUEVOS de bacheo ayer. */
  barriosCalientes: Array<{ barrio: string; pedidos: number }>;
  /**
   * La foto de la deuda de bacheo. `hace7dias` sale de la serie `deuda_diaria`
   * y es null mientras no haya una semana de historia guardada: el estado de
   * hace siete días no se puede reconstruir hacia atrás. `masDeUnaSemana` es
   * otra cosa —cuánto de la deuda de hoy ya lleva más de siete días esperando—
   * y es la que antes se mostraba, mal rotulada, como si fuera la comparación.
   */
  deuda: { sinAtencionBacheo: number; hace7dias: number | null; masDeUnaSemana: number };
  ordenes: { vencenHoy: Array<{ numero: string; empresa: string }>; vencidasActivas: number };
  cierresPendientes: number;
  /** Barrio cuyo volumen de ayer superó 3× su promedio diario del mes (mín. 5). */
  anomalia: { barrio: string; ayer: number; promedio: number } | null;
}

export async function datosPulso(): Promise<Pulso> {
  const db = getDb();

  const filas = (await db.execute(sql`
    with dias as (
      select (now() at time zone ${TZ})::date as hoy,
             ((now() at time zone ${TZ})::date - 1) as ayer
    ),
    entradas as (
      select count(*)::int as total,
             count(*) filter (where coalesce(d.destino::text, 'bacheo') = 'bacheo')::int as bacheo,
             count(*) filter (where d.destino = 'sat')::int as sat,
             count(*) filter (where d.destino = 'ingenieria')::int as ingenieria
      from demandas d, dias
      where (d.creado_en at time zone ${TZ})::date = dias.ayer
    ),
    reparados as (
      select count(*)::int as baches, round(coalesce(sum(iv.superficie_m2), 0))::int as m2
      from intervenciones iv, dias
      where iv.estado = 'finalizada'
        and (iv.finalizada_en at time zone ${TZ})::date = dias.ayer
    ),
    cerradas as (
      select count(*)::int as n
      from demandas d, dias
      where d.estado = 'cerrada'
        and ((d.metadata->'cierre'->>'en')::timestamptz at time zone ${TZ})::date = dias.ayer
    ),
    deuda_hoy as (
      select count(*)::int as n from demandas d
      where d.estado in ('recibida','en_validacion') and d.geom is not null
        and coalesce(d.destino::text, 'bacheo') = 'bacheo'
        and not exists (select 1 from incidentes i
          where st_dwithin(i.geom::geography, d.geom::geography, 40)
            and (i.estado in ('detectado','priorizado','programado','en_ejecucion')
                 or (i.estado in ('reparado','verificado')
                     and (d.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= d.creado_en))))
    ),
    vieja as (
      /* NO es "la deuda de hace 7 días": es la parte de la deuda de HOY que ya
         lleva más de una semana esperando. Durante mucho tiempo se mostró como
         si fuera la comparación semanal, y como es un subconjunto de la deuda
         de hoy siempre daba menor o igual: el parte no podía decir "baja" ni
         aunque la deuda bajara. La comparación real sale de deuda_diaria. */
      select count(*)::int as n from demandas d, dias
      where d.estado in ('recibida','en_validacion') and d.geom is not null
        and coalesce(d.destino::text, 'bacheo') = 'bacheo'
        and (d.creado_en at time zone ${TZ})::date <= dias.hoy - 7
        and not exists (select 1 from incidentes i
          where st_dwithin(i.geom::geography, d.geom::geography, 40)
            and (i.estado in ('detectado','priorizado','programado','en_ejecucion')
                 or (i.estado in ('reparado','verificado')
                     and (d.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= d.creado_en))))
    ),
    cerrables as (
      select count(distinct d.id)::int as n
      from demandas d
      join demanda_incidente di on di.demanda_id = d.id
      join incidentes i on i.id = di.incidente_id
      where d.estado in ('recibida','en_validacion','vinculada')
        and i.estado in ('reparado','verificado')
    )
    select entradas.total, entradas.bacheo, entradas.sat, entradas.ingenieria,
           reparados.baches, reparados.m2, cerradas.n as cerradas,
           deuda_hoy.n as deuda_hoy, vieja.n as vieja, cerrables.n as cerrables,
           /* La foto guardada hace exactamente una semana. Null hasta que la
              serie tenga esa antigüedad — no se inventa un valor. */
           (select dd.sin_atencion from deuda_diaria dd, dias
             where dd.fecha = dias.hoy - 7) as hace7dias,
           to_char((select ayer from dias), 'DD/MM') as fecha_ayer
    from entradas, reparados, cerradas, deuda_hoy, vieja, cerrables
  `)) as unknown as Array<Record<string, unknown>>;
  const f = filas[0] ?? {};

  const ejecutores = (await db.execute(sql`
    select coalesce(c.nombre, iv.metadata->>'contratista', 'Sin asignar') as ejecutor,
           count(*)::int as baches
    from intervenciones iv
    left join cuadrillas c on c.id = iv.cuadrilla_id
    where iv.estado = 'finalizada'
      and (iv.finalizada_en at time zone ${TZ})::date = ((now() at time zone ${TZ})::date - 1)
    group by 1 order by 2 desc limit 4
  `)) as unknown as Array<{ ejecutor: string; baches: number }>;

  const barrios = (await db.execute(sql`
    select b.nombre as barrio, count(*)::int as pedidos
    from demandas d
    join barrios b on b.id = d.barrio_id
    where (d.creado_en at time zone ${TZ})::date = ((now() at time zone ${TZ})::date - 1)
      and coalesce(d.destino::text, 'bacheo') = 'bacheo'
    group by 1 order by 2 desc limit 3
  `)) as unknown as Array<{ barrio: string; pedidos: number }>;

  const ordenesHoy = (await db.execute(sql`
    select ot.numero, e.nombre as empresa
    from ordenes_trabajo ot join empresas e on e.id = ot.empresa_id
    where ot.estado in ('emitida','en_ejecucion')
      and ot.vence_en = (now() at time zone ${TZ})::date
    order by ot.numero
  `)) as unknown as Array<{ numero: string; empresa: string }>;

  const vencidas = (await db.execute(sql`
    select count(*)::int as n
    from ordenes_trabajo ot
    where ot.estado in ('emitida','en_ejecucion')
      and ot.vence_en is not null and ot.vence_en < (now() at time zone ${TZ})::date
  `)) as unknown as Array<{ n: number }>;

  const anomalias = (await db.execute(sql`
    with x as (
      select b.nombre as barrio,
             count(*) filter (where (d.creado_en at time zone ${TZ})::date = ((now() at time zone ${TZ})::date - 1))::int as ayer,
             (count(*) filter (where (d.creado_en at time zone ${TZ})::date >= ((now() at time zone ${TZ})::date - 30)
                                 and (d.creado_en at time zone ${TZ})::date < ((now() at time zone ${TZ})::date - 1)))::numeric / 29 as promedio
      from demandas d join barrios b on b.id = d.barrio_id
      group by 1
    )
    select barrio, ayer, round(promedio, 1) as promedio
    from x
    where ayer >= 5 and ayer >= promedio * 3
    order by ayer desc limit 1
  `)) as unknown as Array<{ barrio: string; ayer: number; promedio: number }>;

  return {
    fechaAyer: String(f.fecha_ayer ?? ""),
    entradas: {
      total: Number(f.total ?? 0),
      bacheo: Number(f.bacheo ?? 0),
      sat: Number(f.sat ?? 0),
      ingenieria: Number(f.ingenieria ?? 0),
    },
    reparados: {
      baches: Number(f.baches ?? 0),
      m2: Number(f.m2 ?? 0),
      ejecutores: ejecutores.map((e) => ({ ejecutor: String(e.ejecutor), baches: Number(e.baches) })),
    },
    cerradas: Number(f.cerradas ?? 0),
    barriosCalientes: barrios.map((b) => ({ barrio: String(b.barrio), pedidos: Number(b.pedidos) })),
    deuda: {
      sinAtencionBacheo: Number(f.deuda_hoy ?? 0),
      hace7dias: f.hace7dias == null ? null : Number(f.hace7dias),
      masDeUnaSemana: Number(f.vieja ?? 0),
    },
    ordenes: {
      vencenHoy: ordenesHoy.map((o) => ({ numero: String(o.numero), empresa: String(o.empresa) })),
      vencidasActivas: Number(vencidas[0]?.n ?? 0),
    },
    cierresPendientes: Number(f.cerrables ?? 0),
    anomalia: anomalias[0]
      ? { barrio: String(anomalias[0].barrio), ayer: Number(anomalias[0].ayer), promedio: Number(anomalias[0].promedio) }
      : null,
  };
}

/**
 * Guarda la foto de hoy en `deuda_diaria`. La llama el cron de las 7:00, una
 * vez por día: es lo único que hace posible la comparación semanal, porque el
 * estado de la deuda depende del estado ACTUAL de cada reclamo y no queda
 * historiado en ningún lado. Es un upsert por fecha, así que correr el cron de
 * nuevo el mismo día no duplica ni corrompe la serie.
 */
export async function guardarFotoDeuda(p: Pulso): Promise<void> {
  await getDb().execute(sql`
    insert into deuda_diaria (fecha, sin_atencion)
    values ((now() at time zone ${TZ})::date, ${p.deuda.sinAtencionBacheo})
    on conflict (fecha) do update
      set sin_atencion = excluded.sin_atencion, registrado_en = now()
  `);
}

const n = (x: number) => x.toLocaleString("es-AR");

/**
 * Cómo se cuenta la deuda en el parte. Mientras la serie no tenga una semana,
 * el parte NO dice ni "sube" ni "baja": dice que todavía no hay con qué
 * comparar y muestra cuánto de la deuda ya lleva más de siete días. Es la
 * diferencia entre un dato y una corazonada con números.
 */
export function textoDeuda(p: Pulso): string {
  const hoy = `${n(p.deuda.sinAtencionBacheo)} pedidos`;
  if (p.deuda.hace7dias == null) {
    return `${hoy} — ${n(p.deuda.masDeUnaSemana)} de ellos ya esperan hace más de una semana (la comparación semanal necesita 7 días de historia y empieza a estar disponible recién ahora)`;
  }
  const delta = p.deuda.sinAtencionBacheo - p.deuda.hace7dias;
  if (delta === 0) return `${hoy} — igual que hace 7 días`;
  return `${hoy} — ${delta < 0 ? "baja" : "sube"}: hace 7 días eran ${n(p.deuda.hace7dias)}`;
}

/** El push corto de la mañana: dos líneas que dan ganas de abrir el parte. */
export function pushDelPulso(p: Pulso): { titulo: string; cuerpo: string } {
  const partes = [
    `${n(p.entradas.total)} pedidos nuevos`,
    `${n(p.reparados.baches)} baches tapados (${n(p.reparados.m2)} m²)`,
  ];
  if (p.ordenes.vencenHoy.length > 0) partes.push(`${p.ordenes.vencenHoy.length} orden(es) vencen HOY`);
  if (p.anomalia) partes.push(`ojo: ${p.anomalia.barrio} ×${Math.round(p.anomalia.ayer / Math.max(0.5, p.anomalia.promedio))}`);
  return {
    titulo: `Pulso del ${p.fechaAyer}: así amanece el bacheo`,
    cuerpo: partes.join(" · "),
  };
}

/** El parte completo para el email, como texto con renglones (Resend lo envuelve). */
export function emailDelPulso(p: Pulso): string {
  const lineas = [
    `AYER (${p.fechaAyer})`,
    `· Entraron ${n(p.entradas.total)} pedidos: ${n(p.entradas.bacheo)} de bacheo, ${n(p.entradas.sat)} de agua (SAT), ${n(p.entradas.ingenieria)} de ripio (Ingeniería).`,
    `· Se taparon ${n(p.reparados.baches)} baches (${n(p.reparados.m2)} m²)${
      p.reparados.ejecutores.length > 0
        ? ": " + p.reparados.ejecutores.map((e) => `${e.ejecutor} ${n(e.baches)}`).join(", ")
        : ""
    }.`,
    `· Se les respondió y cerró el reclamo a ${n(p.cerradas)} vecinos.`,
    p.barriosCalientes.length > 0
      ? `· La demanda nueva de bacheo se concentró en: ${p.barriosCalientes.map((b) => `${b.barrio} (${n(b.pedidos)})`).join(", ")}.`
      : "",
    "",
    "HOY",
    `· Deuda de bacheo sin atención: ${textoDeuda(p)}.`,
    p.ordenes.vencenHoy.length > 0
      ? `· Vencen HOY: ${p.ordenes.vencenHoy.map((o) => `${o.numero} (${o.empresa})`).join(", ")}.`
      : "· No vence ninguna orden hoy.",
    p.ordenes.vencidasActivas > 0 ? `· Siguen abiertas ${n(p.ordenes.vencidasActivas)} órdenes ya vencidas.` : "",
    p.cierresPendientes > 0
      ? `· Hay ${n(p.cierresPendientes)} reclamos con el trabajo YA hecho esperando respuesta al vecino (bandeja Cierres).`
      : "",
    p.anomalia
      ? `· ANOMALÍA: ${p.anomalia.barrio} tuvo ${n(p.anomalia.ayer)} pedidos ayer contra un promedio de ${p.anomalia.promedio} por día — vale una mirada.`
      : "",
  ];
  return lineas.filter((l) => l !== "").join("\n");
}

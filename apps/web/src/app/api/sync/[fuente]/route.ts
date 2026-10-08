import { NextResponse, type NextRequest } from "next/server";
import { mensajeDeError } from "@/lib/errores";
import { getDb, sql } from "@cimba/db";
import {
  crearAdaptadorAtencionCiudadana,
  crearAdaptadorMock,
  cursorAtencionCiudadana,
  ingestarDemandas,
  registrarSyncRun,
  sincronizarEstadosAc,
  type EstadoAc,
} from "@cimba/integrations";

/**
 * Endpoint de ingesta disparado por Vercel Cron (ver vercel.json).
 * Autenticación: Authorization: Bearer <CRON_SECRET>.
 */
export const maxDuration = 60;

/**
 * Desde dónde arranca el barrido la primera vez. Las 464 demandas que entraron
 * por archivo no guardaron su id de origen, así que no sirven de cursor: se usa
 * este piso para no barrer 116.000 ids de histórico en el cron. El catch-up
 * hacia atrás se hace con el CLI, sin límite de tiempo.
 */
const ID_AC_INICIAL = Number(process.env.CIMBA_AC_DESDE_ID ?? 116000);

export async function GET(req: NextRequest, ctx: { params: Promise<{ fuente: string }> }) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const { fuente } = await ctx.params;
  if (fuente !== "atencion-ciudadana") {
    return NextResponse.json({ error: `fuente desconocida: ${fuente}` }, { status: 404 });
  }

  /**
   * El mock EXIGE opt-in explícito. Antes el default lo elegía solo, y el cron
   * diario terminó inyectando ~6 demandas inventadas por día en la base real:
   * 66 en total antes de detectarlo, contaminando la brecha y las métricas por
   * distrito. Sin fuente configurada ahora no pasa nada — no se fabrican datos.
   */
  const modo = process.env.CIMBA_FUENTE_AC ?? "";
  if (modo !== "atencion-ciudadana" && modo !== "mock") {
    return NextResponse.json(
      {
        error:
          "La fuente de Atención Ciudadana no está configurada (CIMBA_FUENTE_AC). " +
          "No se ingesta nada: preferimos quedarnos sin datos nuevos antes que inventarlos.",
        modo: modo || "(sin definir)",
      },
      { status: 503 },
    );
  }

  const desde = new Date(Date.now() - 7 * 86_400_000);
  try {
    if (modo === "mock") {
      const mock = crearAdaptadorMock({ cantidad: 6 });
      const r = await ingestarDemandas(mock.sistema, await mock.traerDemandas(desde));
      await registrarSyncRun(r, desde);
      return NextResponse.json({ modo, ...r, errores: r.errores.length });
    }

    // Barrido por id desde el último importado (la API no lista por fecha).
    const cursor = await cursorAtencionCiudadana(ID_AC_INICIAL);
    const ac = crearAdaptadorAtencionCiudadana(process.env.CIMBA_API_ATENCION_CIUDADANA ?? "", {
      desdeId: cursor,
      lote: Number(process.env.CIMBA_AC_LOTE ?? 200),
    });
    const demandas = await ac.traerDemandas(desde);
    const r = await ingestarDemandas(ac.sistema, demandas);
    /**
     * hastaId hace avanzar el cursor aunque el tramo no traiga pavimento — pero
     * solo se guarda si en el tramo existía ALGÚN id. Pasado el final de la
     * secuencia cada corrida avanzaría ~25 ids sobre la nada y el cursor se
     * iría al infinito, dejando la sincronización muerta sin que se note.
     */
    await registrarSyncRun(r, desde, {
      ...(ac.existentes > 0 ? { hastaId: ac.ultimoIdVisto } : {}),
      idsExistentes: ac.existentes,
      descartados: ac.descartados,
      // Los ids que no se pudieron leer: sin esto se perdían en silencio y el
      // cursor seguía de largo. Quedan en el sync_run para poder re-pedirlos.
      ...(ac.fallos.length > 0 ? { fallos: ac.fallos } : {}),
    });
    /**
     * Y la vuelta: los cierres que hizo Atención Ciudadana por su cuenta.
     *
     * El tránsito es de ida y vuelta. Hay gente de AC cerrando reclamos por su
     * propio sistema, y sin esto quedaban abiertos de este lado para siempre,
     * inflando los pendientes. La primera corrida encontró 79 así.
     *
     * Va con presupuesto de reloj y no con tamaño fijo de tanda: no entran 840
     * consultas en una invocación de Vercel. Cada corrida sigue por las que
     * hace más tiempo que no se preguntan, así que en pocos días cubre todo y
     * después se mantiene al día sola.
     */
    const estados = await sincronizarEstados();

    return NextResponse.json({
      modo,
      desdeId: cursor,
      hastaId: ac.ultimoIdVisto,
      descartadosPorCategoria: ac.descartados,
      fallosDeConsulta: ac.fallos,
      ...r,
      errores: r.errores.length,
      estadosAc: estados,
    });
  } catch (e) {
    return NextResponse.json(
      { error: mensajeDeError(e, "error de ingesta") },
      { status: 500 },
    );
  }
}

/**
 * Pregunta por el estado real de las demandas de AC que seguimos teniendo
 * abiertas y cierra las que allá ya terminaron.
 *
 * El orden es por `estado_ac_visto_en` ascendente con los nulos primero: las
 * que nunca se preguntaron van al frente y después rota por antigüedad. La
 * marca se graba en una sola sentencia al final — una por demanda duplicaría
 * los viajes a la base para no ganar nada.
 */
async function sincronizarEstados() {
  const db = getDb();
  const abiertas = (await db.execute(sql`
    select er.id_remoto::bigint as id_reclamo, d.id as demanda_id
    from demandas d
    join external_ref er on er.entidad_local = 'demanda' and er.id_local = d.id
                        and er.sistema = 'atencion_ciudadana'
    where d.estado in ('recibida','en_validacion','vinculada')
      and er.id_remoto ~ '^[0-9]+$'
    order by (d.metadata->>'estado_ac_visto_en') asc nulls first
    limit 400
  `)) as unknown as Array<{ id_reclamo: string; demanda_id: string }>;

  const porReclamo = new Map(abiertas.map((a) => [Number(a.id_reclamo), Number(a.demanda_id)]));

  const r = await sincronizarEstadosAc(
    [...porReclamo.keys()],
    async (estado: EstadoAc) => {
      const demandaId = porReclamo.get(estado.idReclamo);
      if (demandaId == null) return;
      await db.execute(sql`
        update demandas set estado = 'cerrada',
          metadata = metadata || jsonb_build_object(
            'cierre', jsonb_build_object(
              'en', now()::text,
              'por', 'Atención Ciudadana'::text,
              'origen', 'sincronizacion'::text,
              'id_estado_ac', ${estado.idEstado}::int,
              'estado_ac', ${estado.nombreEstado}::text,
              'id_movimiento_ac', ${estado.idMovimiento}::int
            )
          )
        where id = ${demandaId} and estado in ('recibida','en_validacion','vinculada')
      `);
    },
    // 35 s de los 60 de la función: el resto es para la ingesta de arriba.
    { limiteMs: 35_000, pausaMs: 0 },
  );

  if (r.consultadosIds.length > 0) {
    const demandas = r.consultadosIds
      .map((id) => porReclamo.get(id))
      .filter((x): x is number => x != null);
    /**
     * El arreglo va armado con sql.join y casteado. Pasarlo como parámetro
     * suelto hace que el driver lo expanda en N placeholders, y entonces el
     * any() recibe una tupla en vez de un arreglo y la consulta no compila.
     * Mismo patrón que lib/ordenes.ts.
     */
    const lista = sql`array[${sql.join(
      demandas.map((x) => sql`${x}`),
      sql`, `,
    )}]::bigint[]`;
    await db.execute(sql`
      update demandas
         set metadata = metadata || jsonb_build_object('estado_ac_visto_en', now()::text)
       where id = any(${lista})
    `);
  }

  return {
    consultados: r.consultados,
    cerradosEnAc: r.cerradosEnAc,
    cerrados: r.cerrados,
    sinRespuesta: r.sinRespuesta,
    truncado: r.truncado,
    errores: r.errores.length,
  };
}

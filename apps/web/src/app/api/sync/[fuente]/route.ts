import { NextResponse, type NextRequest } from "next/server";
import {
  crearAdaptadorAtencionCiudadana,
  crearAdaptadorMock,
  cursorAtencionCiudadana,
  ingestarDemandas,
  registrarSyncRun,
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
    });
    return NextResponse.json({
      modo,
      desdeId: cursor,
      hastaId: ac.ultimoIdVisto,
      descartadosPorCategoria: ac.descartados,
      fallosDeConsulta: ac.fallos,
      ...r,
      errores: r.errores.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error de ingesta" },
      { status: 500 },
    );
  }
}

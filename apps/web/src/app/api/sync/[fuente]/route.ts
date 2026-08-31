import { NextResponse, type NextRequest } from "next/server";
import {
  crearAdaptadorAtencionCiudadana,
  crearAdaptadorMock,
  ingestarDemandas,
  registrarSyncRun,
} from "@cimba/integrations";

/**
 * Endpoint de ingesta disparado por Vercel Cron (ver vercel.json).
 * Autenticación: Authorization: Bearer <CRON_SECRET>.
 */
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
  const adaptador =
    modo === "atencion-ciudadana"
      ? crearAdaptadorAtencionCiudadana(process.env.CIMBA_API_ATENCION_CIUDADANA ?? "")
      : crearAdaptadorMock({ cantidad: 6 });

  const desde = new Date(Date.now() - 7 * 86_400_000);
  try {
    const demandas = await adaptador.traerDemandas(desde);
    const r = await ingestarDemandas(adaptador.sistema, demandas);
    await registrarSyncRun(r, desde);
    return NextResponse.json({ modo, ...r, errores: r.errores.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error de ingesta" },
      { status: 500 },
    );
  }
}

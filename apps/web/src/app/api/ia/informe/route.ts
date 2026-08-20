import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { leerSesion } from "@/lib/auth";
import { generarInformeIA, iaDisponible } from "@/lib/ia";

/** Informe ejecutivo IA sobre los agregados visibles del mapa (sin datos personales). */
const agregadosSchema = z.object({
  periodo: z.string().max(40),
  incidentes: z.object({
    total: z.number(),
    por_macro: z.record(z.string(), z.number()),
    por_tipo: z.record(z.string(), z.number()),
  }),
  demandas: z.object({
    total: z.number(),
    por_fuente: z.record(z.string(), z.number()),
    sin_vincular: z.number(),
  }),
  m2_intervenidos: z.number(),
  zonas_calientes: z.array(z.object({ direccion: z.string().max(200), cantidad: z.number() })).max(8),
});

export async function POST(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (!iaDisponible()) return NextResponse.json({ error: "IA no configurada" }, { status: 501 });

  const cuerpo = agregadosSchema.safeParse(await req.json());
  if (!cuerpo.success) return NextResponse.json({ error: "agregados inválidos" }, { status: 400 });

  try {
    const informe = await generarInformeIA(cuerpo.data);
    return NextResponse.json({ informe });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error de IA" },
      { status: 502 },
    );
  }
}

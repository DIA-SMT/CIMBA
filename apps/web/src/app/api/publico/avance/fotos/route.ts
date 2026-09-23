import { NextResponse, type NextRequest } from "next/server";
import { leerTerritorio, muroAntesDespues } from "@/lib/avance";

export const maxDuration = 60;

/**
 * El muro del antes y el después para la versión pública: las mismas fotos de
 * la calle arreglada que ya muestra la columna, todas. Responde 404 mientras
 * la Dirección no prenda AVANCE_PUBLICO.
 */
export async function GET(req: NextRequest) {
  if (process.env.AVANCE_PUBLICO !== "1") return NextResponse.json({ error: "no existe" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const empresa = (sp.get("empresa") ?? "").trim().slice(0, 40) || null;
  const pagina = await muroAntesDespues({
    territorio: leerTerritorio({ distrito: sp.get("distrito") ?? undefined, barrio: sp.get("barrio") ?? undefined }),
    empresa,
    pagina: Number(sp.get("pagina") ?? 0) || 0,
  });
  return NextResponse.json(pagina, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}

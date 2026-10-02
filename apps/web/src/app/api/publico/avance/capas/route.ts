import { NextResponse } from "next/server";
import { capasAvance } from "@/lib/avance-capas";

export const maxDuration = 60;

/**
 * Las capas de alcance para la versión pública de Avance: barrios, calles y a
 * qué calle y barrio va cada trabajo. No hay datos de personas. Como el resto
 * de /api/publico, responde 404 mientras la Dirección no prenda AVANCE_PUBLICO.
 */
export async function GET() {
  if (process.env.AVANCE_PUBLICO !== "1") return NextResponse.json({ error: "no existe" }, { status: 404 });
  return NextResponse.json(await capasAvance(), {
    headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" },
  });
}

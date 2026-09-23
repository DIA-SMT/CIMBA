import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { leerTerritorio, muroAntesDespues } from "@/lib/avance";

export const maxDuration = 60;

/**
 * El muro del antes y el después, de a una página: `?pagina=0&empresa=Calleri&barrio=79`.
 * Mismo guard que /api/avance: personal con sesión, nunca el rol empresa.
 */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (sesion.rol_cimba === "empresa") return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const empresa = (sp.get("empresa") ?? "").trim().slice(0, 40) || null;
  const pagina = await muroAntesDespues({
    territorio: leerTerritorio({ distrito: sp.get("distrito") ?? undefined, barrio: sp.get("barrio") ?? undefined }),
    empresa,
    pagina: Number(sp.get("pagina") ?? 0) || 0,
  });
  return NextResponse.json(pagina, { headers: { "cache-control": "private, max-age=60" } });
}

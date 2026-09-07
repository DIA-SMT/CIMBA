import { NextResponse, type NextRequest } from "next/server";
import { getDb, sql } from "@cimba/db";
import { leerSesion } from "@/lib/auth";

/**
 * ¿Qué superficie tiene la calle en este punto? — para que al CARGAR un pedido
 * el sistema avise al toque "acá no hay asfalto: esto no puede ser un bache"
 * (pedido del Director, 5/9), en vez de descubrirlo después en Tratamiento.
 *
 * Misma regla que el clasificador de destino (migración 0006): ripio o cordón
 * cuneta a <20 m SIN pavimento pegado (<12 m, para no robarse las esquinas).
 * Solo lectura y sobre datos territoriales, sin nada personal.
 */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ superficie: null });
  }

  const filas = (await getDb().execute(sql`
    select
      exists (select 1 from red_vial rv
        where rv.capa in ('ripio', 'cordon_cuneta')
          and st_dwithin(rv.geom::geography, st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, 20)) as sin_asfalto,
      exists (select 1 from red_vial rv
        where rv.capa = 'pavimento'
          and st_dwithin(rv.geom::geography, st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, 12)) as pavimento_cerca
  `)) as unknown as Array<{ sin_asfalto: boolean; pavimento_cerca: boolean }>;
  const f = filas[0];

  const superficie = f?.sin_asfalto && !f.pavimento_cerca ? "ripio" : f?.pavimento_cerca ? "pavimento" : null;
  return NextResponse.json({ superficie }, { headers: { "cache-control": "private, max-age=3600" } });
}

import { NextResponse, type NextRequest } from "next/server";
import { conRls, sql } from "@cimba/db";
import { BITS_FOTO_REPETIDA, esHuella } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { empresaDelEjecutor } from "@/lib/ordenes";

export const dynamic = "force-dynamic";

/**
 * ¿ESTA FOTO YA SE USÓ EN OTRO BACHE?
 *
 * Lo pregunta el portal apenas la empresa elige la foto, con la huella que
 * calculó el teléfono (lib/huella-navegador.ts): si se parece a la de un
 * trabajo ya cargado, la empresa ve el aviso y decide si la cambia o la sube
 * igual (Dirección de Bacheo, 12/10: "avisa y deja cargar").
 *
 * Quién puede preguntar: las empresas y cuadrillas que cargan, y el personal
 * municipal. Lo que contesta es mínimo a propósito: que sí, y el día. La
 * dirección solo si el trabajo es de la misma empresa — a una contratista no
 * se le cuenta dónde trabajó otra.
 */
const ROLES = ["empresa", "cuadrilla", "admin", "planificacion", "supervision"];

export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (!ROLES.includes(sesion.rol_cimba)) return NextResponse.json({ error: "sin permiso" }, { status: 403 });

  const huella = req.nextUrl.searchParams.get("h");
  if (!esHuella(huella)) return NextResponse.json({ error: "huella inválida" }, { status: 400 });

  const claims = { sub: sesion.sub, rol_cimba: sesion.rol_cimba, id_persona: sesion.id_persona, id_empresa: sesion.id_empresa };
  const fila = await conRls(claims, async (tx) => {
    const r = (await tx.execute(sql`
      select (iv.finalizada_en at time zone 'America/Argentina/Tucuman')::date::text as fecha,
             coalesce(oi.direccion, i.direccion) as direccion, ot.empresa_id
      from fotografias f
      join intervenciones iv on iv.id = f.intervencion_id and iv.estado <> 'anulada'
      left join incidentes i on i.id = iv.incidente_id
      left join orden_items oi on oi.intervencion_id = iv.id
      left join ordenes_trabajo ot on ot.id = oi.orden_id
      where f.huella is not null
        and bit_count(f.huella # ${huella}::bit(64)) <= ${BITS_FOTO_REPETIDA}
      order by bit_count(f.huella # ${huella}::bit(64))
      limit 1
    `)) as unknown as Array<{ fecha: string | null; direccion: string | null; empresa_id: number | null }>;
    return r[0] ?? null;
  });
  if (!fila) return NextResponse.json({ repetida: false });

  // El personal municipal ve dónde; un ejecutor, solo si el trabajo es suyo.
  const esEjecutor = sesion.rol_cimba === "empresa" || sesion.rol_cimba === "cuadrilla";
  const propia = esEjecutor ? await empresaDelEjecutor(sesion) : null;
  const puedeVerDonde = esEjecutor
    ? propia != null && fila.empresa_id != null && Number(fila.empresa_id) === propia
    : true;
  return NextResponse.json({
    repetida: true,
    fecha: fila.fecha,
    direccion: puedeVerDonde ? fila.direccion : null,
  });
}

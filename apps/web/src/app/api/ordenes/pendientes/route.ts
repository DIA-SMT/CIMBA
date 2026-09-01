import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { pendientesEnCircuito } from "@/lib/ordenes";

/**
 * Los pendientes de un circuito, para el armado de órdenes: la tabla es
 * grande (47 circuitos × cientos de incidentes) así que se trae por circuito
 * a demanda en vez de precargar todo en la página.
 */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  // Este endpoint expone el backlog entero de un circuito (direcciones, puntos,
  // reclamos): es una herramienta de planificación, no algo que una empresa
  // contratista deba poder enumerar. La RLS no lo tapa hoy, así que se corta acá.
  if (!["admin", "planificacion"].includes(sesion.rol_cimba)) {
    return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  }

  const circuito = Number(req.nextUrl.searchParams.get("circuito"));
  if (!Number.isInteger(circuito) || circuito <= 0) {
    return NextResponse.json({ error: "circuito inválido" }, { status: 400 });
  }

  const pendientes = await pendientesEnCircuito(sesion, circuito);
  return NextResponse.json({ pendientes });
}

import { NextResponse } from "next/server";
import { leerSesion } from "@/lib/auth";
import { resumenCircuitos } from "@/lib/ordenes";

/**
 * Capa operativa del mapa: el resumen de cada circuito (empresa asignada,
 * prioridad, pendientes, reclamos abiertos, OTs activas). Devuelve el array
 * directo: el mapa lo junta client-side por código contra el geojson estático
 * de /data/circuitos.json — así el polígono viaja una sola vez y lo vivo
 * viaja liviano.
 */
export async function GET() {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  // El tablero operativo (qué empresa trabaja cada circuito, conteos internos)
  // es para el personal municipal; una empresa contratista no tiene por qué
  // ver las asignaciones de sus competidoras. La RLS hoy no lo aplica.
  if (sesion.rol_cimba === "empresa") {
    return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  }

  try {
    return NextResponse.json(await resumenCircuitos(sesion));
  } catch {
    // Los datos operativos son opcionales para el mapa: si esto falla, los
    // circuitos se dibujan igual (sin empresa ni prioridad), no en negro.
    return NextResponse.json({ error: "sin datos operativos" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { leerSesion } from "@/lib/auth";
import { capasAvance } from "@/lib/avance-capas";

export const maxDuration = 60;

/**
 * Las capas de alcance de Avance (barrios, cuadras arregladas y a qué cuadra y
 * barrio va cada trabajo). Se piden una vez al abrir la pantalla.
 *
 * Mismo guard que /api/avance: personal con sesión, nunca el rol empresa (no
 * debe poder enumerar el trabajo de las demás contratistas).
 */
export async function GET() {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (sesion.rol_cimba === "empresa") return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  return NextResponse.json(await capasAvance(), { headers: { "cache-control": "private, max-age=300" } });
}

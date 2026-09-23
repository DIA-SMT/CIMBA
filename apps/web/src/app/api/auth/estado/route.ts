import { NextResponse } from "next/server";
import { leerSesion } from "@/lib/auth";

/**
 * ¿Sigue abierta la sesión? Lo pregunta el cliente cuando una acción falla y
 * cuando la persona vuelve a la pestaña, para decir "tu sesión se cerró" en
 * vez de un error genérico. Vive bajo /api/auth, que el middleware deja pasar
 * sin sesión: tiene que poder contestar que no.
 */
export async function GET() {
  const sesion = await leerSesion();
  return NextResponse.json({ sesion: sesion != null }, { headers: { "cache-control": "no-store" } });
}

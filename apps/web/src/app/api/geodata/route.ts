import { NextResponse } from "next/server";
import { leerSesion } from "@/lib/auth";
import { geodata } from "@/lib/consultas";

export async function GET() {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  const datos = await geodata(sesion);
  return NextResponse.json(datos, {
    headers: { "cache-control": "private, max-age=30" },
  });
}

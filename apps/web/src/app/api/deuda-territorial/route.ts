import { NextResponse } from "next/server";
import { leerSesion } from "@/lib/auth";
import { deudaPorTerritorio } from "@/lib/ordenes";

/**
 * Deuda territorial para pintar el mapa: por BARRIO o por CIRCUITO, el mismo
 * "se pinta por deuda" de los distritos (pedidos abiertos y cuántos no tienen
 * ninguna reparación a menos de 40 m). El mapa junta client-side contra los
 * geojson estáticos: circuitos por CÓDIGO (nombre = codigo acá) y barrios por
 * NOMBRE normalizado — el properties.id de barrios.json viene roto del
 * shapefile y NO es la PK de la tabla barrios.
 */
export async function GET(req: Request) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  // Igual que /api/circuitos-operativos: la deuda territorial es lectura de
  // gestión interna; una empresa contratista no tiene por qué ver el tablero
  // de deuda de toda la ciudad. La RLS hoy no lo aplica: se corta acá.
  if (sesion.rol_cimba === "empresa") {
    return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  }

  const nivel = new URL(req.url).searchParams.get("nivel");
  if (nivel !== "barrio" && nivel !== "circuito") {
    return NextResponse.json({ error: "nivel debe ser barrio o circuito" }, { status: 400 });
  }

  try {
    return NextResponse.json(await deudaPorTerritorio(sesion, nivel));
  } catch {
    // Como los datos operativos de circuitos: la deuda es OPCIONAL para el
    // mapa — si falla, barrios y circuitos se dibujan igual, sin tinte.
    return NextResponse.json({ error: "sin datos de deuda" }, { status: 500 });
  }
}

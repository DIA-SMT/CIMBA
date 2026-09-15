import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { TIPOS_ORDEN, type TipoOrden } from "@cimba/domain";
import {
  imbornalesEnColector,
  pendientesEnAmbito,
  rojasRelevablesEnCircuito,
  type AmbitoOrden,
} from "@/lib/ordenes";

/**
 * Lo pendiente dentro del ámbito elegido, para el armado de órdenes: la tabla
 * es grande (miles de incidentes) así que se trae a demanda en vez de
 * precargar todo en la página.
 *
 * El ámbito puede ser distrito, circuito, corredor o barrio — las cuatro
 * alternativas que pidió Leo — o un colector, que en vez de incidentes de
 * calzada devuelve las bocas de tormenta a limpiar.
 */
/**
 * "zona" faltaba y el formulario la ofrecía igual: elegir "Zona de la empresa"
 * devolvía 400 y la lista quedaba vacía sin decir por qué. Las seis que
 * existen en AmbitoOrden, sin excepciones silenciosas.
 */
const AMBITOS: AmbitoOrden[] = ["distrito", "circuito", "corredor", "barrio", "colector", "zona"];

export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  // Este endpoint expone el backlog entero de una zona (direcciones, puntos,
  // reclamos): es una herramienta de planificación, no algo que una empresa
  // contratista deba poder enumerar. La RLS no lo tapa hoy, así que se corta acá.
  if (!["admin", "planificacion"].includes(sesion.rol_cimba)) {
    return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const ambito = (sp.get("ambito") ?? "circuito") as AmbitoOrden;
  if (!AMBITOS.includes(ambito)) {
    return NextResponse.json({ error: "ámbito inválido" }, { status: 400 });
  }

  if (ambito === "colector") {
    const colector = (sp.get("ref") ?? "").trim().slice(0, 120);
    if (!colector) return NextResponse.json({ error: "colector inválido" }, { status: 400 });
    return NextResponse.json({ imbornales: await imbornalesEnColector(sesion, colector), rojas: 0 });
  }

  const ref = Number(sp.get("ref") ?? sp.get("circuito"));
  if (!Number.isInteger(ref) || ref <= 0) {
    return NextResponse.json({ error: "referencia inválida" }, { status: 400 });
  }

  /**
   * El tipo de orden decide qué se ofrece: una orden de bacheo no puede
   * mostrar pérdidas de agua ni tapas de registro, que son de la SAT. Si no
   * viene o no se reconoce, bacheo — que es el caso de siempre.
   */
  const tipoCrudo = sp.get("tipo") ?? "bacheo";
  const tipo: TipoOrden = (TIPOS_ORDEN as readonly string[]).includes(tipoCrudo)
    ? (tipoCrudo as TipoOrden)
    : "bacheo";

  const [datos, rojas] = await Promise.all([
    pendientesEnAmbito(sesion, ambito, ref, tipo),
    // El relevamiento de rojos limpios solo existe por circuito: es la unidad
    // con la que se reparte el trabajo a las contratistas.
    ambito === "circuito" ? rojasRelevablesEnCircuito(sesion, ref) : Promise.resolve(0),
  ]);
  return NextResponse.json({
    pendientes: datos.pendientes,
    fueraDeAlcance: datos.fueraDeAlcance,
    rojas,
  });
}

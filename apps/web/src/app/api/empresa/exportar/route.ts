import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { csv, respuestaCsv } from "@/lib/csv";
import { trabajosDeEmpresa } from "@/lib/exportar-empresa";
import { empresaDelEjecutor, listarOrdenes } from "@/lib/ordenes";
import { fechaCorta } from "@/lib/formato";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ETIQUETA_ESTADO: Record<string, string> = {
  hecho: "Hecho",
  no_encontrado: "No encontrado",
  ya_resuelto: "Ya estaba resuelto",
};

const ETIQUETA_INTERVENCION: Record<string, string> = {
  bacheo: "Bacheo",
  pano_hormigon: "Paño de hormigón",
  carpeta: "Carpeta",
  enripiado: "Enripiado",
};

/**
 * LO QUE LA EMPRESA CARGÓ Y LO QUE TIENE ASIGNADO, EN CSV.
 *
 * La contratista carga bache por bache desde el teléfono y no tenía forma de
 * llevarse lo suyo: para armar el remito, cruzar contra su planilla o discutir
 * una certificación dependía de que el municipio se lo exportara.
 *
 * La empresa SIEMPRE exporta lo suyo: el id sale de empresaDelEjecutor(), no
 * de la URL. El staff en vista espejo puede pasar ?empresa=N, igual que en el
 * resto del portal — y es la única forma de que ese parámetro se mire.
 */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (!["empresa", "cuadrilla", "admin", "planificacion"].includes(sesion.rol_cimba)) {
    return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const propia = await empresaDelEjecutor(sesion);
  const pedida = Number(p.get("empresa"));
  const empresaId = propia ?? (Number.isInteger(pedida) && pedida > 0 ? pedida : null);
  if (empresaId == null) {
    return NextResponse.json({ error: "falta la empresa" }, { status: 400 });
  }

  const ordenParam = Number(p.get("orden"));
  const ordenId = Number.isInteger(ordenParam) && ordenParam > 0 ? ordenParam : undefined;

  if (p.get("que") === "ordenes") {
    const ordenes = (await listarOrdenes(sesion, { empresaId })).filter(
      (o) => o.estado !== "borrador",
    );
    return respuestaCsv(
      "cimba-mis-ordenes",
      csv(
        [
          "Orden",
          "Estado",
          "Prioridad",
          "Circuito",
          "Título",
          "Encargado",
          "Cerrados",
          "Hechos",
          "m2 reportados",
          "Emitida",
          "Vence",
        ],
        ordenes.map((o) => [
          o.numero,
          o.estado,
          o.prioridad,
          o.circuitoCodigo,
          o.titulo,
          o.enPlan,
          o.cerrados,
          o.hechos,
          o.m2Reportados,
          fechaCorta(o.emitidaEn),
          fechaCorta(o.venceEn),
        ]),
      ),
    );
  }

  const trabajos = await trabajosDeEmpresa(sesion, empresaId, { ordenId });
  return respuestaCsv(
    ordenId ? "cimba-trabajos-de-la-orden" : "cimba-mis-trabajos",
    csv(
      [
        "Fecha",
        "Orden",
        "Dirección",
        "Cómo cerró",
        "Tipo de intervención",
        "Modalidad",
        "Ancho (m)",
        "Largo (m)",
        "Espesor (cm)",
        "Superficie (m2)",
        "Volumen (m3)",
        "Capataz",
        "Ticket 147",
        "Observaciones",
        "Latitud",
        "Longitud",
        "En acta de medición",
        "Foto antes",
        "Foto después",
      ],
      trabajos.map((t) => [
        fechaCorta(t.fecha),
        // Sin orden = carga libre: que se lea, no que quede una celda vacía
        // que parezca un dato faltante.
        t.orden ?? "Sin orden",
        t.direccion,
        ETIQUETA_ESTADO[t.estado] ?? t.estado,
        t.tipoIntervencion ? (ETIQUETA_INTERVENCION[t.tipoIntervencion] ?? t.tipoIntervencion) : null,
        t.tipoObra,
        t.anchoM,
        t.largoM,
        t.espesorCm,
        t.superficieM2,
        t.volumenM3,
        t.capataz,
        t.ticket147,
        t.observaciones,
        t.lat,
        t.lon,
        t.certificado ? "Sí" : "No",
        t.fotoAntes,
        t.fotoDespues,
      ]),
    ),
  );
}

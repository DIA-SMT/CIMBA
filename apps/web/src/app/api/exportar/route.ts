import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { listarDemandas, listarIncidentes, listarIntervenciones } from "@/lib/consultas";
import { csv, respuestaCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Exportación CSV de las bandejas respetando los filtros activos, para seguir
 * trabajando en Excel, PowerBI o QGIS. Separador ";" (convención local) y BOM
 * para que Excel lo abra con acentos correctos. Nunca incluye datos de
 * contacto del vecino.
 */

const LIMITE = 10000;

// El armado del CSV vive en lib/csv.ts: lo comparte con el portal de
// empresas, y la neutralización de fórmulas no puede existir en dos copias.
const respuesta = respuestaCsv;

export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const entidad = p.get("entidad");

  if (entidad === "demandas") {
    const { filas, total } = await listarDemandas(sesion, {
      fuente: p.get("fuente") ?? undefined,
      estado: p.get("estado") ?? undefined,
      destino: p.get("destino") ?? undefined,
      q: p.get("q") ?? undefined,
      calidad: p.get("calidad") ?? undefined,
      mes: p.get("mes") ?? undefined,
      limite: LIMITE,
    });
    void total;
    return respuesta(
      "cimba-demandas",
      csv(
        ["id", "fuente", "estado", "tipo", "direccion", "lat", "lon", "confianza_geocod", "creado_en", "vinculos"],
        filas.map((d) => [d.id, d.fuente, d.estado, d.tipo, d.direccion, d.lat, d.lon, d.geocodConfianza, d.creadoEn, d.vinculos]),
      ),
    );
  }

  if (entidad === "incidentes") {
    const { filas } = await listarIncidentes(sesion, {
      estado: p.get("estado") ?? undefined,
      tipo: p.get("tipo") ?? undefined,
      q: p.get("q") ?? undefined,
      orden: p.get("orden") === "fecha" ? "fecha" : "prioridad",
      limite: LIMITE,
    });
    return respuesta(
      "cimba-incidentes",
      csv(
        ["id", "tipo", "estado", "direccion", "lat", "lon", "score_prioridad", "superficie_m2", "pedidos", "trabajos", "detectado_en", "cerrado_en"],
        filas.map((i) => [i.id, i.tipo, i.estado, i.direccion, i.lat, i.lon, i.scorePrioridad, i.superficieM2, i.demandas, i.intervenciones, i.detectadoEn, i.cerradoEn]),
      ),
    );
  }

  if (entidad === "intervenciones") {
    const { filas } = await listarIntervenciones(sesion, {
      estado: p.get("estado") ?? undefined,
      ejecutor: p.get("ejecutor") ?? undefined,
      q: p.get("q") ?? undefined,
      limite: LIMITE,
    });
    return respuesta(
      "cimba-intervenciones",
      csv(
        ["id", "incidente_id", "estado", "ejecutor", "tipo", "direccion", "lat", "lon", "superficie_m2", "iniciada_en", "finalizada_en", "fotos"],
        filas.map((iv) => [
          iv.id,
          iv.incidenteId,
          iv.estado,
          iv.cuadrilla ?? (iv.metadata.contratista as string | undefined) ?? "Sin asignar",
          iv.tipo,
          iv.direccion,
          iv.lat,
          iv.lon,
          iv.superficieM2,
          iv.iniciadaEn,
          iv.finalizadaEn,
          iv.fotos,
        ]),
      ),
    );
  }

  return NextResponse.json({ error: "entidad inválida: demandas | incidentes | intervenciones" }, { status: 400 });
}

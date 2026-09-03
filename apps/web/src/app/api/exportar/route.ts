import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { listarDemandas, listarIncidentes, listarIntervenciones } from "@/lib/consultas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Exportación CSV de las bandejas respetando los filtros activos, para seguir
 * trabajando en Excel, PowerBI o QGIS. Separador ";" (convención local) y BOM
 * para que Excel lo abra con acentos correctos. Nunca incluye datos de
 * contacto del vecino.
 */

const LIMITE = 10000;

function celda(v: unknown): string {
  if (v == null) return "";
  // Los números (ids, coordenadas negativas) pasan tal cual.
  if (typeof v === "number") return String(v);
  let s = String(v);
  // Neutralizar CSV injection: Excel evalúa como fórmula las celdas que
  // empiezan con = + - @ o tab (el texto viene de vecinos y archivos externos).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n']/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function csv(columnas: string[], filas: unknown[][]): string {
  const lineas = [columnas.join(";"), ...filas.map((f) => f.map(celda).join(";"))];
  return "﻿" + lineas.join("\r\n");
}

function respuesta(nombre: string, contenido: string): NextResponse {
  return new NextResponse(contenido, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

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

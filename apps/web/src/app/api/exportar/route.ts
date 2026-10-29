import { NextResponse, type NextRequest } from "next/server";
import { leerSesion } from "@/lib/auth";
import { listarDemandas, listarIncidentes, listarIntervenciones } from "@/lib/consultas";
import { csv, respuestaCsv } from "@/lib/csv";
import { NIVEL_IPI, gradoEstado, nombreCorredor, rankingIpi } from "@/lib/ipi";

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
      "PEDIDOS",
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
      "PROBLEMAS",
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
      "TRABAJOS",
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

  /**
   * EL IPI RECALCULADO, para trabajarlo afuera: "que se pueda descargar un
   * .csv con el IPI recalculado para poder procesar esa información en la toma
   * de decisiones" (Dirección de Bacheo, 12/10).
   *
   * Una fila por corredor, en el orden de la metodología (sector, nivel, IPI)
   * y con su puesto dentro del sector y el nivel, que es como se lee. Van las
   * seis variables y el desglose del Estado, para poder rehacer la cuenta.
   *
   * Los decimales van con COMA: es lo que entiende como número el Excel con
   * configuración argentina (con punto, "17.9" queda como texto o como fecha).
   */
  if (entidad === "ipi") {
    const corredores = await rankingIpi(sesion);
    const dec = (v: number | null, n = 1) =>
      v == null ? null : v.toLocaleString("es-AR", { minimumFractionDigits: n, maximumFractionDigits: n, useGrouping: false });
    const puesto = new Map<number, number>();
    const contador = new Map<string, number>();
    for (const c of corredores) {
      if (c.excluido || c.ipi == null) continue;
      const clave = `${c.sector ?? ""}|${c.nivel}`;
      const n = (contador.get(clave) ?? 0) + 1;
      contador.set(clave, n);
      puesto.set(c.id, n);
    }
    return respuesta(
      "IPI",
      csv(
        [
          "sector",
          "nivel",
          "jerarquia",
          "puesto_en_sector_y_nivel",
          "corredor",
          "ipi",
          "estado_valor",
          "estado_grado",
          "roto_por_km",
          "problemas_abiertos",
          "pedidos_sin_atender",
          "reaperturas_12m",
          "arreglados_24m",
          "interconexion_valor",
          "barrios_conectados",
          "accesibilidad_valor",
          "transporte_publico",
          "transporte_valor",
          "equipamientos_valor",
          "factibilidad_valor",
          "compromiso_asumido",
          "no_factible",
          "largo_km",
          "calculado_en",
        ],
        corredores.map((c) => [
          c.sector,
          c.nivel,
          NIVEL_IPI[c.nivel],
          puesto.get(c.id) ?? null,
          nombreCorredor(c.nombre),
          dec(c.ipi),
          dec(c.vEstado, 0),
          c.vEstado != null ? gradoEstado(c.vEstado) : null,
          dec(c.densidadKm),
          c.rotos?.problemas ?? null,
          c.rotos?.pedidos ?? null,
          c.rotos?.reaperturas ?? null,
          c.arreglados24m,
          dec(c.vInterconexion, 0),
          c.barriosConectados,
          dec(c.vAccesibilidad, 0),
          c.tieneTransporte == null ? null : c.tieneTransporte ? "sí" : "no",
          dec(c.vTransporte, 0),
          dec(c.vEquipamientos, 0),
          dec(c.vFactibilidad, 0),
          c.compromiso ? "sí" : "no",
          c.excluido ? "sí" : "no",
          dec(c.longitudM / 1000, 2),
          c.calculadoEn ? new Date(c.calculadoEn).toISOString().slice(0, 10) : null,
        ]),
      ),
    );
  }

  return NextResponse.json(
    { error: "entidad inválida: demandas | incidentes | intervenciones | ipi" },
    { status: 400 },
  );
}

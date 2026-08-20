import type { DemandaNormalizada, IntervencionNormalizada } from "@cimba/domain";
import { parsearAtencionAbiertosBuffer } from "./atencion-abiertos";
import {
  parsearBacheoJunioJulioTexto,
  parsearBacheoMarzoTexto,
  parsearBacheoMensualTexto,
} from "./bacheo";
import { parsearObrasSigovBuffer } from "./obras-sigov";
import { parsearSatTexto } from "./sat";

/**
 * Importación desde la app: detecta el formato de un archivo subido por sus
 * encabezados y lo parsea con el adaptador correspondiente. Los mismos
 * formatos que la CLI, sin depender de nombres de archivo.
 */

export interface ResultadoDeteccion {
  formato: string;
  descripcion: string;
  sistema: string;
  demandas: DemandaNormalizada[];
  intervenciones: IntervencionNormalizada[];
}

function primeraLinea(texto: string): string {
  return (texto.split(/\r?\n/, 1)[0] ?? "").toLowerCase();
}

export async function detectarYParsear(
  nombre: string,
  contenido: Buffer | Uint8Array,
): Promise<ResultadoDeteccion> {
  const esXlsx = /\.xlsx?$/i.test(nombre) || (contenido[0] === 0x50 && contenido[1] === 0x4b);

  if (esXlsx) {
    const { default: xlsx } = await import("xlsx");
    const wb = xlsx.read(contenido, { type: "buffer" });
    const hoja = wb.Sheets[wb.SheetNames[0] ?? ""];
    const encabezados = (
      (xlsx.utils.sheet_to_json(hoja ?? {}, { header: 1 })[0] as unknown[]) ?? []
    )
      .map((c) => String(c ?? "").toLowerCase())
      .join("|");

    if (encabezados.includes("id_reclamo") && encabezados.includes("nombre_treclamo")) {
      const demandas = await parsearAtencionAbiertosBuffer(contenido);
      return {
        formato: "atencion_ciudadana_xlsx",
        descripcion: "Reclamos de Atención Ciudadana (export xlsx)",
        sistema: "atencion_ciudadana",
        demandas,
        intervenciones: [],
      };
    }
    if (encabezados.includes("obra_id") && encabezados.includes("contratista")) {
      const intervenciones = await parsearObrasSigovBuffer(contenido);
      return {
        formato: "obras_sigov_xlsx",
        descripcion: "Obras de pavimento SIGOV (xlsx)",
        sistema: "sigov",
        demandas: [],
        intervenciones,
      };
    }
    throw new Error(
      "No reconozco este xlsx: espero el export de Atención Ciudadana (id_reclamo…) o el de obras SIGOV (OBRA_ID…)",
    );
  }

  const texto = Buffer.from(contenido).toString("utf8");
  const linea1 = primeraLinea(texto);

  if (linea1.includes("motivo") && linea1.includes("calidad")) {
    return {
      formato: "sat_csv",
      descripcion: "Intimaciones SAT geocodificadas (csv)",
      sistema: "sat",
      demandas: parsearSatTexto(texto),
      intervenciones: [],
    };
  }
  if (linea1.includes("mes_bacheo")) {
    const etiqueta = `carga-web-${new Date().toISOString().slice(0, 10)}`;
    return {
      formato: "bacheo_mensual_csv",
      descripcion: "Planilla mensual de bacheo geocodificada (csv)",
      sistema: "bacheo_planillas",
      demandas: [],
      intervenciones: parsearBacheoMensualTexto(texto, etiqueta),
    };
  }
  if (linea1.includes("tipo de trabajo") && linea1.includes("geo_confianza")) {
    return {
      formato: "bacheo_detallado_csv",
      descripcion: "Planilla de bacheo con fecha y tipo de trabajo (csv)",
      sistema: "bacheo_planillas",
      demandas: [],
      intervenciones: parsearBacheoJunioJulioTexto(texto),
    };
  }
  if (linea1.includes(";lat;lon;geo_confianza")) {
    return {
      formato: "bacheo_simple_csv",
      descripcion: "Planilla de bacheo simple (csv ;)",
      sistema: "bacheo_planillas",
      demandas: [],
      intervenciones: parsearBacheoMarzoTexto(texto),
    };
  }

  throw new Error(
    "Formato no reconocido. Formatos soportados: SAT geocodificado (csv), planillas de bacheo (csv), reclamos AC (xlsx), obras SIGOV (xlsx). Los GeoPackage (.gpkg) por ahora se cargan con la CLI local.",
  );
}

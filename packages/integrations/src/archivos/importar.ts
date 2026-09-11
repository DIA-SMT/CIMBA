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
    /**
     * LA PLANILLA MENSUAL NO SE PUEDE SUBIR POR ACÁ. No es una limitación
     * tonta: es el único formato cuya IDENTIDAD no está en el archivo.
     *
     * Cada fila entra a external_ref como `<etiqueta>-<id>`, y la etiqueta la
     * elige quien importa. La CLI usa el mes ("mayo-2026"); acá se armaba con
     * la fecha de HOY ("carga-web-2026-09-11"), así que ninguna fila coincidía
     * con lo ya cargado: subir la planilla de mayo creaba 360 incidentes y 360
     * intervenciones DUPLICADAS, y subirla de nuevo al día siguiente creaba
     * otras 360.
     *
     * Y no alcanza con sacar la etiqueta del contenido: verificado contra la
     * base, la planilla de mayo dice "Mayo 2025" adentro mientras en la base
     * está como "mayo-2026" — normalizar el contenido daría "mayo-2025" y
     * duplicaría igual. Mientras la identidad dependa de una etiqueta que se
     * tipea a mano, el único lugar seguro para cargarla es donde esa etiqueta
     * se elige a conciencia.
     */
    throw new Error(
      "Las planillas mensuales de bacheo (con columna mes_bacheo) se cargan con la CLI local " +
        "(pnpm ingest:archivos), no por acá: la identidad de cada fila depende de la etiqueta del mes " +
        "y subirla desde el navegador duplicaría todo lo ya cargado.",
    );
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

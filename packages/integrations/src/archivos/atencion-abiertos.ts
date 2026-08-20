import type { DemandaNormalizada } from "@cimba/domain";
import { demandaNormalizadaSchema, normalizarDireccion } from "@cimba/domain";
import { limpiarTexto, mapearTipo, parsearFecha, puntoValido } from "./util";

/**
 * Export de reclamos ABIERTOS de Atención Ciudadana derivados a la Dirección
 * de Obras Viales (xlsx). Estructura idéntica a la API de reclamos del portal.
 *
 * ⚠ Datos personales: apellido_nombre, telefono, email y cuit van a `contacto`
 * y quedan bajo acceso restringido (solo atencion_ciudadana y admin).
 *
 * ⚠ Muchas filas traen la MISMA coordenada por defecto (el centro de la
 * repartición). Detectamos coordenadas repetidas y las marcamos con confianza
 * mínima para que entren a revisión manual y jamás auto-vinculen.
 */
export async function parsearAtencionAbiertos(rutaXlsx: string): Promise<DemandaNormalizada[]> {
  const { readFileSync } = await import("node:fs");
  return parsearAtencionAbiertosBuffer(readFileSync(rutaXlsx));
}

export async function parsearAtencionAbiertosBuffer(contenido: Buffer | Uint8Array): Promise<DemandaNormalizada[]> {
  const { default: xlsx } = await import("xlsx");
  const wb = xlsx.read(contenido, { type: "buffer" });
  const nombreHoja = wb.SheetNames[0];
  if (!nombreHoja) return [];
  const hoja = wb.Sheets[nombreHoja];
  if (!hoja) return [];
  const filas: Record<string, unknown>[] = xlsx.utils.sheet_to_json(hoja, { defval: null });

  // Coordenadas que se repiten demasiado = valor por defecto, no geocodificación real
  const conteo = new Map<string, number>();
  for (const f of filas) {
    const k = `${f.coorde1},${f.coorde2}`;
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  }

  return filas
    .filter((f) => f.id_reclamo != null)
    .map((f) => {
      const claveCoord = `${f.coorde1},${f.coorde2}`;
      const esCoordDefecto = (conteo.get(claveCoord) ?? 0) > 5;
      const punto = esCoordDefecto ? null : puntoValido(f.coorde1, f.coorde2);
      const direccion = limpiarTexto(String(f.direccion ?? "").split(", SAN MIGUEL")[0]);
      const contacto: Record<string, unknown> = {};
      if (limpiarTexto(f.apellido_nombre)) contacto.nombre = limpiarTexto(f.apellido_nombre);
      if (limpiarTexto(f.telefono)) contacto.telefono = limpiarTexto(f.telefono);
      if (limpiarTexto(f.email)) contacto.email = limpiarTexto(f.email);
      if (limpiarTexto(f.cuit) && String(f.cuit) !== "0") contacto.cuit = limpiarTexto(f.cuit);

      return demandaNormalizadaSchema.parse({
        sistema: "atencion_ciudadana",
        idRemoto: String(f.id_reclamo),
        fuente: "atencion_ciudadana",
        tipo: mapearTipo(String(f.nombre_treclamo ?? "")),
        descripcion: limpiarTexto(f.detalle) ?? limpiarTexto(f.asunto),
        direccionTexto: direccion,
        direccionNormalizada: direccion ? normalizarDireccion(direccion) : null,
        punto,
        geocodConfianza: punto ? 0.5 : esCoordDefecto ? 0.05 : null,
        // El id de distrito NO va a la FK hasta que la tabla distritos tenga
        // los polígonos oficiales (distritosNuevo.json): queda en metadata.
        distritoId: null,
        solicitante: null,
        prioridadInformada: null,
        menciones: null,
        urlOrigen: null,
        contacto,
        creadoEn: parsearFecha(f["FECHA INICIO"], "dma"),
        metadata: {
          estado_ac: f.nombre_estado ?? null,
          oficina: f.nombre_oficina ?? null,
          reparticion: f.nombre_reparti ?? null,
          tipo_reclamo_ac: f.nombre_treclamo ?? null,
          categoria_ac: f.nombre_categoria ?? null,
          origen_ac: f.nombre_oreclamo ?? null,
          id_oreclamo: f.id_oreclamo ?? null,
          asunto: limpiarTexto(f.asunto),
          descripcion_lugar: limpiarTexto(f.descripcion_lugar),
          movimiento: f.detalle_movi ?? null,
          distrito_ac: typeof f.DISTRITO === "number" ? f.DISTRITO : null,
          coordenada_defecto: esCoordDefecto,
          id_persona: null,
          archivo: "OBRAS VIALES - SAT (463 RECLAMOS ABIERTOS).xlsx",
        },
      });
    });
}

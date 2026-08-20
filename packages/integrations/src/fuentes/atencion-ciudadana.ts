import { z } from "zod";
import type { DemandaNormalizada } from "@cimba/domain";
import { demandaNormalizadaSchema, normalizarDireccion } from "@cimba/domain";
import { limpiarTexto, mapearTipo, parsearFecha, puntoValido } from "../archivos/util";
import type { AdaptadorFuente } from "../tipos";

/**
 * Adaptador REAL de Atención Ciudadana.
 *
 * ⚠ BLOQUEADO hasta que el equipo de AC publique el listado incremental:
 *   GET /reclamos/listarPorRango?actualizado_desde=<ISO8601>&page=&limit=
 * Los endpoints existentes son por ID o criterio puntual y no permiten
 * sincronizar. Mientras tanto se usa el adaptador mock (CIMBA_FUENTE_AC=mock).
 *
 * El mapeo Reclamo AC → Demanda CIMBA ya queda implementado y probado con el
 * export real de 463 reclamos abiertos (mismo shape de columnas).
 */

const reclamoAcSchema = z.object({
  id_reclamo: z.number(),
  id_categoria: z.number().nullish(),
  nombre_categoria: z.string().nullish(),
  id_treclamo: z.number().nullish(),
  nombre_treclamo: z.string().nullish(),
  id_oreclamo: z.number().nullish(),
  nombre_oreclamo: z.string().nullish(),
  asunto: z.string().nullish(),
  detalle: z.string().nullish(),
  descripcion_lugar: z.string().nullish(),
  direccion: z.string().nullish(),
  coorde1: z.union([z.string(), z.number()]).nullish(),
  coorde2: z.union([z.string(), z.number()]).nullish(),
  id_distrito: z.number().nullish(),
  apellido_nombre: z.string().nullish(),
  telefono: z.string().nullish(),
  email: z.string().nullish(),
  cuit: z.union([z.string(), z.number()]).nullish(),
  id_persona: z.number().nullish(),
  fecha_hora_inicio: z.string().nullish(),
  nombre_estado: z.string().nullish(),
  nombre_prioridad: z.string().nullish(),
  id_prioridad: z.number().nullish(),
  foto: z.union([z.boolean(), z.number()]).nullish(),
});

export type ReclamoAc = z.infer<typeof reclamoAcSchema>;

export function mapearReclamoAc(r: ReclamoAc): DemandaNormalizada {
  const direccion = limpiarTexto(String(r.direccion ?? "").split(", SAN MIGUEL")[0]);
  const contacto: Record<string, unknown> = {};
  if (limpiarTexto(r.apellido_nombre)) contacto.nombre = limpiarTexto(r.apellido_nombre);
  if (limpiarTexto(r.telefono)) contacto.telefono = limpiarTexto(r.telefono);
  if (limpiarTexto(r.email)) contacto.email = limpiarTexto(r.email);
  if (limpiarTexto(r.cuit) && String(r.cuit) !== "0") contacto.cuit = limpiarTexto(r.cuit);

  return demandaNormalizadaSchema.parse({
    sistema: "atencion_ciudadana",
    idRemoto: String(r.id_reclamo),
    fuente: "atencion_ciudadana",
    tipo: mapearTipo(r.nombre_treclamo),
    descripcion: limpiarTexto(r.detalle) ?? limpiarTexto(r.asunto),
    direccionTexto: direccion,
    direccionNormalizada: direccion ? normalizarDireccion(direccion) : null,
    punto: puntoValido(r.coorde1, r.coorde2),
    geocodConfianza: puntoValido(r.coorde1, r.coorde2) ? 0.5 : null,
    // FK a distritos deshabilitada hasta cargar distritosNuevo.json (ver metadata)
    distritoId: null,
    solicitante: null,
    prioridadInformada: r.id_prioridad ?? null,
    menciones: null,
    urlOrigen: null,
    contacto,
    creadoEn: parsearFecha(r.fecha_hora_inicio, "dma"),
    metadata: {
      distrito_ac: r.id_distrito ?? null,
      estado_ac: r.nombre_estado ?? null,
      categoria_ac: r.nombre_categoria ?? null,
      tipo_reclamo_ac: r.nombre_treclamo ?? null,
      origen_ac: r.nombre_oreclamo ?? null,
      id_persona: r.id_persona ?? null,
      asunto: limpiarTexto(r.asunto),
      descripcion_lugar: limpiarTexto(r.descripcion_lugar),
      tiene_foto: Boolean(r.foto),
    },
  });
}

export function crearAdaptadorAtencionCiudadana(baseUrl: string): AdaptadorFuente {
  return {
    sistema: "atencion_ciudadana",
    async traerDemandas(desde: Date | null): Promise<DemandaNormalizada[]> {
      const demandas: DemandaNormalizada[] = [];
      let page = 1;
      const limit = 200;
      // Endpoint pendiente de publicación por el equipo de AC.
      for (;;) {
        const url = new URL("/reclamos/listarPorRango", baseUrl);
        if (desde) url.searchParams.set("actualizado_desde", desde.toISOString());
        url.searchParams.set("page", String(page));
        url.searchParams.set("limit", String(limit));
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (res.status === 404) {
          throw new Error(
            "GET /reclamos/listarPorRango todavía no existe en Atención Ciudadana. " +
              "Usá CIMBA_FUENTE_AC=mock hasta que el equipo de AC lo publique.",
          );
        }
        if (!res.ok) throw new Error(`Atención Ciudadana respondió ${res.status}`);
        const cuerpo = (await res.json()) as { data?: unknown[] };
        const lote = z.array(reclamoAcSchema).parse(cuerpo.data ?? []);
        demandas.push(...lote.map(mapearReclamoAc));
        if (lote.length < limit) break;
        page++;
      }
      return demandas;
    },
  };
}

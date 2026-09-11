"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { tipoIntervencionSchema } from "@cimba/domain";
import { requerirSesion, type Sesion } from "./auth";
import { empresaDelEjecutor } from "./ordenes";
import { ErrorVisible } from "./errores";
import { camposMedicion, resolverMedicion, volumenDe } from "./medicion";

/**
 * CARGA LIBRE: trabajo hecho SIN orden previa.
 *
 * Es el motivo real por el que el portal no se usaba. CIMBA solo dejaba
 * cargar contra un item de una orden emitida, pero las empresas también
 * trabajan por urgencia, por pedido del inspector o porque estaban ahí; el
 * Apps Script de la Dirección nunca les pidió una orden. De ahí el número que
 * ordena todo: 1.284 cargas allá contra 1 en el portal.
 *
 * Entra por el MISMO modelo que el resto — incidente reparado + intervención
 * finalizada + fotos — así aparece en el mapa, en las métricas y en la
 * certificación como cualquier otro trabajo. Pero queda marcado
 * `sin_orden: true` a propósito: no es lo mismo lo que el municipio encargó
 * que lo que la empresa decidió hacer, y la supervisión tiene que poder
 * separarlo de un vistazo. La carga entra, pero entra etiquetada.
 */

const claims = (s: Sesion) => ({
  sub: s.sub,
  rol_cimba: s.rol_cimba,
  id_persona: s.id_persona,
  id_empresa: s.id_empresa,
});

/** Misma whitelist server-side que el reporte de la orden: el bucket es
 *  público y el content-type lo fija el servidor, nunca el cliente. */
const TIPOS_FOTO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function reportarTrabajoLibre(formData: FormData) {
  const sesion = await requerirSesion();
  if (!["empresa", "cuadrilla", "admin", "planificacion"].includes(sesion.rol_cimba)) {
    throw new ErrorVisible(`Rol ${sesion.rol_cimba} sin permiso para cargar trabajos`);
  }

  const datos = z
    .object({
      direccion: z.string().min(3).max(300),
      lat: z.coerce.number().min(-27.2).max(-26.5),
      lon: z.coerce.number().min(-65.6).max(-64.9),
      // Las tres formas de medir el bache: ver lib/medicion.ts.
      ...camposMedicion,
      tipoTrabajo: z.enum(["bache", "carpeta"]).default("bache"),
      tipoIntervencion: tipoIntervencionSchema.optional(),
      tipoObra: z.enum(["provisorio", "planificado", "extendido", "sobre_adoquin"]).optional(),
      observaciones: z.string().max(2000).optional(),
      capataz: z.string().max(120).optional(),
      ticket147: z.string().max(40).optional(),
      /** Solo lo usa el staff en vista espejo; el ejecutor carga como él mismo. */
      empresaId: z.coerce.number().int().positive().optional(),
    })
    .parse({
      direccion: formData.get("direccion"),
      lat: formData.get("lat"),
      lon: formData.get("lon"),
      medicion: formData.get("medicion") || undefined,
      anchoM: formData.get("anchoM") || undefined,
      largoM: formData.get("largoM") || undefined,
      superficieM2: formData.get("superficieM2") || undefined,
      volumenM3: formData.get("volumenM3") || undefined,
      espesorCm: formData.get("espesorCm"),
      tipoTrabajo: formData.get("tipoTrabajo") || undefined,
      tipoIntervencion: formData.get("tipoIntervencion") || undefined,
      tipoObra: formData.get("tipoObra") || undefined,
      observaciones: formData.get("observaciones") || undefined,
      capataz: formData.get("capataz") || undefined,
      ticket147: formData.get("ticket147") || undefined,
      empresaId: formData.get("empresaId") || undefined,
    });

  const { dentroDeSMT } = await import("@cimba/domain");
  if (!dentroDeSMT({ lat: datos.lat, lon: datos.lon })) {
    throw new ErrorVisible("La ubicación cae fuera de San Miguel de Tucumán: revisá el pin");
  }

  /**
   * Un ejecutor carga SIEMPRE como su empresa y cualquier empresaId del
   * formulario se ignora — misma barrera que resolverVistaPortal. Como la RLS
   * está escrita pero no corre, esta línea es lo único que impide que una
   * contratista cargue trabajo a nombre de otra.
   */
  const propia = await empresaDelEjecutor(sesion);
  const empresaId = propia ?? datos.empresaId;
  if (empresaId == null) throw new ErrorVisible("Falta indicar la empresa que hizo el trabajo");

  const empresa = (
    await conRls(
      claims(sesion),
      async (tx) =>
        (await tx.execute(sql`
          select id, nombre from empresas where id = ${empresaId} and activa
        `)) as unknown as Array<{ id: number; nombre: string }>,
    )
  )[0];
  if (!empresa) throw new ErrorVisible("La empresa no existe o está inactiva");

  const validarFoto = (v: unknown, cual: string): File | null => {
    if (!(v instanceof File) || v.size === 0) return null;
    if (v.size > 8 * 1024 * 1024) throw new ErrorVisible(`La foto ${cual} supera 8 MB`);
    if (!TIPOS_FOTO[v.type]) {
      throw new ErrorVisible(`La foto ${cual} tiene que ser una imagen (JPG, PNG o WEBP)`);
    }
    return v;
  };
  const foto = validarFoto(formData.get("foto"), "del trabajo");
  if (!foto) throw new ErrorVisible("Falta la foto del trabajo terminado");
  const fotoAntes = validarFoto(formData.get("fotoAntes"), "de antes");

  let medida;
  try {
    medida = resolverMedicion(datos);
  } catch (e) {
    throw new ErrorVisible(e instanceof Error ? e.message : "Falta la medida del bache");
  }
  const superficie = medida.superficieM2;
  const volumen = volumenDe(superficie, medida.espesorCm);
  const tipoIntervencion =
    datos.tipoIntervencion ?? (datos.tipoTrabajo === "carpeta" ? "carpeta" : "bacheo");
  // Misma regla de escala que SIGOV y que el reporte de la orden: un paño o
  // una carpeta no se promedian con baches de 4 m².
  const esObra =
    tipoIntervencion === "carpeta" || tipoIntervencion === "pano_hormigon" || superficie >= 50;
  const tipoObra = datos.tipoObra ?? (superficie > 4 ? "extendido" : "planificado");

  /**
   * Las fotos van a Storage ANTES de tocar la base, igual que en el reporte
   * de la orden: si la subida falla no se tocó nada y el capataz reintenta de
   * cero. Si después falla la transacción, se borran en el catch — sin fila
   * que las referencie serían basura en un bucket público.
   */
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
  const subidas: string[] = [];
  const subirArchivo = async (archivo: File, momento: "antes" | "despues") => {
    const ruta = `libre/${empresaId}/${Date.now()}-${momento}.${TIPOS_FOTO[archivo.type]}`;
    const subida = await supabase.storage
      .from("fotografias")
      .upload(ruta, Buffer.from(await archivo.arrayBuffer()), {
        contentType: archivo.type,
        upsert: false,
      });
    if (subida.error) throw new ErrorVisible(`No se pudo subir la foto: ${subida.error.message}`);
    subidas.push(ruta);
    return { momento, ruta };
  };
  const fotos: Array<{ momento: "antes" | "despues"; ruta: string }> = [];
  if (fotoAntes) fotos.push(await subirArchivo(fotoAntes, "antes"));
  fotos.push(await subirArchivo(foto, "despues"));

  try {
    const incidenteId = await conRls(claims(sesion), async (tx) => {
      /**
       * Todo en UNA transacción, incidente incluido. En reportarItemHecho el
       * incidente sale por la conexión de servicio (la política de insert
       * escrita no contempla al rol empresa) y por eso hay que limpiarlo a
       * mano si el resto falla. Acá no hay orden que acote la fila: si algún
       * día se aplica la RLS, esta acción necesita su propia política por
       * empresa, no partirse en dos conexiones.
       */
      const inc = (await tx.execute(sql`
        insert into incidentes (tipo, estado, geom, direccion, superficie_m2, detectado_en, cerrado_en, metadata)
        values (
          ${datos.tipoTrabajo === "bache" ? "bache" : "pavimento_deteriorado"},
          'reparado', st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326),
          ${datos.direccion}, ${superficie}, now(), now(),
          ${JSON.stringify({ origen: "empresa_libre", sin_orden: true, empresa: empresa.nombre })}::jsonb
        ) returning id
      `)) as unknown as Array<{ id: number }>;
      const id = Number(inc[0]?.id);
      if (!id) throw new ErrorVisible("No se pudo registrar el trabajo");

      const iv = (await tx.execute(sql`
        insert into intervenciones (
          incidente_id, estado, geom_ejecucion, iniciada_en, finalizada_en,
          superficie_m2, volumen_m3, tipo_obra, tipo_intervencion, materiales, observaciones, metadata
        ) values (
          ${id}, 'finalizada',
          st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326),
          now(), now(), ${superficie}, ${volumen}, ${tipoObra}::tipo_obra_bacheo, ${tipoIntervencion},
          ${JSON.stringify({
            ...(medida.anchoM != null ? { ancho_m: medida.anchoM, largo_m: medida.largoM } : {}),
            espesor_cm: medida.espesorCm,
            medicion: medida.medicion,
          })}::jsonb,
          ${datos.observaciones ?? null},
          ${JSON.stringify({
            origen: "empresa_libre",
            sin_orden: true,
            // `contratista` es la clave que leen las métricas (misma que usa
            // SIGOV); `empresa` queda como alias por si algo la busca así.
            contratista: empresa.nombre,
            empresa: empresa.nombre,
            escala: esObra ? "obra" : "bache",
            medicion: medida.medicion,
            cargado_por: sesion.nombre,
            ...(datos.capataz ? { capataz: datos.capataz } : {}),
            ...(datos.ticket147 ? { ticket_147: datos.ticket147 } : {}),
          })}::jsonb
        ) returning id
      `)) as unknown as Array<{ id: number }>;
      const intervencionId = Number(iv[0]?.id);
      if (!intervencionId) throw new ErrorVisible("No se pudo registrar la intervención");

      for (const f of fotos) {
        await tx.execute(sql`
          insert into fotografias (intervencion_id, momento, storage_path, geom, tomada_en)
          values (${intervencionId}, ${f.momento}, ${f.ruta},
                  st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326), now())
        `);
      }
      return id;
    });

    revalidatePath("/empresa");
    revalidatePath("/intervenciones");
    revalidatePath("/mapa");
    return { ok: true, incidenteId };
  } catch (e) {
    if (subidas.length > 0) {
      await supabase.storage
        .from("fotografias")
        .remove(subidas)
        .catch(() => {});
    }
    throw e;
  }
}

"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { prioridadVialSchema } from "@cimba/domain";
import { requerirRol, requerirSesion, type Sesion } from "./auth";

/**
 * Acciones del ciclo de la orden de trabajo. El principio rector: cuando la
 * empresa reporta un bache hecho, acá se crea la INTERVENCIÓN real y se cierra
 * el incidente — la orden no es un mundo aparte, es la puerta de entrada al
 * mismo modelo que alimenta la brecha, las métricas y el cierre de reclamos.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ── Planificación (Director) ─────────────────────────────────────────────────

const tramoSchema = z.object({
  direccion: z.string().min(3).max(300),
  tipoTrabajo: z.enum(["bache", "carpeta", "tramo"]).default("tramo"),
  lat: z.number().min(-27.2).max(-26.5).optional(),
  lon: z.number().min(-65.6).max(-64.9).optional(),
});

export async function crearOrden(entrada: {
  empresaId: number;
  circuitoId?: number;
  prioridad: string;
  titulo?: string;
  indicaciones?: string;
  venceEn?: string; // YYYY-MM-DD
  incidenteIds: number[];
  tramos?: Array<z.infer<typeof tramoSchema>>;
}) {
  const sesion = await requerirRol("planificacion");
  const datos = z
    .object({
      empresaId: z.number().int().positive(),
      circuitoId: z.number().int().positive().optional(),
      prioridad: prioridadVialSchema,
      titulo: z.string().max(200).optional(),
      indicaciones: z.string().max(4000).optional(),
      venceEn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      incidenteIds: z.array(z.number().int().positive()).max(200),
      tramos: z.array(tramoSchema).max(50).default([]),
    })
    .parse(entrada);

  if (datos.incidenteIds.length === 0 && datos.tramos.length === 0) {
    throw new Error("La orden necesita al menos un bache o un tramo");
  }

  const ordenId = await conRls(claims(sesion), async (tx) => {
    const creada = (await tx.execute(sql`
      insert into ordenes_trabajo (numero, empresa_id, circuito_id, prioridad, titulo, indicaciones, vence_en, creada_por)
      values (
        'OT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ordenes_numero_seq')::text, 4, '0'),
        ${datos.empresaId}, ${datos.circuitoId ?? null}, ${datos.prioridad},
        ${datos.titulo ?? null}, ${datos.indicaciones ?? null}, ${datos.venceEn ?? null},
        ${sesion.sub}::uuid
      ) returning id
    `)) as unknown as Array<{ id: number }>;
    const orden = creada[0];
    if (!orden) throw new Error("No se pudo crear la orden");

    // Items desde incidentes: copian dirección y punto para que la empresa
    // los vea sin permisos extra, y un mismo incidente no entra dos veces
    // en órdenes activas.
    //
    // El anti-duplicado es un `not exists`, no una constraint: dos
    // planificadores armando la MISMA orden en el mismo instante podrían meter
    // el incidente en dos órdenes (sus transacciones no se ven entre sí). Es
    // aceptable hoy —planificación es un puñado de personas y el solapamiento
    // exacto es rarísimo—; si pasa a ser un problema, el arreglo es un índice
    // único parcial sobre orden_items.incidente_id para items pendientes.
    for (const incidenteId of datos.incidenteIds) {
      await tx.execute(sql`
        insert into orden_items (orden_id, incidente_id, direccion, geom, tipo_trabajo)
        select ${orden.id}, i.id, i.direccion, i.geom,
               case when i.tipo = 'pavimento_deteriorado' then 'carpeta' else 'bache' end
        from incidentes i
        where i.id = ${incidenteId}
          and not exists (
            select 1 from orden_items oi
            join ordenes_trabajo ot on ot.id = oi.orden_id
            where oi.incidente_id = i.id and oi.estado = 'pendiente'
              and ot.estado in ('borrador','emitida','en_ejecucion')
          )
      `);
    }
    for (const t of datos.tramos) {
      await tx.execute(sql`
        insert into orden_items (orden_id, direccion, geom, tipo_trabajo)
        values (${orden.id}, ${t.direccion},
          ${t.lat != null && t.lon != null ? sql`st_setsrid(st_makepoint(${t.lon}, ${t.lat}), 4326)` : sql`null`},
          ${t.tipoTrabajo})
      `);
    }

    const conteo = (await tx.execute(sql`
      select count(*)::int as n from orden_items where orden_id = ${orden.id}
    `)) as unknown as Array<{ n: number }>;
    if (Number(conteo[0]?.n ?? 0) === 0) {
      // Todos los incidentes elegidos ya estaban en otra orden activa.
      await tx.execute(sql`delete from ordenes_trabajo where id = ${orden.id}`);
      throw new Error("Todos los puntos elegidos ya están en otra orden activa");
    }
    return Number(orden.id);
  });

  revalidatePath("/ordenes");
  return { ok: true, ordenId };
}

/** Emitir: la orden pasa de borrador a la empresa; sus incidentes quedan programados. */
export async function emitirOrden(entrada: { ordenId: number }) {
  const sesion = await requerirRol("planificacion");
  const { ordenId } = z.object({ ordenId: z.number().int().positive() }).parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update ordenes_trabajo set estado = 'emitida', emitida_en = now()
      where id = ${ordenId} and estado = 'borrador'
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new Error("La orden no está en borrador");
    await tx.execute(sql`
      update incidentes set estado = 'programado'
      from orden_items oi
      where oi.orden_id = ${ordenId} and oi.incidente_id = incidentes.id
        and incidentes.estado in ('detectado','priorizado')
    `);
  });
  revalidatePath("/ordenes");
  revalidatePath("/empresa");
  return { ok: true };
}

export async function anularOrden(entrada: { ordenId: number; motivo: string }) {
  const sesion = await requerirRol("planificacion");
  const datos = z
    .object({ ordenId: z.number().int().positive(), motivo: z.string().min(3).max(500) })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update ordenes_trabajo set estado = 'anulada', cerrada_en = now(),
        metadata = metadata || jsonb_build_object('motivo_anulacion', ${datos.motivo}::text)
      where id = ${datos.ordenId} and estado in ('borrador','emitida','en_ejecucion')
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new Error("La orden no se puede anular en su estado actual");
    // Los incidentes que la orden había programado vuelven a la cola.
    await tx.execute(sql`
      update incidentes set estado = 'priorizado'
      from orden_items oi
      where oi.orden_id = ${datos.ordenId} and oi.incidente_id = incidentes.id
        and oi.estado = 'pendiente' and incidentes.estado = 'programado'
    `);
  });
  revalidatePath("/ordenes");
  revalidatePath("/empresa");
  return { ok: true };
}

// ── Asignación de circuitos y prioridades ────────────────────────────────────

export async function asignarCircuito(entrada: {
  circuitoId: number;
  empresaId?: number | null;
  prioridad?: string | null;
}) {
  const sesion = await requerirRol("planificacion");
  const datos = z
    .object({
      circuitoId: z.number().int().positive(),
      empresaId: z.number().int().positive().nullable().optional(),
      prioridad: prioridadVialSchema.nullable().optional(),
    })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update circuitos set
        empresa_id = case when ${datos.empresaId !== undefined} then ${datos.empresaId ?? null} else empresa_id end,
        prioridad = case when ${datos.prioridad !== undefined} then ${datos.prioridad ?? null}::prioridad_vial else prioridad end
      where id = ${datos.circuitoId}
    `);
  });
  revalidatePath("/ordenes");
  revalidatePath("/mapa");
  return { ok: true };
}

// ── Reporte de la empresa ────────────────────────────────────────────────────

/**
 * La empresa reporta un item hecho: medidas reales (a veces es un solo bache
 * pero se pavimenta el paño completo — vale lo medido, no lo estimado), foto
 * del después obligatoria, y opcionalmente una dirección corregida ya
 * georreferenciada (dictada por voz en el cliente + /api/geocodificar).
 *
 * Acá se crea la intervención REAL: finalizada, con superficie y espesor, y
 * el incidente pasa a reparado. Todo lo que mira la brecha y las métricas se
 * entera solo.
 */
export async function reportarItemHecho(formData: FormData) {
  const sesion = await requerirSesion();
  if (!["empresa", "admin", "planificacion"].includes(sesion.rol_cimba)) {
    throw new Error(`Rol ${sesion.rol_cimba} sin permiso para reportar items`);
  }

  const datos = z
    .object({
      itemId: z.coerce.number().int().positive(),
      anchoM: z.coerce.number().positive().max(50),
      largoM: z.coerce.number().positive().max(2000),
      espesorCm: z.coerce.number().positive().max(60),
      observaciones: z.string().max(2000).optional(),
      lat: z.coerce.number().min(-27.2).max(-26.5).optional(),
      lon: z.coerce.number().min(-65.6).max(-64.9).optional(),
      direccionCorregida: z.string().max(300).optional(),
    })
    .parse({
      itemId: formData.get("itemId"),
      anchoM: formData.get("anchoM"),
      largoM: formData.get("largoM"),
      espesorCm: formData.get("espesorCm"),
      observaciones: formData.get("observaciones") || undefined,
      lat: formData.get("lat") || undefined,
      lon: formData.get("lon") || undefined,
      direccionCorregida: formData.get("direccionCorregida") || undefined,
    });

  /**
   * El bucket "fotografias" es público, así que el tipo lo fija el servidor
   * desde una whitelist y no lo que declare el cliente: subir un .html con
   * content-type text/html lo serviría como página activa desde el origen de
   * Storage municipal. Solo imágenes de cámara.
   */
  const TIPOS_FOTO: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const validarFoto = (v: unknown, cual: string): File | null => {
    if (!(v instanceof File) || v.size === 0) return null;
    if (v.size > 8 * 1024 * 1024) throw new Error(`La foto ${cual} supera 8 MB`);
    if (!TIPOS_FOTO[v.type]) throw new Error(`La foto ${cual} tiene que ser una imagen (JPG, PNG o WEBP)`);
    return v;
  };
  const foto = validarFoto(formData.get("foto"), "del trabajo");
  if (!foto) throw new Error("Falta la foto del trabajo terminado");
  const fotoAntes = validarFoto(formData.get("fotoAntes"), "de antes");

  const superficie = Math.round(datos.anchoM * datos.largoM * 100) / 100;

  /**
   * Las fotos se suben a Storage ANTES de tocar la base. Antes iban después del
   * commit y el comentario decía "puede reintentar", pero era mentira: si la
   * subida fallaba, el item ya estaba marcado hecho y un reintento chocaba con
   * "ya fue reportado" — la intervención quedaba sin su foto obligatoria y sin
   * forma de adjuntarla. Ahora, si la subida falla, no se tocó nada y el
   * capataz reintenta de cero; los inserts en `fotografias` van DENTRO de la
   * transacción, con las rutas ya subidas. Un archivo que sobre en el bucket
   * (si la transacción falla después) es inocuo.
   */
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
  const subirArchivo = async (archivo: File, momento: "antes" | "despues") => {
    const ruta = `ordenes/${datos.itemId}/${momento}-${Date.now()}.${TIPOS_FOTO[archivo.type]}`;
    const subida = await supabase.storage
      .from("fotografias")
      .upload(ruta, Buffer.from(await archivo.arrayBuffer()), {
        contentType: archivo.type,
        upsert: false,
      });
    if (subida.error) throw new Error(`No se pudo subir la foto: ${subida.error.message}`);
    return { momento, ruta };
  };
  const fotos: Array<{ momento: "antes" | "despues"; ruta: string }> = [];
  if (fotoAntes) fotos.push(await subirArchivo(fotoAntes, "antes"));
  fotos.push(await subirArchivo(foto, "despues"));

  /**
   * El incidente de un tramo se crea por la conexión de servicio (ver abajo),
   * FUERA de la transacción. Si la transacción falla después, ese incidente
   * quedaría huérfano y marcado reparado: se anota acá para borrarlo en el
   * catch. Es el único insert del flujo que el rollback no alcanza.
   */
  let incidenteServicioId: number | null = null;

  const correr = async () => conRls(claims(sesion), async (tx) => {
    // El item, con su orden y empresa: RLS ya garantiza que la empresa solo
    // ve los suyos, pero se revalida acá para dar errores claros.
    const items = (await tx.execute(sql`
      select oi.id, oi.orden_id, oi.incidente_id, oi.direccion, oi.tipo_trabajo, oi.estado,
             st_y(oi.geom) as lat, st_x(oi.geom) as lon,
             ot.estado as orden_estado, ot.numero, ot.empresa_id, e.nombre as empresa_nombre
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      join empresas e on e.id = ot.empresa_id
      where oi.id = ${datos.itemId}
    `)) as unknown as Array<Record<string, unknown>>;
    const item = items[0];
    if (!item) throw new Error("El item no existe o no es de tu empresa");
    if (String(item.estado) !== "pendiente") throw new Error("Este item ya fue reportado");
    if (!["emitida", "en_ejecucion"].includes(String(item.orden_estado))) {
      throw new Error("La orden no está activa");
    }
    if (sesion.rol_cimba === "empresa" && Number(item.empresa_id) !== sesion.id_empresa) {
      throw new Error("El item no pertenece a tu empresa");
    }

    /**
     * Reclamo atómico ANTES de crear nada: dos capataces reportando el mismo
     * item a la vez (o un doble click que el botón no alcanzó a frenar)
     * pasarían los dos el chequeo de arriba, y cada uno crearía su propia
     * intervención. El segundo UPDATE espera el lock de fila del primero y su
     * `estado = 'pendiente'` ya no matchea: cero filas, error limpio, y el
     * rollback de esta transacción no deja nada a medias.
     */
    const reclamo = (await tx.execute(sql`
      update orden_items set estado = 'hecho'
      where id = ${datos.itemId} and estado = 'pendiente'
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!reclamo[0]) throw new Error("Este item ya fue reportado");

    const lat = datos.lat ?? (item.lat != null ? Number(item.lat) : null);
    const lon = datos.lon ?? (item.lon != null ? Number(item.lon) : null);
    if (lat == null || lon == null) {
      throw new Error("El item no tiene ubicación: cargá la dirección (podés dictarla) antes de reportar");
    }
    const direccion = datos.direccionCorregida ?? ((item.direccion as string) || null);

    // Incidente: el del item, o uno nuevo si el item era un tramo sin incidente.
    let incidenteId = item.incidente_id != null ? Number(item.incidente_id) : null;
    if (incidenteId == null) {
      /**
       * La política de insert de incidentes no incluye al rol empresa (y no
       * puede: en el momento del insert la fila nueva todavía no está ligada
       * a ninguna orden que la acote). La propiedad del item ya se validó
       * arriba, así que este único insert va por la conexión de servicio.
       */
      const { getDb } = await import("@cimba/db");
      const inc = (await getDb().execute(sql`
        insert into incidentes (tipo, estado, geom, direccion, superficie_m2, detectado_en, cerrado_en, metadata)
        values (
          ${String(item.tipo_trabajo) === "bache" ? "bache" : "pavimento_deteriorado"},
          'reparado', st_setsrid(st_makepoint(${lon}, ${lat}), 4326),
          ${direccion}, ${superficie}, now(), now(),
          ${JSON.stringify({ origen: "orden_trabajo", orden: item.numero })}::jsonb
        ) returning id
      `)) as unknown as Array<{ id: number }>;
      if (!inc[0]) throw new Error("No se pudo crear el incidente del tramo");
      incidenteId = Number(inc[0].id);
      incidenteServicioId = incidenteId;
      // El item queda apuntando al incidente creado, para trazabilidad.
      await tx.execute(sql`
        update orden_items set incidente_id = ${incidenteId} where id = ${datos.itemId}
      `);
    }

    // La intervención real. Escala: una carpeta es obra de paño completo y no
    // puede promediarse con baches de 4 m² (misma regla que SIGOV).
    const esCarpeta = String(item.tipo_trabajo) === "carpeta" || superficie >= 50;
    const iv = (await tx.execute(sql`
      insert into intervenciones (
        incidente_id, estado, geom_ejecucion, iniciada_en, finalizada_en,
        superficie_m2, materiales, observaciones, metadata
      ) values (
        ${incidenteId}, 'finalizada',
        st_setsrid(st_makepoint(${lon}, ${lat}), 4326),
        now(), now(), ${superficie},
        ${JSON.stringify({ ancho_m: datos.anchoM, largo_m: datos.largoM, espesor_cm: datos.espesorCm })}::jsonb,
        ${datos.observaciones ?? null},
        ${JSON.stringify({
          origen: "orden_trabajo",
          orden: item.numero,
          // `contratista` es la clave que leen las métricas y Migue (misma que
          // usa SIGOV); `empresa` queda como alias por si algo la busca así.
          contratista: item.empresa_nombre,
          empresa: item.empresa_nombre,
          escala: esCarpeta ? "obra" : "bache",
          ...(datos.direccionCorregida ? { direccion_corregida: datos.direccionCorregida } : {}),
        })}::jsonb
      ) returning id
    `)) as unknown as Array<{ id: number }>;
    const intervencionId = iv[0]?.id;
    if (!intervencionId) throw new Error("No se pudo registrar la intervención");

    // Las fotos ya están en Storage: acá solo se registran, dentro de la
    // transacción, para que la intervención nunca quede sin su evidencia.
    for (const f of fotos) {
      await tx.execute(sql`
        insert into fotografias (intervencion_id, momento, storage_path, geom, tomada_en)
        values (${intervencionId}, ${f.momento}, ${f.ruta},
                st_setsrid(st_makepoint(${lon}, ${lat}), 4326), now())
      `);
    }

    await tx.execute(sql`
      update incidentes set estado = 'reparado', cerrado_en = now(),
        superficie_m2 = coalesce(${superficie}, superficie_m2)
      where id = ${incidenteId} and estado <> 'verificado'
    `);

    await tx.execute(sql`
      update orden_items set
        estado = 'hecho',
        ancho_m = ${datos.anchoM}, largo_m = ${datos.largoM}, espesor_cm = ${datos.espesorCm},
        superficie_m2 = ${superficie},
        intervencion_id = ${intervencionId},
        reportado_en = now(), reportado_por = ${sesion.sub}::uuid,
        observaciones = ${datos.observaciones ?? null},
        direccion = coalesce(${datos.direccionCorregida ?? null}, direccion),
        geom = st_setsrid(st_makepoint(${lon}, ${lat}), 4326)
      where id = ${datos.itemId}
    `);

    /**
     * Lock de la orden antes de evaluar el cierre automático. Sin esto, dos
     * reportes concurrentes de los dos últimos items ven cada uno el pendiente
     * del otro (todavía sin commitear) y NINGUNO completa la orden. Con el
     * lock, el segundo espera al primero y ya ve su item hecho.
     */
    await tx.execute(sql`select 1 from ordenes_trabajo where id = ${Number(item.orden_id)} for update`);

    // La orden avanza sola: primera carga → en ejecución; sin pendientes → completada.
    await tx.execute(sql`
      update ordenes_trabajo set estado = 'en_ejecucion'
      where id = ${Number(item.orden_id)} and estado = 'emitida'
    `);
    await tx.execute(sql`
      update ordenes_trabajo set estado = 'completada', cerrada_en = now()
      where id = ${Number(item.orden_id)} and estado = 'en_ejecucion'
        and not exists (
          select 1 from orden_items oi
          where oi.orden_id = ${Number(item.orden_id)} and oi.estado = 'pendiente'
        )
    `);

    return { incidenteId };
  });

  try {
    const resultado = await correr();
    revalidatePath("/empresa");
    revalidatePath("/ordenes");
    revalidatePath("/incidentes");
    // El reporte crea una intervención finalizada y cierra el incidente: eso
    // mueve la brecha y agrega un reclamo a la bandeja de cierres.
    revalidatePath("/brecha");
    revalidatePath("/cierres");
    return { ok: true, superficie, incidenteId: resultado.incidenteId };
  } catch (e) {
    if (incidenteServicioId != null) {
      const { getDb } = await import("@cimba/db");
      await getDb()
        .execute(sql`delete from incidentes where id = ${incidenteServicioId}`)
        .catch(() => undefined); // si la limpieza falla, el error original manda igual
    }
    throw e;
  }
}

export async function reportarItemNoEncontrado(entrada: { itemId: number; motivo: string }) {
  const sesion = await requerirSesion();
  if (!["empresa", "admin", "planificacion"].includes(sesion.rol_cimba)) {
    throw new Error(`Rol ${sesion.rol_cimba} sin permiso`);
  }
  const datos = z
    .object({ itemId: z.number().int().positive(), motivo: z.string().min(3).max(500) })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update orden_items set estado = 'no_encontrado',
        observaciones = ${datos.motivo},
        reportado_en = now(), reportado_por = ${sesion.sub}::uuid
      where id = ${datos.itemId} and estado = 'pendiente'
        and exists (
          select 1 from ordenes_trabajo ot
          where ot.id = orden_id and ot.estado in ('emitida','en_ejecucion')
            -- Igual que reportarItemHecho: una empresa solo toca SUS items. Sin
            -- esto (y con la RLS sin aplicar hoy) una empresa podría marcar
            -- 'no encontrado' —y hasta cerrar— órdenes de otra iterando itemId.
            ${
              sesion.rol_cimba === "empresa"
                ? sql`and ot.empresa_id = ${sesion.id_empresa ?? -1}`
                : sql``
            }
        )
      returning orden_id
    `)) as unknown as Array<{ orden_id: number }>;
    const fila = r[0];
    if (!fila) throw new Error("El item no está pendiente o la orden no está activa");
    await tx.execute(sql`
      update ordenes_trabajo set estado = 'completada', cerrada_en = now()
      where id = ${Number(fila.orden_id)} and estado in ('emitida','en_ejecucion')
        and not exists (
          select 1 from orden_items oi
          where oi.orden_id = ${Number(fila.orden_id)} and oi.estado = 'pendiente'
        )
    `);
  });
  revalidatePath("/empresa");
  revalidatePath("/ordenes");
  return { ok: true };
}

// ── Cierre de reclamos desde Atención Ciudadana ─────────────────────────────

/**
 * El circuito completo: el vecino pidió, se reparó, y AC le responde y cierra
 * el reclamo. Solo se puede cerrar una demanda cuyo incidente esté reparado —
 * el botón no existe para promesas.
 */
export async function cerrarDemandaAtencion(entrada: { demandaId: number; respuesta?: string }) {
  const sesion = await requerirRol("atencion_ciudadana");
  const datos = z
    .object({ demandaId: z.number().int().positive(), respuesta: z.string().max(1000).optional() })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update demandas set estado = 'cerrada',
        metadata = metadata || jsonb_build_object(
          'cierre', jsonb_build_object(
            'en', now()::text,
            'por', ${sesion.nombre}::text,
            'respuesta', ${datos.respuesta ?? null}::text
          )
        )
      where id = ${datos.demandaId}
        and estado in ('recibida','en_validacion','vinculada')
        and exists (
          select 1 from demanda_incidente di
          join incidentes i on i.id = di.incidente_id
          where di.demanda_id = demandas.id and i.estado in ('reparado','verificado')
        )
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) {
      throw new Error("Solo se puede cerrar un reclamo cuyo problema ya esté reparado");
    }
  });
  revalidatePath("/cierres");
  revalidatePath("/demandas");
  return { ok: true };
}

// ── Claves de acceso de las empresas ─────────────────────────────────────────

/**
 * Genera (o regenera) la clave de acceso de una empresa. Se muestra UNA sola
 * vez: en la base queda el hash. El Director se la pasa al referente de la
 * empresa por el canal que prefiera.
 */
export async function generarClaveEmpresa(entrada: { empresaId: number }) {
  const sesion = await requerirRol("planificacion");
  const { empresaId } = z.object({ empresaId: z.number().int().positive() }).parse(entrada);

  // Legible por teléfono: sin caracteres ambiguos (0/O, 1/l/I).
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const clave = Array.from(randomBytes(10), (b) => alfabeto[b % alfabeto.length]).join("");

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update empresas set clave_hash = ${sha256(clave)} where id = ${empresaId} and activa
      returning slug
    `)) as unknown as Array<{ slug: string }>;
    if (!r[0]) throw new Error("La empresa no existe o está inactiva");
  });
  revalidatePath("/ordenes/empresas");
  return { ok: true, clave };
}

// ── Parámetros de capacidad ──────────────────────────────────────────────────

export async function actualizarCapacidad(entrada: {
  bachesPorTurno: number;
  turnosPorDia: number;
  toneladasPorTurno: number;
  bachesChicosPorTurno: number;
  carpetasPorTurno: number;
}) {
  const sesion = await requerirRol("planificacion");
  const datos = z
    .object({
      bachesPorTurno: z.number().positive().max(100),
      turnosPorDia: z.number().positive().max(4),
      toneladasPorTurno: z.number().positive().max(50),
      bachesChicosPorTurno: z.number().positive().max(100),
      carpetasPorTurno: z.number().positive().max(50),
    })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update parametros set valor = ${JSON.stringify({
        baches_por_turno: datos.bachesPorTurno,
        turnos_por_dia: datos.turnosPorDia,
        toneladas_por_turno: datos.toneladasPorTurno,
        baches_chicos_por_turno: datos.bachesChicosPorTurno,
        carpetas_por_turno: datos.carpetasPorTurno,
      })}::jsonb, actualizado_en = now()
      where clave = 'capacidad_bacheo'
    `);
  });
  revalidatePath("/ordenes");
  return { ok: true };
}

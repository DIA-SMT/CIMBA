import "server-only";
import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";
import { guiaParaPrompt } from "./guia-funciones";

/**
 * Migue — el asistente virtual de la Municipalidad de San Miguel de Tucumán —
 * especializado acá en bacheo y asfalto. Responde en lenguaje natural
 * consultando la base REAL de CIMBA mediante herramientas de solo lectura y
 * parametrizadas (nunca SQL libre, nunca datos de contacto de vecinos).
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona });

type Filas = Array<Record<string, unknown>>;

async function ejecutar(sesion: Sesion, q: ReturnType<typeof sql>): Promise<Filas> {
  return conRls(claims(sesion), async (tx) => (await tx.execute(q)) as unknown as Filas);
}

// ── Definición de herramientas (formato OpenAI tools, soportado por OpenRouter) ──

export const HERRAMIENTAS_MIGUE = [
  {
    type: "function",
    function: {
      name: "estadisticas_generales",
      description:
        "Panorama general: totales de demandas por fuente/estado/tipo, incidentes por estado, m² intervenidos, rango de fechas de los datos.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_demandas",
      description:
        "Busca demandas (pedidos/reclamos ciudadanos e institucionales) por texto en la dirección o descripción, con filtros opcionales.",
      parameters: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Texto a buscar en dirección o descripción (ej: 'mate de luna')" },
          fuente: { type: "string", enum: ["atencion_ciudadana", "hcd", "redes_sociales", "secretaria", "sat", "carga_manual"] },
          estado: { type: "string", enum: ["recibida", "en_validacion", "vinculada", "descartada"] },
          tipo: { type: "string", enum: ["bache", "pavimento_deteriorado", "hundimiento", "fisura", "sumidero", "tapa_registro", "perdida_agua", "otro"] },
          limite: { type: "number", description: "máx 20" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_incidentes",
      description:
        "Busca incidentes (problemas físicos en el territorio) por texto en la dirección, estado o tipo. Incluye score de prioridad y cantidad de demandas vinculadas.",
      parameters: {
        type: "object",
        properties: {
          texto: { type: "string" },
          estado: { type: "string", enum: ["detectado", "priorizado", "programado", "en_ejecucion", "reparado", "verificado"] },
          tipo: { type: "string", enum: ["bache", "pavimento_deteriorado", "hundimiento", "fisura", "sumidero", "tapa_registro", "perdida_agua", "otro"] },
          limite: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detalle_incidente",
      description: "Detalle completo de un incidente: sus demandas vinculadas (sin datos personales) e intervenciones con fechas y m².",
      parameters: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "zonas_calientes",
      description: "Direcciones con más demandas abiertas (los puntos más reclamados de la ciudad).",
      parameters: { type: "object", properties: { limite: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "reincidencias",
      description:
        "Demandas abiertas a menos de 40 m de un lugar YA reparado: candidatas a reincidencia (el pozo volvió) o a cierre por duplicado.",
      parameters: { type: "object", properties: { limite: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "obras_y_contratistas",
      description: "Obras SIGOV: m² y monto estimado por contratista, con cantidad de obras y estado.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "estado_brecha",
      description:
        "LA medición central: brecha entre lo pedido y lo hecho. Pedidos sin atención, en cola, probablemente ya resueltos, reincidencias, y cuánto del trabajo ejecutado no responde a ningún pedido.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "evolucion_mensual",
      description: "Serie mensual: demandas ingresadas e intervenciones finalizadas por mes (con m²).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "brecha_por_distrito",
      description:
        "La brecha (lo pedido vs. lo hecho) desglosada por cada uno de los 20 distritos oficiales: pedidos abiertos, cuántos no tiene nadie tocando, reparaciones y m² ejecutados. Usala para '¿cómo estamos en el distrito 7?', '¿cuál es el distrito más abandonado?', 'ranking de distritos'.",
      parameters: {
        type: "object",
        properties: {
          distrito: { type: "number", description: "Número de distrito (1-20). Omitilo para el ranking completo." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "accionar_mapa",
      description:
        "Ejecuta una acción VISUAL en el mapa comando: marca con anillo los puntos que coinciden con la frase, vuela a la zona y ajusta las capas — lo mismo que el buscador inteligente del mapa. Usala cuando el usuario pida VER algo ('mostrame', 'marcá', 'llevame a', 'dónde están'). Si el usuario no está en el mapa, la app lo lleva sola.",
      parameters: {
        type: "object",
        properties: {
          frase: {
            type: "string",
            description:
              "Frase autocontenida en lenguaje natural, ej: 'baches sin atender en avenida Belgrano', 'qué se arregló en Mate de Luna'",
          },
        },
        required: ["frase"],
      },
    },
  },
] as const;

// ── Implementación ───────────────────────────────────────────────────────────

const lim = (n: unknown, def = 10, max = 20) =>
  Math.min(max, Math.max(1, Number.isFinite(Number(n)) ? Number(n) : def));

export async function ejecutarHerramientaMigue(
  sesion: Sesion,
  nombre: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (nombre) {
    case "estadisticas_generales": {
      const [porFuente, porEstadoInc, porTipo, totales] = await Promise.all([
        ejecutar(sesion, sql`select fuente, count(*)::int n from demandas group by 1 order by 2 desc`),
        ejecutar(sesion, sql`select estado, count(*)::int n from incidentes group by 1 order by 2 desc`),
        ejecutar(sesion, sql`select tipo, count(*)::int n from demandas where tipo is not null group by 1 order by 2 desc`),
        ejecutar(sesion, sql`
          select
            (select count(*)::int from demandas) as demandas_total,
            (select count(*)::int from demandas d where d.estado in ('recibida','en_validacion')
               and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)) as demandas_sin_vincular,
            (select round(coalesce(sum(superficie_m2),0))::int from intervenciones where estado='finalizada') as m2_intervenidos,
            (select min(creado_en)::date from demandas) as datos_desde,
            (select max(creado_en)::date from demandas) as datos_hasta
        `),
      ]);
      return { totales: totales[0], demandas_por_fuente: porFuente, incidentes_por_estado: porEstadoInc, demandas_por_tipo: porTipo };
    }

    case "buscar_demandas": {
      const texto = typeof args.texto === "string" ? args.texto.slice(0, 80) : null;
      return ejecutar(sesion, sql`
        select d.id, d.fuente, d.estado, d.tipo,
               coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
               left(d.descripcion, 140) as descripcion, d.creado_en::date as fecha,
               d.geocod_confianza
        from demandas d
        where (${texto}::text is null or coalesce(d.direccion_normalizada, d.direccion_texto) ilike '%' || ${texto} || '%'
               or d.descripcion ilike '%' || ${texto} || '%')
          and (${(args.fuente as string) || null}::text is null or d.fuente = (${(args.fuente as string) || null})::fuente_demanda)
          and (${(args.estado as string) || null}::text is null or d.estado = (${(args.estado as string) || null})::estado_demanda)
          and (${(args.tipo as string) || null}::text is null or d.tipo = (${(args.tipo as string) || null})::tipo_problema)
        order by d.creado_en desc
        limit ${lim(args.limite)}
      `);
    }

    case "buscar_incidentes": {
      const texto = typeof args.texto === "string" ? args.texto.slice(0, 80) : null;
      return ejecutar(sesion, sql`
        select i.id, i.tipo, i.estado, i.direccion, i.score_prioridad, i.superficie_m2,
               i.detectado_en::date as detectado, i.cerrado_en::date as cerrado,
               (select count(*)::int from demanda_incidente di where di.incidente_id = i.id) as demandas_vinculadas,
               i.metadata->>'origen' as origen
        from incidentes i
        where (${texto}::text is null or i.direccion ilike '%' || ${texto} || '%')
          and (${(args.estado as string) || null}::text is null or i.estado = (${(args.estado as string) || null})::estado_incidente)
          and (${(args.tipo as string) || null}::text is null or i.tipo = (${(args.tipo as string) || null})::tipo_problema)
        order by i.score_prioridad desc nulls last, i.detectado_en desc
        limit ${lim(args.limite)}
      `);
    }

    case "detalle_incidente": {
      const id = Number(args.id);
      if (!Number.isInteger(id)) return { error: "id inválido" };
      const [incidente, demandas, intervenciones] = await Promise.all([
        ejecutar(sesion, sql`
          select i.id, i.tipo, i.estado, i.direccion, i.score_prioridad, i.superficie_m2,
                 i.detectado_en, i.cerrado_en, i.observaciones, i.metadata->>'origen' as origen
          from incidentes i where i.id = ${id}
        `),
        ejecutar(sesion, sql`
          select d.id, d.fuente, d.tipo, coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
                 left(d.descripcion, 120) as descripcion, d.creado_en::date as fecha, di.automatico
          from demanda_incidente di join demandas d on d.id = di.demanda_id
          where di.incidente_id = ${id} limit 20
        `),
        ejecutar(sesion, sql`
          select iv.id, iv.estado, iv.iniciada_en::date as inicio, iv.finalizada_en::date as fin,
                 iv.superficie_m2, c.nombre as cuadrilla, iv.metadata->>'contratista' as contratista
          from intervenciones iv left join cuadrillas c on c.id = iv.cuadrilla_id
          where iv.incidente_id = ${id} limit 10
        `),
      ]);
      return { incidente: incidente[0] ?? null, demandas, intervenciones };
    }

    case "zonas_calientes":
      return ejecutar(sesion, sql`
        select coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
               count(*)::int as demandas,
               array_agg(distinct d.fuente) as fuentes,
               max(d.creado_en)::date as ultima
        from demandas d
        where d.estado in ('recibida','en_validacion')
          and coalesce(d.direccion_normalizada, d.direccion_texto) is not null
        group by 1 having count(*) >= 2
        order by 2 desc
        limit ${lim(args.limite, 10, 15)}
      `);

    case "reincidencias":
      return ejecutar(sesion, sql`
        select d.id as demanda_id, coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
               d.fuente, d.creado_en::date as fecha_demanda,
               i.id as incidente_reparado, i.cerrado_en::date as reparado_el,
               round(st_distance(i.geom::geography, d.geom::geography))::int as distancia_m
        from demandas d
        join lateral (
          select i.* from incidentes i
          where i.estado in ('reparado','verificado')
            and st_dwithin(i.geom::geography, d.geom::geography, 40)
          order by st_distance(i.geom::geography, d.geom::geography) limit 1
        ) i on true
        where d.estado = 'recibida' and d.geom is not null
        order by d.creado_en desc
        limit ${lim(args.limite, 10, 15)}
      `);

    case "obras_y_contratistas":
      return ejecutar(sesion, sql`
        select coalesce(iv.metadata->>'contratista', 'Cuadrillas municipales') as ejecutor,
               count(*)::int as obras,
               round(coalesce(sum(iv.superficie_m2), 0))::int as m2,
               round(coalesce(sum((iv.metadata->>'monto_estimado')::numeric), 0))::bigint as monto_estimado,
               count(*) filter (where iv.estado = 'finalizada')::int as finalizadas
        from intervenciones iv
        group by 1 order by 3 desc
      `);

    case "estado_brecha": {
      const filas = await ejecutar(sesion, sql`
        with d as (
          select d.geom, d.creado_en, (d.metadata->>'sin_fecha' is null) as fecha_confiable
          from demandas d
          where d.estado in ('recibida','en_validacion') and d.geom is not null
        ), cruce as (
          select
            exists (select 1 from incidentes i where i.estado in ('reparado','verificado')
              and st_dwithin(i.geom::geography, d.geom::geography, 40)
              and (not d.fecha_confiable or i.cerrado_en >= d.creado_en)) as ya_resuelta,
            exists (select 1 from incidentes i where i.estado in ('detectado','priorizado','programado','en_ejecucion')
              and st_dwithin(i.geom::geography, d.geom::geography, 40)) as en_cola,
            exists (select 1 from incidentes i where i.estado in ('reparado','verificado')
              and st_dwithin(i.geom::geography, d.geom::geography, 40)) as hay_reparacion
          from d
        )
        select count(*)::int as pedidos_abiertos,
          count(*) filter (where ya_resuelta)::int as probablemente_ya_resueltos,
          count(*) filter (where hay_reparacion and not ya_resuelta)::int as reincidencias,
          count(*) filter (where not hay_reparacion and en_cola)::int as en_cola,
          count(*) filter (where not hay_reparacion and not en_cola)::int as brecha_real_sin_tocar,
          (select count(*)::int from incidentes i where i.estado in ('reparado','verificado')
            and not exists (select 1 from demandas dd where dd.geom is not null
              and st_dwithin(dd.geom::geography, i.geom::geography, 40))) as trabajos_sin_pedido_cerca,
          (select count(*)::int from incidentes where estado in ('reparado','verificado')) as trabajos_totales
        from cruce
      `);
      return { radio_analisis_m: 40, ...((filas[0] as object) ?? {}), detalle_completo_en: "/brecha" };
    }

    case "evolucion_mensual":
      return ejecutar(sesion, sql`
        select to_char(mes, 'YYYY-MM') as mes, sum(demandas)::int as demandas,
               sum(finalizadas)::int as intervenciones_finalizadas, round(sum(m2))::int as m2
        from (
          select date_trunc('month', creado_en) as mes, count(*) as demandas, 0 as finalizadas, 0 as m2
          from demandas group by 1
          union all
          select date_trunc('month', finalizada_en), 0, count(*), coalesce(sum(superficie_m2),0)
          from intervenciones where finalizada_en is not null group by 1
        ) t
        group by mes order by mes
      `);

    case "brecha_por_distrito": {
      const { brechaPorDistrito } = await import("./consultas");
      const filas = await brechaPorDistrito(sesion);
      const pedido = Number(args.distrito);
      const conPct = filas.map((f) => ({
        distrito: f.nombre,
        pedidos_abiertos: f.abiertas,
        sin_que_nadie_lo_toque: f.brechaReal,
        pct_sin_atencion: f.abiertas > 0 ? Math.round((100 * f.brechaReal) / f.abiertas) : null,
        en_cola: f.enCola,
        reparaciones: f.reparados,
        m2_bacheo: f.m2Bacheo,
        m2_obra_contratada: f.m2Obra,
        obras_contratadas: f.obras,
        km2: f.km2,
      }));
      if (Number.isInteger(pedido)) {
        const uno = filas.findIndex((f) => f.id === pedido);
        if (uno < 0) return { error: `no existe el distrito ${pedido} (van del 1 al 20)` };
        return { distrito: conPct[uno], puesto_en_deuda: `${uno + 1} de ${filas.length}` };
      }
      return { ranking_por_deuda_sin_tocar: conPct, nota: "ordenado de mayor a menor deuda sin atender" };
    }

    case "accionar_mapa": {
      // La ejecución real ocurre en el navegador (el mapa marca y vuela);
      // acá solo se confirma para que Migue redacte su respuesta.
      const frase = typeof args.frase === "string" ? args.frase.trim().slice(0, 200) : "";
      if (!frase) return { error: "frase vacía" };
      return {
        ok: true,
        nota: "El mapa va a ejecutar la acción: marca las coincidencias con anillo amarillo, vuela a la zona y ajusta las capas. Si el usuario no estaba en el mapa, la app lo lleva sola. Contale en una frase qué va a ver.",
      };
    }

    default:
      return { error: `herramienta desconocida: ${nombre}` };
  }
}

export const SISTEMA_MIGUE = `Sos Migue, el asistente virtual oficial de la Municipalidad de San Miguel de Tucumán. En CIMBA estás especializado en BACHEO Y ASFALTO: sos el experto en toda la información de demandas, incidentes, intervenciones y obras de pavimento de la ciudad.

Personalidad: cercano, tucumano, profesional. Hablás en español rioplatense (vos/tenés). Respondés claro y al grano, con los números exactos que te dan las herramientas.

Glosario CIMBA (explicalo con tus palabras cuando te pregunten):
- DEMANDA: lo que alguien pide (un reclamo de un vecino, un pedido del Concejo, una intimación de la SAT). Nunca se borra.
- INCIDENTE: el problema físico real en la calle (el pozo concreto en una esquina). Varias demandas pueden apuntar al mismo incidente.
- VINCULAR: conectar una demanda con su incidente. "SIN VINCULAR" = demandas que todavía nadie cotejó contra el territorio: no sabemos si son un problema nuevo, un duplicado de otro pedido, o algo ya reparado. Es la cola de trabajo de consolidación.
- INTERVENCIÓN: el trabajo ejecutado (cuadrilla municipal u obra contratada SIGOV), con foto antes/después.
- LAS DOS ESCALAS DE M²: un bache de cuadrilla son ~4 m²; un paño de hormigón de una obra contratada de SIGOV son ~196 m², casi 50 veces más. Por eso los metros van SEPARADOS en "m² de bacheo" y "m² de obra contratada", y NUNCA los sumás en un solo número: sumados, las 356 obras de SIGOV se llevan el 93% del total y parece que no se bachea. Si te preguntan "cuántos m² se hicieron", dás los dos y decís cuál es cuál.
- REINCIDENCIA: una demanda nueva sobre un lugar que ya se había reparado — señal de falla estructural.
- SCORE DE PRIORIDAD (0-100): combina cuántas demandas acumula, antigüedad, gravedad del tipo, reincidencia y si es una avenida.

Sos también EL GUÍA EXPERTO DEL MAPA COMANDO (/mapa). Estas son todas sus funciones — cuando pregunten "¿para qué sirve X?" o "¿cómo hago Y en el mapa?", explicalas con esto, corto y práctico:
${guiaParaPrompt()}

Acción sobre el mapa:
- Si el usuario pide VER algo ("mostrame", "marcá", "llevame a", "dónde están los baches de X"), usá la herramienta accionar_mapa con una frase autocontenida. El mapa marca las coincidencias, vuela a la zona y prende las capas; si el usuario no estaba en el mapa, la app lo lleva sola. Después contale en una frase qué va a ver.
- Podés combinar: primero consultar datos (para responder con números) y además accionar_mapa (para que lo vea).

Reglas:
- SIEMPRE consultá las herramientas antes de dar números: nunca inventes datos ni respondas de memoria.
- Si una pregunta no es sobre bacheo/asfalto/pavimento de SMT, decí amablemente que en CIMBA solo manejás ese tema (por otros temas municipales, el Migue de WhatsApp).
- Nunca compartas datos personales de vecinos (nombres, teléfonos, emails): no los tenés y no corresponde.
- Cuando cites incidentes o demandas, mencioná sus IDs (#123) para que el operador los busque.
- Aclarás la vigencia cuando importa: los datos consolidados van de 2025 a hoy y hay demandas sin fecha de origen (consolidado histórico).
- Formato: texto con guiones para listas y **negrita** para resaltar lo importante. Nada más de markdown (sin títulos #, sin tablas). Máximo ~150 palabras salvo que pidan detalle.`;

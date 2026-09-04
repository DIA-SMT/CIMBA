import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { FUENTES_DEMANDA, TIPOS_PROBLEMA } from "@cimba/domain";
import { leerSesion, type Sesion } from "@/lib/auth";
import { generarInformeIA, iaDisponible, type SegmentoInforme } from "@/lib/ia";

/**
 * Informe ejecutivo IA sobre el territorio (sin datos personales).
 *
 * El cliente manda los agregados visibles del mapa (compatibilidad con el
 * llamador actual) y, opcionalmente:
 *  - dias: la misma ventana temporal que filtra el mapa, para que los
 *    agregados del servidor midan lo mismo que se está viendo.
 *  - segmento: {dimension, valor} para un informe SOLO de ese recorte
 *    (una fuente, un distrito, un destino de resolución o un tipo de problema)
 *    en vez de informar todo — pedido explícito del Director.
 *
 * El servidor calcula acá (no confía en el cliente para esto):
 *  - deuda_que_quema: top de incidentes abiertos por score_prioridad, que ya
 *    pondera antigüedad × reclamos detrás × avenida/corredor principal.
 *  - deuda_por_destino: qué es de bacheo, qué de la SAT y qué de ingeniería.
 *  - pedidos: vecinales vs internos (volumen de trabajo sin denuncia vecinal).
 *  - trabajo_hecho: cerrados del período, con y sin pedido vecinal detrás.
 */

const DESTINOS = ["bacheo", "sat", "ingenieria"] as const;
// Pedidos que entran por el vecino vs detección propia del municipio.
const FUENTES_VECINALES = "('atencion_ciudadana','redes_sociales','hcd','sat')";
const FUENTES_INTERNAS = "('cuadrilla','secretaria','carga_manual','bachia')";

const agregadosSchema = z.object({
  periodo: z.string().max(40),
  incidentes: z.object({
    total: z.number(),
    por_macro: z.record(z.string(), z.number()),
    por_tipo: z.record(z.string(), z.number()),
  }),
  demandas: z.object({
    total: z.number(),
    por_fuente: z.record(z.string(), z.number()),
    sin_vincular: z.number(),
  }),
  m2_intervenidos: z.number(),
  zonas_calientes: z.array(z.object({ direccion: z.string().max(200), cantidad: z.number() })).max(8),
  // Opcionales: el llamador viejo del mapa sigue validando sin cambios.
  dias: z.number().int().positive().max(3650).nullish(),
  segmento: z
    .object({
      dimension: z.enum(["fuente", "distrito", "destino", "tipo"]),
      valor: z.string().min(1).max(120),
    })
    .nullish(),
});

/** Los enums de Postgres no perdonan: un valor inventado revienta el cast
 *  (22P02) y tira 500. Se valida contra el catálogo ANTES de tocar SQL. */
function validarSegmento(segmento: SegmentoInforme): string | null {
  if (segmento.dimension === "fuente" && !(FUENTES_DEMANDA as readonly string[]).includes(segmento.valor))
    return `fuente desconocida: ${segmento.valor}`;
  if (segmento.dimension === "destino" && !(DESTINOS as readonly string[]).includes(segmento.valor))
    return `destino desconocido: ${segmento.valor}`;
  if (segmento.dimension === "tipo" && !(TIPOS_PROBLEMA as readonly string[]).includes(segmento.valor))
    return `tipo desconocido: ${segmento.valor}`;
  return null;
}

interface AgregadosServidor {
  deuda_que_quema: Array<Record<string, unknown>>;
  deuda_por_destino: Array<Record<string, unknown>>;
  pedidos: { vecinales: number; internos: number };
  trabajo_hecho: { total: number; con_pedido_vecinal: number; sin_pedido_vecinal: number };
}

async function agregadosServidor(
  sesion: Sesion,
  dias: number | null,
  segmento: SegmentoInforme | null,
): Promise<AgregadosServidor | { error: string }> {
  const claims = { sub: sesion.sub, rol_cimba: sesion.rol_cimba, id_persona: sesion.id_persona, id_empresa: sesion.id_empresa };
  const fuenteSeg = segmento?.dimension === "fuente" ? segmento.valor : null;
  const destinoSeg = segmento?.dimension === "destino" ? segmento.valor : null;
  const tipoSeg = segmento?.dimension === "tipo" ? segmento.valor : null;

  return conRls(claims, async (tx) => {
    // El distrito llega por nombre (lo que muestra el mapa) o por id.
    let distritoId: number | null = null;
    if (segmento?.dimension === "distrito") {
      const filas = (await tx.execute(sql`
        select id from distritos
        where lower(nombre) = lower(${segmento.valor}) or id::text = ${segmento.valor}
        limit 1
      `)) as unknown as Array<{ id: number | string }>;
      if (!filas[0]) return { error: `distrito desconocido: ${segmento.valor}` };
      distritoId = Number(filas[0].id);
    }

    // Condiciones reutilizables (patrón "null = sin filtro" de consultas.ts).
    const condDemanda = sql`
      and (${fuenteSeg}::text is null or d.fuente = (${fuenteSeg})::fuente_demanda)
      and (${destinoSeg}::text is null or d.destino = (${destinoSeg})::destino_resolucion)
      and (${tipoSeg}::text is null or d.tipo = (${tipoSeg})::tipo_problema)
      and (${distritoId}::int is null or d.distrito_id = ${distritoId})
    `;
    // Un incidente "es" de una fuente/destino si alguna de sus demandas
    // vinculadas lo es (el incidente no tiene fuente ni destino propios).
    const condIncidente = sql`
      and (${tipoSeg}::text is null or i.tipo = (${tipoSeg})::tipo_problema)
      and (${distritoId}::int is null or i.distrito_id = ${distritoId})
      and (${fuenteSeg}::text is null or exists (
        select 1 from demanda_incidente di join demandas dd on dd.id = di.demanda_id
        where di.incidente_id = i.id and dd.fuente = (${fuenteSeg})::fuente_demanda))
      and (${destinoSeg}::text is null or exists (
        select 1 from demanda_incidente di join demandas dd on dd.id = di.demanda_id
        where di.incidente_id = i.id and dd.destino = (${destinoSeg})::destino_resolucion))
    `;

    // 1) La deuda que QUEMA: incidentes abiertos ordenados por score_prioridad
    //    (ya pondera antigüedad, reclamos detrás y avenida/corredor principal),
    //    NO por cantidad de veces pedido. En ejecución se excluye: ya tiene
    //    respuesta en la calle, no es deuda que quema.
    const queQuema = (await tx.execute(sql`
      select i.id, i.tipo::text as tipo, i.direccion,
             greatest(0, floor(extract(epoch from (now() - i.detectado_en)) / 86400))::int as dias_abierto,
             coalesce(i.score_prioridad, 0)::float as score_prioridad,
             (select count(*)::int from demanda_incidente di where di.incidente_id = i.id) as reclamos,
             (select dd.destino::text
                from demanda_incidente di join demandas dd on dd.id = di.demanda_id
                where di.incidente_id = i.id and dd.destino is not null
                group by dd.destino order by count(*) desc limit 1) as destino
      from incidentes i
      where i.estado in ('detectado','priorizado','programado')
        and (${dias}::int is null or i.detectado_en > now() - make_interval(days => ${dias}))
        ${condIncidente}
      order by i.score_prioridad desc nulls last, i.detectado_en asc
      limit 10
    `)) as unknown as Array<Record<string, unknown>>;

    // 2) Deuda pendiente por destino (bacheo / sat / ingenieria / sin
    //    clasificar), con desglose vecinal vs interno adentro de cada una:
    //    la deuda de la SAT o de ingeniería no se le imputa a bacheo.
    const porDestino = (await tx.execute(sql`
      select coalesce(d.destino::text, 'sin_clasificar') as destino,
             count(*)::int as pendientes,
             count(*) filter (where d.fuente in ${sql.raw(FUENTES_VECINALES)})::int as vecinales,
             count(*) filter (where d.fuente in ${sql.raw(FUENTES_INTERNAS)})::int as internas
      from demandas d
      where d.estado in ('recibida','en_validacion','vinculada')
        and (${dias}::int is null or d.creado_en > now() - make_interval(days => ${dias}))
        ${condDemanda}
      group by 1
      order by pendientes desc
    `)) as unknown as Array<Record<string, unknown>>;

    // 3) Volumen del período por origen: cuánto entró por el vecino y cuánto
    //    detectó el propio municipio sin que nadie lo denuncie.
    const pedidos = (await tx.execute(sql`
      select count(*) filter (where d.fuente in ${sql.raw(FUENTES_VECINALES)})::int as vecinales,
             count(*) filter (where d.fuente in ${sql.raw(FUENTES_INTERNAS)})::int as internos
      from demandas d
      where (${dias}::int is null or d.creado_en > now() - make_interval(days => ${dias}))
        ${condDemanda}
    `)) as unknown as Array<{ vecinales: number | string; internos: number | string }>;

    // 4) Trabajo terminado del período: con pedido vecinal detrás vs de oficio
    //    ("que la doctora vea el volumen de trabajo sin denuncia vecinal").
    const hecho = (await tx.execute(sql`
      select count(*)::int as total,
             count(*) filter (where exists (
               select 1 from demanda_incidente di join demandas dd on dd.id = di.demanda_id
               where di.incidente_id = i.id and dd.fuente in ${sql.raw(FUENTES_VECINALES)}
             ))::int as con_pedido_vecinal
      from incidentes i
      where i.estado in ('reparado','verificado')
        and (${dias}::int is null or i.cerrado_en > now() - make_interval(days => ${dias}))
        ${condIncidente}
    `)) as unknown as Array<{ total: number | string; con_pedido_vecinal: number | string }>;

    const totalHecho = Number(hecho[0]?.total ?? 0);
    const conVecinal = Number(hecho[0]?.con_pedido_vecinal ?? 0);
    return {
      deuda_que_quema: queQuema,
      deuda_por_destino: porDestino,
      pedidos: {
        vecinales: Number(pedidos[0]?.vecinales ?? 0),
        internos: Number(pedidos[0]?.internos ?? 0),
      },
      trabajo_hecho: {
        total: totalHecho,
        con_pedido_vecinal: conVecinal,
        sin_pedido_vecinal: totalHecho - conVecinal,
      },
    };
  });
}

export async function POST(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (!iaDisponible()) return NextResponse.json({ error: "IA no configurada" }, { status: 501 });

  const cuerpo = agregadosSchema.safeParse(await req.json());
  if (!cuerpo.success) return NextResponse.json({ error: "agregados inválidos" }, { status: 400 });

  const segmento = cuerpo.data.segmento ?? null;
  if (segmento) {
    const errorSegmento = validarSegmento(segmento);
    if (errorSegmento) return NextResponse.json({ error: errorSegmento }, { status: 400 });
  }

  try {
    const servidor = await agregadosServidor(sesion, cuerpo.data.dias ?? null, segmento);
    if ("error" in servidor) return NextResponse.json({ error: servidor.error }, { status: 400 });

    // Con segmento, los agregados del mapa (que son globales) pasan como
    // contexto para dimensionar, y las zonas calientes globales se omiten
    // para que no contaminen los focos del recorte.
    const mapa = {
      incidentes: cuerpo.data.incidentes,
      demandas: cuerpo.data.demandas,
      m2_intervenidos: cuerpo.data.m2_intervenidos,
    };
    const datos = segmento
      ? { periodo: cuerpo.data.periodo, contexto_global: mapa, ...servidor }
      : { periodo: cuerpo.data.periodo, ...mapa, zonas_calientes: cuerpo.data.zonas_calientes, ...servidor };

    const informe = await generarInformeIA(datos, segmento);
    return NextResponse.json({ informe });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error de IA" },
      { status: 502 },
    );
  }
}

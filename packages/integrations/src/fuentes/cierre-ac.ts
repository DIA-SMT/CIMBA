/**
 * CIERRE DE UN RECLAMO EN ATENCIÓN CIUDADANA.
 *
 * ── Cómo se cierra un trámite en AC ─────────────────────────────────────────
 *
 * El reclamo tiene una cabecera (`reclamo`) y una cadena de movimientos
 * (`mov_reclamo`). Al ingresarlo se inserta solo el primero: una derivación
 * automática, según la categoría y el tipo, hacia el área que corresponde. Ese
 * movimiento queda ABIERTO —sin fechas ni usuarios— hasta que alguien lo toma.
 *
 * Cerrar NO es insertar un registro. Son dos cosas, en este orden:
 *
 *   1. CERRAR el último movimiento: completarle la fecha de ingreso si está
 *      vacía, ponerle la de egreso, y dejar asentado quién lo tomó y quién lo
 *      cerró. "Nosotros ponemos quién empezó el trámite y quién lo cerró."
 *   2. INSERTAR el movimiento de cierre, con su estado y el texto que va a
 *      leer el ciudadano.
 *
 * "Puede haber un reclamo que tenga cinco movimientos y vos siempre vas a
 * tener que ver el último: el que tiene el autoincremental más alto."
 *
 * ── Por qué el cierre NO hereda la derivación del movimiento anterior ───────
 *
 * Era lo que hacía la primera versión de este módulo, y está mal. Lo corrigió
 * Atención Ciudadana (02/10):
 *
 *   "Se supone que para que INTERVENGA el de Bacheo, se lo pasaron al reclamo.
 *    Ustedes, al hacerlo por fuera del sistema porque hacen la identificación
 *    automática, no es siempre el movimiento anterior desde Bacheo. El
 *    movimiento que insertan debe contener la derivación a OBRAS VIALES, y el
 *    usuario que lo ingresa para poder finalizarlo es de Obras Viales."
 *
 * Ahí está la diferencia de fondo entre los dos sistemas: en AC un reclamo
 * llega a Bacheo porque alguien se lo derivó; en CIMBA, porque el sistema lo
 * identificó solo. Heredar la derivación del anterior haría que el cierre
 * dijera que lo resolvió el área que lo tenía antes — que puede ser cualquiera.
 *
 * La derivación correcta sale de `derivacion_reclamo`, que mapea
 * (tipo de reclamo → oficina destino). `primera = 1` es la derivación
 * automática del alta; las posteriores, las que hace una persona durante el
 * trámite, son `primera = 0`. Un cierre nuestro es de las segundas.
 */

/** Dirección de Obras Viales en AC: es la que "ve Bacheo". */
export const OFICINA_OBRAS_VIALES = 21;
export const REPARTICION_OBRAS_VIALES = 511;

/** Secretaría de Obras Públicas: la que está por encima de Obras Viales. */
export const REPARTICION_OBRAS_PUBLICAS = 510;

/**
 * QUIÉNES PUEDEN FIRMAR UN CIERRE.
 *
 * Atención Ciudadana pidió que el usuario que finaliza sea "de Obras Viales
 * (que ve Bacheo)", y por eso la primera versión exigía la repartición 511 a
 * secas. Con eso, el Secretario de Obras Públicas no podía cerrar: Leonardo
 * Míguez tiene usuario en AC —el 207— pero está en la 510, que es la
 * Secretaría de la que depende Obras Viales, no la Dirección.
 *
 * Se habilitan las dos. Dejar afuera a quien está por encima del área sería
 * una regla que la realidad desmiente el primer día.
 *
 * El movimiento que se inserta sigue llevando repartición 511 y oficina 21:
 * eso describe A QUÉ ÁREA corresponde el trabajo, y no cambia porque lo firme
 * el Secretario. Quién lo firmó va en usuario_ingreso y usuario_egreso.
 */
export const REPARTICIONES_QUE_CIERRAN: number[] = [
  REPARTICION_OBRAS_VIALES,
  REPARTICION_OBRAS_PUBLICAS,
];

/** Estados de `estado_reclamo`. */
export const ESTADO_AC = {
  iniciado: 1,
  derivado: 2,
  enProceso: 3,
  finalizado: 4,
  finalizadoSinSolucion: 5,
  finalizadoConDerivacionExt: 6,
  finalizadoConDerivacion: 7,
} as const;

/** `motivo`. El 4 es el que indicó AC para un cierre. */
export const MOTIVO_AC = {
  inicioTramite: 1,
  incorporacionDocumentacion: 2,
  verificacionEnElLugar: 3,
  finalizacionTramite: 4,
  tratamientoAdministrativo: 5,
  comunicacionAlCiudadano: 6,
  verificacionYDespeje: 7,
  intervencion: 8,
} as const;

/**
 * CÓMO TERMINÓ EL RECLAMO PARA NOSOTROS, Y QUÉ ESTADO LE CORRESPONDE EN AC.
 *
 * El mapeo lo dictó Atención Ciudadana y no es el que uno supondría leyendo la
 * tabla de estados: derivar a otra área del municipio NO finaliza el trámite
 * —lo deja en proceso—, y el 6 está reservado para lo que no es competencia
 * del municipio. El 7 ("finalizado con derivación") no se usa.
 *
 *   reparado         el bache se hizo                              → 4
 *   derivado_interno pasa a otra área del municipio, sigue abierto → 3
 *   sin_resolver     se cierra pero el problema no se resolvió     → 5
 *   no_compete       es de la SAT, EDET, Gasnor…                   → 6
 */
export const DESENLACES = ["reparado", "derivado_interno", "sin_resolver", "no_compete"] as const;
export type Desenlace = (typeof DESENLACES)[number];

export const ESTADO_POR_DESENLACE: Record<Desenlace, number> = {
  reparado: ESTADO_AC.finalizado,
  derivado_interno: ESTADO_AC.enProceso,
  sin_resolver: ESTADO_AC.finalizadoSinSolucion,
  no_compete: ESTADO_AC.finalizadoConDerivacionExt,
};

const ESTADOS_YA_CERRADO: number[] = [
  ESTADO_AC.finalizado,
  ESTADO_AC.finalizadoSinSolucion,
  ESTADO_AC.finalizadoConDerivacionExt,
];

export interface PedidoCierreAc {
  /** `reclamo.id_reclamo` en Atención Ciudadana. */
  idReclamo: number;
  /**
   * `usuario.id_usuario` de Atención Ciudadana — NO el id_persona de CIDITUC
   * ni el usuario de MySQL. Tiene que pertenecer a Obras Viales (repartición
   * 511): es la condición que puso AC para que el cierre sea válido.
   */
  idUsuarioAc: number;
  /** Lo que va a leer el ciudadano. */
  detalle: string;
  desenlace?: Desenlace;
  idMotivo?: number;
}

export interface MovimientoAc {
  id_movi: number;
  id_reclamo: number;
  id_derivacion: number;
  id_oficina: number;
  fecha_ingreso: Date | null;
  fecha_egreso: Date | null;
  id_estado: number | null;
  id_motivo: number;
  reparti_graba: number;
  usuario_ingreso: number | null;
  usuario_egreso: number | null;
}

export interface SentenciaPlan {
  descripcion: string;
  sql: string;
  /** Lo que mysql2 acepta como valores: nada de objetos sueltos. */
  parametros: Array<string | number | null>;
}

export interface PlanCierreAc {
  idReclamo: number;
  ultimoMovimiento: MovimientoAc | null;
  /** La derivación a Obras Viales que corresponde al tipo de este reclamo. */
  idDerivacion: number | null;
  desenlace: Desenlace;
  idEstado: number;
  sentencias: SentenciaPlan[];
  /** Motivos por los que NO habría que ejecutar esto. Vacío = se puede. */
  impedimentos: string[];
}

export interface ConexionAc {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * La credencial de ESCRITURA va aparte de la de SIGOV a propósito.
 *
 * MYSQL_BACHEO_* es de solo lectura y así tiene que quedarse: CIMBA lee obras
 * de SIGOV y no tiene por qué poder tocarlas. El usuario que escribe en
 * Atención Ciudadana tiene SELECT, INSERT, UPDATE y EXECUTE sobre esa base y
 * nada más —sin DELETE, que para un cierre no hace falta—, y el día que se
 * reemplace por un usuario de servicio se cambia acá y en ningún otro lado.
 *
 * Si MYSQL_AC_USER no está, cae a la de lectura: el modo simulado solo
 * necesita SELECT y tiene que poder correr igual.
 */
export function conexionAcDesdeEntorno(): ConexionAc {
  if (!process.env.MYSQL_BACHEO_HOST) {
    throw new Error("Falta configurar MYSQL_BACHEO_HOST en el .env.");
  }
  const user = process.env.MYSQL_AC_USER ?? process.env.MYSQL_BACHEO_USER;
  const password = process.env.MYSQL_AC_PASSWORD ?? process.env.MYSQL_BACHEO_PASSWORD;
  if (!user || !password) {
    throw new Error("Falta el usuario o la clave de MySQL (MYSQL_AC_* o MYSQL_BACHEO_*).");
  }
  return {
    host: process.env.MYSQL_BACHEO_HOST,
    port: Number(process.env.MYSQL_BACHEO_PORT ?? 3306),
    user,
    password,
    database: process.env.MYSQL_AC_DB ?? "smt_atencion_ciudadana",
  };
}

/** "simulado" (por defecto) arma el plan y no toca nada; "real" lo ejecuta. */
export function modoCierreAc(): "simulado" | "real" {
  return process.env.CIMBA_AC_CIERRE === "real" ? "real" : "simulado";
}

/**
 * Arma el plan de cierre. Solo SELECT: se puede llamar siempre, incluso sin
 * permisos de escritura, y es lo que hace que el modo simulado muestre números
 * reales y no inventados.
 */
export async function planificarCierreAc(
  pedido: PedidoCierreAc,
  conf: ConexionAc = conexionAcDesdeEntorno(),
): Promise<PlanCierreAc> {
  const desenlace = pedido.desenlace ?? "reparado";
  const idEstado = ESTADO_POR_DESENLACE[desenlace];
  const idMotivo = pedido.idMotivo ?? MOTIVO_AC.finalizacionTramite;
  const impedimentos: string[] = [];

  const { default: mysql } = await import("mysql2/promise");
  const cx = await mysql.createConnection({ ...conf, connectTimeout: 20_000 });
  try {
    const [movs] = await cx.query(
      `select id_movi, id_reclamo, id_derivacion, id_oficina, fecha_ingreso, fecha_egreso,
              id_estado, id_motivo, reparti_graba, usuario_ingreso, usuario_egreso
         from mov_reclamo where id_reclamo = ? order by id_movi desc limit 1`,
      [pedido.idReclamo],
    );
    const ultimo = (movs as unknown as MovimientoAc[])[0] ?? null;

    if (!ultimo) {
      impedimentos.push(
        `El reclamo ${pedido.idReclamo} no tiene movimientos: o no existe o no llegó a derivarse.`,
      );
      return {
        idReclamo: pedido.idReclamo,
        ultimoMovimiento: null,
        idDerivacion: null,
        desenlace,
        idEstado,
        sentencias: [],
        impedimentos,
      };
    }
    if (ultimo.id_estado != null && ESTADOS_YA_CERRADO.includes(ultimo.id_estado)) {
      impedimentos.push(
        `El último movimiento (${ultimo.id_movi}) ya está en estado ${ultimo.id_estado}: el trámite está cerrado.`,
      );
    }

    /**
     * Quien cierra tiene que ser de Obras Viales. Sin esto, un id de usuario
     * mal configurado produciría cierres a nombre de otra repartición, que es
     * exactamente lo que AC pidió que no pase.
     */
    const [usuarios] = await cx.query(
      `select id_usuario, nombre_usuario, id_reparticion, habilita from usuario where id_usuario = ?`,
      [pedido.idUsuarioAc],
    );
    const usuario = (
      usuarios as unknown as Array<{ id_reparticion: number; habilita: number; nombre_usuario: string }>
    )[0];
    if (!usuario) {
      impedimentos.push(
        `El usuario ${pedido.idUsuarioAc} no existe en Atención Ciudadana. Hay que darlo de alta en Obras Viales.`,
      );
    } else if (!REPARTICIONES_QUE_CIERRAN.includes(usuario.id_reparticion)) {
      impedimentos.push(
        `El usuario ${pedido.idUsuarioAc} (${usuario.nombre_usuario}) es de la repartición ${usuario.id_reparticion}; cerrar solo pueden las ${REPARTICIONES_QUE_CIERRAN.join(" y ")} (Obras Viales y su Secretaría).`,
      );
    } else if (!usuario.habilita) {
      impedimentos.push(`El usuario ${pedido.idUsuarioAc} está deshabilitado en Atención Ciudadana.`);
    }

    /**
     * La derivación a Obras Viales del tipo de ESTE reclamo. Se prefiere la de
     * `primera = 0`: la de `primera = 1` es la del alta automática, y un cierre
     * nuestro es una derivación posterior hecha durante el trámite.
     */
    const [derivs] = await cx.query(
      `select d.id_derivacion, d.primera
         from reclamo r
         join derivacion_reclamo d on d.id_treclamo = r.id_treclamo
        where r.id_reclamo = ? and d.id_oficina_deriva = ? and d.habilita = 1
        order by d.primera asc, d.id_derivacion desc`,
      [pedido.idReclamo, OFICINA_OBRAS_VIALES],
    );
    const idDerivacion =
      (derivs as unknown as Array<{ id_derivacion: number }>)[0]?.id_derivacion ?? null;
    if (idDerivacion == null) {
      impedimentos.push(
        `No hay derivación habilitada a Obras Viales para el tipo de este reclamo: no es un reclamo que le competa a Bacheo.`,
      );
    }

    if (!pedido.detalle.trim()) {
      impedimentos.push("El detalle no puede ir vacío: es el texto que lee el ciudadano.");
    }

    const sentencias: SentenciaPlan[] =
      idDerivacion == null
        ? []
        : [
            {
              /**
               * El `coalesce` de la fecha de ingreso traduce el caso que
               * describió AC: el movimiento de la derivación automática nunca
               * fue tomado por nadie y llega con las dos fechas y los dos
               * usuarios en null. Cerrarlo dejando el ingreso vacío haría que
               * la historia dijera que el trámite se egresó sin haber entrado.
               */
              descripcion: `Cerrar el movimiento ${ultimo.id_movi}, que está abierto`,
              sql: `update mov_reclamo
                       set fecha_ingreso   = coalesce(fecha_ingreso, now()),
                           fecha_egreso    = now(),
                           usuario_ingreso = coalesce(usuario_ingreso, ?),
                           usuario_egreso  = ?
                     where id_movi = ? and id_reclamo = ?`,
              parametros: [pedido.idUsuarioAc, pedido.idUsuarioAc, ultimo.id_movi, pedido.idReclamo],
            },
            {
              /**
               * Derivación, oficina y repartición son las de OBRAS VIALES, no
               * las heredadas del movimiento anterior. `foto` va en 0: las
               * fotos del trabajo viven en CIMBA y se referencian en el texto.
               */
              descripcion: "Insertar el movimiento de cierre, derivado a Obras Viales",
              sql: `insert into mov_reclamo
                      (id_reclamo, id_derivacion, id_oficina, fecha_ingreso, fecha_egreso,
                       detalle_movi, id_estado, id_motivo, reparti_graba, foto,
                       usuario_ingreso, usuario_egreso)
                    values (?, ?, ?, now(), now(), ?, ?, ?, ?, 0, ?, ?)`,
              parametros: [
                pedido.idReclamo,
                idDerivacion,
                OFICINA_OBRAS_VIALES,
                pedido.detalle.trim(),
                idEstado,
                idMotivo,
                REPARTICION_OBRAS_VIALES,
                pedido.idUsuarioAc,
                pedido.idUsuarioAc,
              ],
            },
          ];

    return {
      idReclamo: pedido.idReclamo,
      ultimoMovimiento: ultimo,
      idDerivacion,
      desenlace,
      idEstado,
      sentencias,
      impedimentos,
    };
  } finally {
    await cx.end();
  }
}

/**
 * ── DE ACÁ EN ADELANTE, EL CIERRE VA POR HTTP ───────────────────────────────
 *
 * Lo de arriba lee el MySQL de Atención Ciudadana y arma el plan. Sirve para
 * diagnosticar y para probar desde adentro de la red municipal, pero NO puede
 * ser el camino de producción: ese MySQL vive en 172.16.8.214, una dirección
 * privada, y CIMBA corre en Vercel. Desde ahí no hay forma de llegar, con
 * permisos o sin ellos.
 *
 * La salida fue que el cierre viva del lado de ellos: Sistemas montó
 * POST /reclamos/cerrar sobre el mismo backend público que ya consumimos para
 * leer. Hace exactamente las dos operaciones en una transacción, con las
 * mismas validaciones, y devuelve el id_movi que creó.
 *
 * Probado el 08/10 contra el endpoint real: las siete guardas responden
 * —faltan de campos, usuario inexistente, usuario de otra repartición, usuario
 * deshabilitado, reclamo inexistente, trámite ya cerrado, estado inválido— y
 * ninguna escribe.
 */

/** El endpoint de cierre, sobre el mismo host que ya se usa para leer. */
function urlCierre(): URL {
  const base = process.env.CIMBA_API_ATENCION_CIUDADANA;
  if (!base) throw new Error("CIMBA_API_ATENCION_CIUDADANA no configurada");
  return new URL("/reclamos/cerrar", base);
}

export interface ResultadoCierreAc {
  modo: "simulado" | "real";
  idReclamo: number;
  /** Exactamente lo que se mandó (o se habría mandado, en simulado). */
  enviado: {
    id_reclamo: number;
    id_usuario: number;
    detalle: string;
    id_estado: number;
  };
  aplicado: boolean;
  /** El movimiento de cierre que creó Atención Ciudadana. */
  idMovimientoCierre: number | null;
  estadoHttp: number | null;
  /** Lo que respondió la API, tal cual, para poder mostrarlo. */
  mensaje: string | null;
  /** Falla de red o de parseo. Un 409 NO es esto: es un desenlace. */
  error: string | null;
}

/**
 * Cierra el reclamo en Atención Ciudadana.
 *
 * En modo "simulado" devuelve el cuerpo que mandaría sin llamar a nadie — es
 * el modo por defecto, y el que permite desplegar sin tocar el sistema de otra
 * dirección hasta que se decida encenderlo.
 *
 * El 409 ("el trámite ya está cerrado") vuelve con aplicado=false y sin error:
 * no es una falla, es que alguien lo cerró antes por el sistema de ellos, y
 * reintentarlo no va a cambiar nada.
 */
export async function cerrarReclamoAc(pedido: PedidoCierreAc): Promise<ResultadoCierreAc> {
  const desenlace = pedido.desenlace ?? "reparado";
  const enviado = {
    id_reclamo: pedido.idReclamo,
    id_usuario: pedido.idUsuarioAc,
    detalle: pedido.detalle.trim(),
    id_estado: ESTADO_POR_DESENLACE[desenlace],
  };
  const base = {
    idReclamo: pedido.idReclamo,
    enviado,
    aplicado: false,
    idMovimientoCierre: null,
    estadoHttp: null,
    mensaje: null,
    error: null,
  };

  if (modoCierreAc() === "simulado") {
    return { ...base, modo: "simulado" as const };
  }

  try {
    const { postJsonSmtDetallado } = await import("./https-smt");
    const r = await postJsonSmtDetallado(urlCierre(), enviado);
    const cuerpo = (r.cuerpo ?? {}) as { message?: string; id_movi?: number };
    return {
      ...base,
      modo: "real" as const,
      aplicado: r.estado === 200,
      idMovimientoCierre: cuerpo.id_movi ?? null,
      estadoHttp: r.estado,
      mensaje: cuerpo.message ?? r.texto.slice(0, 200) ?? null,
      error: null,
    };
  } catch (e) {
    return {
      ...base,
      modo: "real" as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

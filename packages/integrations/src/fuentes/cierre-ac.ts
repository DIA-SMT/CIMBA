/**
 * CIERRE DE UN RECLAMO EN ATENCIÓN CIUDADANA.
 *
 * ── Cómo se cierra un trámite en AC, según la Dirección ─────────────────────
 *
 * El reclamo tiene una cabecera (`reclamo`) y una cadena de movimientos
 * (`mov_reclamo`). Al ingresar un reclamo se inserta solo el primer movimiento:
 * una derivación automática, según la categoría y el tipo, hacia el área que
 * corresponde. Ese movimiento queda ABIERTO — sin fecha de ingreso ni de
 * egreso, sin usuario que ingresa ni que egresa— hasta que alguien lo toma.
 *
 * Cerrar NO es insertar un registro. Son dos cosas, en este orden:
 *
 *   1. CERRAR el último movimiento: completarle la fecha de ingreso si está
 *      vacía, ponerle fecha de egreso, y dejar asentado quién lo tomó y quién
 *      lo cerró. "Nosotros ponemos quién empezó el trámite y quién lo cerró."
 *   2. INSERTAR el movimiento de cierre, con el estado finalizado y el texto
 *      que va a leer el ciudadano.
 *
 * "Puede haber un reclamo que tenga cinco movimientos y vos siempre vas a
 * tener que ver el último: el que tiene el autoincremental más alto."
 *
 * ── Por qué esto todavía no escribe ─────────────────────────────────────────
 *
 * El usuario con el que CIMBA llega a ese MySQL tiene `GRANT SELECT ON *.*` y
 * nada más; el rol `desaia` que también tiene, lo mismo. Verificado el 02/10.
 * Así que este módulo nace en modo SIMULADO: arma las dos sentencias exactas,
 * con los parámetros reales leídos de la base, y las devuelve sin ejecutarlas.
 *
 * No es un placeholder. Es lo que permite mostrarle a DITEC la operación
 * completa —sobre reclamos reales— antes de que nadie otorgue un permiso de
 * escritura sobre la base de otro sistema. Cuando esté el acceso, se cambia
 * CIMBA_AC_CIERRE a "real" y el mismo plan se ejecuta.
 */

/** Estados de `estado_reclamo`. Los tres de finalización cierran el trámite. */
export const ESTADO_AC = {
  iniciado: 1,
  derivado: 2,
  enProceso: 3,
  finalizado: 4,
  finalizadoSinSolucion: 5,
  finalizadoConDerivacionExt: 6,
  finalizadoConDerivacion: 7,
} as const;

/** `motivo`. El 6 es el que corresponde cuando el texto lo lee el vecino. */
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

const ESTADOS_YA_CERRADO: number[] = [
  ESTADO_AC.finalizado,
  ESTADO_AC.finalizadoSinSolucion,
  ESTADO_AC.finalizadoConDerivacionExt,
];

export interface PedidoCierreAc {
  /** `reclamo.id_reclamo` en Atención Ciudadana. */
  idReclamo: number;
  /**
   * `usuario.id_usuario` de Atención Ciudadana — NO el id_persona de CIDITUC.
   * Quien cierra tiene que estar dado de alta en esa tabla con su repartición
   * y oficina; si no, el movimiento no tiene a quién atribuirse.
   */
  idUsuarioAc: number;
  /** Lo que va a leer el ciudadano. */
  detalle: string;
  idEstado?: number;
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
 * Arma el plan de cierre leyendo el último movimiento del reclamo. Solo SELECT:
 * se puede llamar siempre, incluso sin permisos de escritura, y es lo que hace
 * que el modo simulado muestre números reales y no inventados.
 */
export async function planificarCierreAc(
  pedido: PedidoCierreAc,
  conf: ConexionAc = conexionAcDesdeEntorno(),
): Promise<PlanCierreAc> {
  const { default: mysql } = await import("mysql2/promise");
  const cx = await mysql.createConnection({ ...conf, connectTimeout: 20_000 });
  try {
    const [filas] = await cx.query(
      `select id_movi, id_reclamo, id_derivacion, id_oficina, fecha_ingreso, fecha_egreso,
              id_estado, id_motivo, reparti_graba, usuario_ingreso, usuario_egreso
         from mov_reclamo where id_reclamo = ? order by id_movi desc limit 1`,
      [pedido.idReclamo],
    );
    const ultimo = (filas as unknown as MovimientoAc[])[0] ?? null;
    const impedimentos: string[] = [];

    if (!ultimo) {
      impedimentos.push(
        `El reclamo ${pedido.idReclamo} no tiene movimientos: o no existe o no llegó a derivarse.`,
      );
      return { idReclamo: pedido.idReclamo, ultimoMovimiento: null, sentencias: [], impedimentos };
    }
    if (ultimo.id_estado != null && ESTADOS_YA_CERRADO.includes(ultimo.id_estado)) {
      impedimentos.push(
        `El último movimiento (${ultimo.id_movi}) ya está en estado ${ultimo.id_estado}: el trámite está cerrado.`,
      );
    }
    if (!Number.isInteger(pedido.idUsuarioAc) || pedido.idUsuarioAc <= 0) {
      impedimentos.push("Falta el id_usuario de Atención Ciudadana de quien cierra.");
    }
    if (!pedido.detalle.trim()) {
      impedimentos.push("El detalle no puede ir vacío: es el texto que lee el ciudadano.");
    }

    const idEstado = pedido.idEstado ?? ESTADO_AC.finalizado;
    const idMotivo = pedido.idMotivo ?? MOTIVO_AC.comunicacionAlCiudadano;

    const sentencias: SentenciaPlan[] = [
      {
        /**
         * El `coalesce` de la fecha de ingreso es la traducción literal del
         * caso que describió la Dirección: el movimiento de la derivación
         * automática nunca fue tomado por nadie y llega acá con las dos fechas
         * y los dos usuarios en null. Si lo cerráramos dejando el ingreso
         * vacío, la historia diría que el trámite se egresó sin haber entrado.
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
         * La derivación, la oficina y la repartición se heredan del movimiento
         * que se cierra: el cierre pertenece al mismo tramo del trámite, no
         * abre uno nuevo. `foto` va en 0 — las fotos del trabajo viven en
         * CIMBA y se referencian desde el detalle.
         */
        descripcion: "Insertar el movimiento de cierre",
        sql: `insert into mov_reclamo
                (id_reclamo, id_derivacion, id_oficina, fecha_ingreso, fecha_egreso,
                 detalle_movi, id_estado, id_motivo, reparti_graba, foto,
                 usuario_ingreso, usuario_egreso)
              values (?, ?, ?, now(), now(), ?, ?, ?, ?, 0, ?, ?)`,
        parametros: [
          pedido.idReclamo,
          ultimo.id_derivacion,
          ultimo.id_oficina,
          pedido.detalle.trim(),
          idEstado,
          idMotivo,
          ultimo.reparti_graba,
          pedido.idUsuarioAc,
          pedido.idUsuarioAc,
        ],
      },
    ];

    return { idReclamo: pedido.idReclamo, ultimoMovimiento: ultimo, sentencias, impedimentos };
  } finally {
    await cx.end();
  }
}

export interface ResultadoCierreAc {
  modo: "simulado" | "real";
  plan: PlanCierreAc;
  /** En "real" y sin impedimentos: el id_movi del movimiento de cierre. */
  idMovimientoCierre: number | null;
  aplicado: boolean;
  error: string | null;
}

/**
 * Ejecuta el cierre si el modo es "real" y no hay impedimentos. Las dos
 * sentencias van en UNA transacción: dejar el movimiento anterior cerrado sin
 * el de cierre insertado sería peor que no haber hecho nada — el trámite
 * quedaría sin responsable y sin estado.
 */
export async function cerrarReclamoAc(
  pedido: PedidoCierreAc,
  conf: ConexionAc = conexionAcDesdeEntorno(),
): Promise<ResultadoCierreAc> {
  const plan = await planificarCierreAc(pedido, conf);
  const modo = modoCierreAc();

  if (modo === "simulado" || plan.impedimentos.length > 0) {
    return { modo, plan, idMovimientoCierre: null, aplicado: false, error: null };
  }

  const { default: mysql } = await import("mysql2/promise");
  const cx = await mysql.createConnection({ ...conf, connectTimeout: 20_000 });
  try {
    await cx.beginTransaction();
    for (const s of plan.sentencias.slice(0, 1)) await cx.execute(s.sql, s.parametros);
    const alta = plan.sentencias[1]!;
    const [res] = await cx.execute(alta.sql, alta.parametros);
    await cx.commit();
    return {
      modo,
      plan,
      idMovimientoCierre: (res as unknown as { insertId: number }).insertId ?? null,
      aplicado: true,
      error: null,
    };
  } catch (e) {
    await cx.rollback().catch(() => undefined);
    return {
      modo,
      plan,
      idMovimientoCierre: null,
      aplicado: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await cx.end();
  }
}

/**
 * TRAERSE LOS CIERRES QUE HIZO ATENCIÓN CIUDADANA.
 *
 * La integración nació mirando en una sola dirección: CIMBA cierra, AC se
 * entera. Pero el tránsito es de ida y vuelta — hay gente de Atención
 * Ciudadana cerrando reclamos por su propio sistema, y CIMBA no se entera de
 * nada. Medido el 08/10: de las 840 demandas de AC que CIMBA tenía abiertas,
 * 79 ya estaban finalizadas allá. Inflaban los pendientes y le ocupaban la
 * bandeja a quien tuviera que trabajarlas.
 *
 * Esto es SOLO LECTURA sobre AC y solo escribe del lado nuestro: cierra la
 * demanda en CIMBA dejando dicho que el cierre lo hizo Atención Ciudadana y en
 * qué movimiento. No toca el incidente — que el vecino deje de preguntar no
 * significa que el pozo esté tapado.
 *
 * Usa el mismo endpoint de lectura que ya consumíamos. Un detalle que ahorra
 * la mitad del trabajo: `traerReclamoPorID` no devuelve toda la cadena de
 * movimientos sino EL ÚLTIMO, que es justo el que manda.
 */

/** Los tres estados de `estado_reclamo` que dan el trámite por terminado. */
const ESTADOS_CERRADO = [4, 5, 6];

export interface EstadoAc {
  idReclamo: number;
  idEstado: number | null;
  nombreEstado: string | null;
  idMovimiento: number | null;
  cerrado: boolean;
}

function baseAc(): string {
  const base = process.env.CIMBA_API_ATENCION_CIUDADANA;
  if (!base) throw new Error("CIMBA_API_ATENCION_CIUDADANA no configurada");
  return base;
}

/**
 * El estado actual de un reclamo. Devuelve null si no existe — no es un error:
 * hay demandas viejas cuyo id de origen quedó apuntando a nada.
 */
export async function estadoActualAc(idReclamo: number): Promise<EstadoAc | null> {
  const { postJsonSmtDetallado } = await import("./https-smt");
  const r = await postJsonSmtDetallado(new URL("/reclamos/traerReclamoPorID", baseAc()), {
    idreclamo: idReclamo,
  });
  if (r.estado !== 200) return null;
  const filas = Array.isArray(r.cuerpo) ? r.cuerpo : [r.cuerpo];
  const ultimo = filas[0] as
    | { id_movi?: number; id_estado?: number; nombre_estado?: string }
    | null
    | undefined;
  if (!ultimo || ultimo.id_estado == null) return null;
  return {
    idReclamo,
    idEstado: ultimo.id_estado,
    nombreEstado: ultimo.nombre_estado ?? null,
    idMovimiento: ultimo.id_movi ?? null,
    cerrado: ESTADOS_CERRADO.includes(ultimo.id_estado),
  };
}

export interface ResumenSincroEstados {
  consultados: number;
  cerradosEnAc: number;
  /** Cerrados de nuestro lado en esta corrida. */
  cerrados: number;
  sinRespuesta: number;
  errores: Array<{ idReclamo: number; error: string }>;
  /** Los que efectivamente se preguntaron, para que el llamador los marque. */
  consultadosIds: number[];
  /** Quedó gente sin preguntar: se acabó el presupuesto de tiempo. */
  truncado: boolean;
}

/**
 * Consulta los reclamos de a uno y va cerrando los que allá ya terminaron.
 *
 * `alCerrar` recibe el id del reclamo y su estado, y hace la escritura en la
 * base de CIMBA. Vive afuera a propósito: este paquete no conoce el esquema de
 * la aplicación, y así la misma función sirve para el cron y para el CLI.
 *
 * El ritmo lo pone `pausaMs`. Son ~840 consultas contra un servidor que
 * atiende al 147: no hay apuro y no vale la pena hacerle ruido.
 */
export async function sincronizarEstadosAc(
  idsReclamo: number[],
  alCerrar: (estado: EstadoAc) => Promise<void>,
  opciones: { pausaMs?: number; limite?: number; limiteMs?: number } = {},
): Promise<ResumenSincroEstados> {
  const pausa = opciones.pausaMs ?? 120;
  const ids = opciones.limite ? idsReclamo.slice(0, opciones.limite) : idsReclamo;
  /**
   * Presupuesto de tiempo, para poder correr adentro de una función de Vercel.
   * Son ~840 consultas de ida y vuelta contra el servidor municipal: no entran
   * en los 60 segundos que dura una invocación. En vez de fijar un tamaño de
   * tanda a ojo —que envejece mal: si la red se pone lenta, el corte queda
   * corto; si mejora, se desperdicia— se corta por reloj. El llamador marca
   * los que alcanzó a preguntar y la próxima corrida sigue por los más viejos.
   */
  const vence = opciones.limiteMs ? Date.now() + opciones.limiteMs : Infinity;
  const r: ResumenSincroEstados = {
    consultados: 0,
    cerradosEnAc: 0,
    cerrados: 0,
    sinRespuesta: 0,
    errores: [],
    consultadosIds: [],
    truncado: false,
  };

  for (const id of ids) {
    if (Date.now() >= vence) {
      r.truncado = true;
      break;
    }
    try {
      const estado = await estadoActualAc(id);
      r.consultados++;
      r.consultadosIds.push(id);
      if (!estado) {
        r.sinRespuesta++;
      } else if (estado.cerrado) {
        r.cerradosEnAc++;
        await alCerrar(estado);
        r.cerrados++;
      }
    } catch (e) {
      r.errores.push({ idReclamo: id, error: e instanceof Error ? e.message : String(e) });
    }
    if (pausa > 0) await new Promise((res) => setTimeout(res, pausa));
  }
  return r;
}

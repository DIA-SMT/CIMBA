/**
 * CIERRE DE RECLAMO — endpoint propuesto para el backend de Atención Ciudadana
 * ---------------------------------------------------------------------------
 * Escrito por la Dirección de IA para la Dirección de Sistemas. Es el código
 * que CIMBA ya tiene andando contra la base, traducido a Express para que viva
 * del lado de ustedes. Probado contra smt_atencion_ciudadana con transacción y
 * rollback: el armado y las consultas son los mismos que acá están.
 *
 * Adaptar a sus convenciones (pool, middlewares, logging) con libertad; lo que
 * importa que no cambie es el ORDEN de las dos operaciones y los valores fijos
 * de Obras Viales.
 *
 *   POST /reclamos/cerrar
 *   {
 *     "id_reclamo": 120546,
 *     "id_usuario": 207,                  // usuario.id_usuario de AC
 *     "detalle": "Se realizó el bacheo…", // lo lee el ciudadano
 *     "id_estado": 4                      // opcional, por defecto 4
 *   }
 *
 *   200 → { "message": "Reclamo cerrado", "id_movi": 182571, "id_movi_cerrado": 182494 }
 *   400 → { "message": "<motivo>" }
 *   404 → { "message": "El reclamo no existe o no tiene movimientos" }
 *   409 → { "message": "El trámite ya está cerrado" }
 *
 * ── Por qué son dos operaciones y no una ───────────────────────────────────
 *
 * Nos lo explicó Faby: el reclamo tiene una cabecera y una cadena de
 * movimientos; al darlo de alta se inserta solo la derivación automática, que
 * queda ABIERTA —sin fechas ni usuarios— hasta que alguien la toma. Cerrar es
 * cerrar ese último movimiento Y DESPUÉS insertar el de finalización. Nunca un
 * solo registro, y siempre contra el id_movi más alto.
 *
 * ── Por qué el cierre no hereda la derivación del movimiento anterior ──────
 *
 * También de Faby: "el movimiento que insertan debe contener la derivación a
 * OBRAS VIALES". CIMBA identifica los baches por su cuenta, así que el
 * movimiento anterior puede ser de cualquier área — heredarlo haría que el
 * cierre figurara a nombre de quien tenía el reclamo antes. Verificado en el
 * reclamo 120546, cuyo movimiento previo tiene reparti_graba = 5000.
 */

const express = require("express");
const router = express.Router();

// Dirección de Obras Viales, que es la que ve Bacheo.
const OFICINA_OBRAS_VIALES = 21;
const REPARTICION_OBRAS_VIALES = 511;
// Secretaría de Obras Públicas: de ella depende Obras Viales, y su Secretario
// también cierra (Leonardo Míguez, usuario 207, está en esta repartición).
const REPARTICION_OBRAS_PUBLICAS = 510;
const REPARTICIONES_QUE_CIERRAN = [REPARTICION_OBRAS_VIALES, REPARTICION_OBRAS_PUBLICAS];

const MOTIVO_FINALIZACION = 4; // motivo.id_motivo = "Finalización del trámite"

/**
 * 4 = bacheo finalizado
 * 3 = no se finaliza, se deriva a otra área del municipio
 * 5 = se finaliza pero el reclamo no quedó resuelto
 * 6 = no le compete al municipio (SAT, EDET, Gasnor…)
 */
const ESTADOS_PERMITIDOS = [3, 4, 5, 6];
/** Si el último movimiento ya está en uno de estos, el trámite está cerrado. */
const ESTADOS_YA_CERRADO = [4, 5, 6];

router.post("/cerrar", async (req, res) => {
  const idReclamo = Number(req.body?.id_reclamo);
  const idUsuario = Number(req.body?.id_usuario);
  const detalle = String(req.body?.detalle ?? "").trim();
  const idEstado = req.body?.id_estado == null ? 4 : Number(req.body.id_estado);

  if (!Number.isInteger(idReclamo) || idReclamo <= 0) {
    return res.status(400).json({ message: "Falta el id_reclamo" });
  }
  if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
    return res.status(400).json({ message: "Falta el id_usuario" });
  }
  if (!detalle) {
    return res.status(400).json({ message: "Falta el detalle: es el texto que lee el ciudadano" });
  }
  if (!ESTADOS_PERMITIDOS.includes(idEstado)) {
    return res
      .status(400)
      .json({ message: `id_estado inválido: se espera uno de ${ESTADOS_PERMITIDOS.join(", ")}` });
  }

  const cx = await pool.getConnection();
  try {
    // ── 1. El último movimiento: el del id_movi más alto ───────────────────
    const [movs] = await cx.query(
      `select id_movi, id_estado, fecha_ingreso, usuario_ingreso
         from mov_reclamo
        where id_reclamo = ?
        order by id_movi desc
        limit 1`,
      [idReclamo],
    );
    if (movs.length === 0) {
      return res.status(404).json({ message: "El reclamo no existe o no tiene movimientos" });
    }
    const ultimo = movs[0];
    if (ESTADOS_YA_CERRADO.includes(ultimo.id_estado)) {
      return res.status(409).json({
        message: `El trámite ya está cerrado (movimiento ${ultimo.id_movi}, estado ${ultimo.id_estado})`,
      });
    }

    // ── 2. Quien cierra tiene que ser de Obras Viales o de su Secretaría ───
    const [usuarios] = await cx.query(
      `select id_usuario, nombre_usuario, id_reparticion, habilita
         from usuario where id_usuario = ?`,
      [idUsuario],
    );
    if (usuarios.length === 0) {
      return res.status(400).json({ message: `El usuario ${idUsuario} no existe` });
    }
    const usuario = usuarios[0];
    if (!REPARTICIONES_QUE_CIERRAN.includes(usuario.id_reparticion)) {
      return res.status(400).json({
        message: `El usuario ${idUsuario} (${usuario.nombre_usuario}) es de la repartición ${usuario.id_reparticion}; solo cierran ${REPARTICIONES_QUE_CIERRAN.join(" y ")}`,
      });
    }
    if (!usuario.habilita) {
      return res.status(400).json({ message: `El usuario ${idUsuario} está deshabilitado` });
    }

    /**
     * ── 3. La derivación a Obras Viales del tipo de ESTE reclamo ───────────
     *
     * derivacion_reclamo mapea (id_treclamo → id_oficina_deriva). Se prefiere
     * `primera = 0`: la de `primera = 1` es la del alta automática, y un cierre
     * es una derivación posterior, hecha durante el trámite. Para el tipo 105,
     * "Calle de pavimento en mal estado", esto da 277.
     *
     * Si no hay ninguna, el reclamo no es de los que le competen a Bacheo.
     */
    const [derivs] = await cx.query(
      `select d.id_derivacion
         from reclamo r
         join derivacion_reclamo d on d.id_treclamo = r.id_treclamo
        where r.id_reclamo = ? and d.id_oficina_deriva = ? and d.habilita = 1
        order by d.primera asc, d.id_derivacion desc
        limit 1`,
      [idReclamo, OFICINA_OBRAS_VIALES],
    );
    if (derivs.length === 0) {
      return res.status(400).json({
        message: "No hay derivación habilitada a Obras Viales para el tipo de este reclamo",
      });
    }
    const idDerivacion = derivs[0].id_derivacion;

    // ── 4. Las dos escrituras, juntas o ninguna ────────────────────────────
    await cx.beginTransaction();
    try {
      /**
       * El coalesce de fecha_ingreso es para el caso habitual: el movimiento de
       * la derivación automática nunca fue tomado por nadie y llega con las dos
       * fechas y los dos usuarios en null. Cerrarlo dejando el ingreso vacío
       * haría que la historia dijera que el trámite se egresó sin haber entrado.
       */
      await cx.execute(
        `update mov_reclamo
            set fecha_ingreso   = coalesce(fecha_ingreso, now()),
                fecha_egreso    = now(),
                usuario_ingreso = coalesce(usuario_ingreso, ?),
                usuario_egreso  = ?
          where id_movi = ? and id_reclamo = ?`,
        [idUsuario, idUsuario, ultimo.id_movi, idReclamo],
      );

      // foto = 0: las fotos del trabajo viven en CIMBA y se nombran en el texto.
      const [alta] = await cx.execute(
        `insert into mov_reclamo
           (id_reclamo, id_derivacion, id_oficina, fecha_ingreso, fecha_egreso,
            detalle_movi, id_estado, id_motivo, reparti_graba, foto,
            usuario_ingreso, usuario_egreso)
         values (?, ?, ?, now(), now(), ?, ?, ?, ?, 0, ?, ?)`,
        [
          idReclamo,
          idDerivacion,
          OFICINA_OBRAS_VIALES,
          detalle,
          idEstado,
          MOTIVO_FINALIZACION,
          REPARTICION_OBRAS_VIALES,
          idUsuario,
          idUsuario,
        ],
      );

      await cx.commit();
      return res.json({
        message: "Reclamo cerrado",
        id_movi: alta.insertId,
        id_movi_cerrado: ultimo.id_movi,
      });
    } catch (e) {
      /**
       * Si falla el insert después del update, el movimiento anterior quedaría
       * cerrado y el trámite sin responsable y sin estado: peor que no haber
       * hecho nada. Las tablas son InnoDB, así que el rollback es real.
       */
      await cx.rollback();
      throw e;
    }
  } catch (e) {
    console.error("[cerrar reclamo]", e);
    return res.status(500).json({ message: "No se pudo cerrar el reclamo" });
  } finally {
    cx.release();
  }
});

module.exports = router;

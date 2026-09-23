/**
 * CUÁNTO DURA UNA SESIÓN, y cuándo se renueva. Módulo plano: lo usan el
 * middleware (edge) y lib/auth.ts (node), y no puede arrastrar nada de ninguno.
 *
 * Hasta el 23/9 la sesión duraba 12 horas FIJAS desde el ingreso. Leo carga lo
 * atrasado de noche y vuelve a la mañana: la sesión de las 21:16 vencía a las
 * 9:16, en medio del trabajo, y la plataforma "lo expulsaba" al tocar Campo.
 * Si además tenía CIMBA abierto en dos lugares (la app instalada y una pestaña,
 * o el teléfono y la compu), entraba en uno y el otro lo volvía a sacar.
 *
 * Ahora la sesión se RENUEVA sola mientras se usa: cada pedido con una sesión
 * de más de una hora la re-emite por siete días más. Vence solo después de
 * siete días sin abrir CIMBA. Lo que protege del otro lado es que cada lectura
 * de la sesión confirma en la base que el perfil sigue activo: suspender a
 * alguien en Configuración lo saca en el próximo clic, no en siete días.
 */

export const COOKIE_SESION = "cimba_sesion";

/** Siete días sin usar la app y hay que volver a entrar. */
export const DURACION_SESION_S = 7 * 24 * 3600;

/** Una sesión emitida hace más de esto se re-emite en el próximo pedido. */
export const RENOVAR_DESPUES_DE_S = 3600;

import "server-only";
import { getDb, sql } from "@cimba/db";
import type { RolUsuario } from "@cimba/domain";

/**
 * Envío de notificaciones Web Push (VAPID). Las suscripciones viven en
 * push_suscripciones; las que el navegador dio de baja (410/404) se limpian
 * solas al fallar el envío.
 */

export interface CargaPush {
  titulo: string;
  cuerpo: string;
  url: string;
  tag?: string;
}

function configurado(): boolean {
  return Boolean(process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

interface FilaSuscripcion {
  id: number;
  endpoint: string;
  claves: { p256dh: string; auth: string };
}

async function enviarA(filas: FilaSuscripcion[], carga: CargaPush): Promise<{ enviadas: number; caducadas: number }> {
  if (!configurado() || filas.length === 0) return { enviadas: 0, caducadas: 0 };
  const { default: webpush } = await import("web-push");
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:direccionia@smt.gob.ar",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    process.env.VAPID_PRIVATE_KEY ?? "",
  );

  const db = getDb();
  let enviadas = 0;
  let caducadas = 0;
  await Promise.all(
    filas.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.claves },
          JSON.stringify(carga),
          { TTL: 3600 },
        );
        enviadas++;
      } catch (e) {
        const codigo = (e as { statusCode?: number }).statusCode;
        if (codigo === 404 || codigo === 410) {
          caducadas++;
          await db.execute(sql`delete from push_suscripciones where id = ${s.id}`).catch(() => {});
        }
      }
    }),
  );
  return { enviadas, caducadas };
}

/** Notifica a todas las suscripciones de un perfil. */
export async function notificarPerfil(perfilId: string, carga: CargaPush) {
  const db = getDb();
  const filas = (await db.execute(sql`
    select id, endpoint, claves from push_suscripciones where perfil_id = ${perfilId}
  `)) as unknown as FilaSuscripcion[];
  return enviarA(filas, carga);
}

/** Notifica a todos los suscriptos cuyo perfil tenga alguno de los roles dados. */
export async function notificarRoles(roles: RolUsuario[], carga: CargaPush) {
  const db = getDb();
  const filas = (await db.execute(sql`
    select ps.id, ps.endpoint, ps.claves
    from push_suscripciones ps
    join perfiles p on p.id = ps.perfil_id
    where p.rol in ${sql.raw(`('${roles.join("','")}')`)} and p.activo
  `)) as unknown as FilaSuscripcion[];
  return enviarA(filas, carga);
}

/**
 * NOTIFICAR A UNA EMPRESA CONTRATISTA, a todos sus teléfonos.
 *
 * Hasta acá los avisos iban por ROL, y el rol "empresa" son trece
 * contratistas: mandarle "te emitieron la OT-0026" al rol entero era avisarle
 * a doce empresas de una orden ajena, así que nunca se hizo — y las empresas
 * no recibían nada. Cero suscripciones de empresas en toda la base.
 *
 * Cada usuario de contratista lleva `empresa_id` en su perfil (los @cimba.com
 * creados para cada una); acá se busca por eso y no por rol. Si la empresa
 * tiene dos o tres personas con la app en el teléfono, les llega a todas.
 */
export async function notificarEmpresa(empresaId: number, carga: CargaPush) {
  const db = getDb();
  const filas = (await db.execute(sql`
    select ps.id, ps.endpoint, ps.claves
    from push_suscripciones ps
    join perfiles p on p.id = ps.perfil_id
    where p.empresa_id = ${empresaId} and p.activo
  `)) as unknown as FilaSuscripcion[];
  return enviarA(filas, carga);
}

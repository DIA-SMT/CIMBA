import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

const PUBLICAS = ["/acceso", "/api/auth", "/dev/sso", "/marca", "/_next", "/favicon", "/sw.js"];

/**
 * Lo ÚNICO que puede tocar el rol empresa (usuario EXTERNO: contratistas).
 * Allowlist y no denylist a propósito: los endpoints históricos (/api/exportar,
 * /api/geodata, /api/migue…) se gatean con "hay sesión" porque nacieron cuando
 * toda sesión era personal municipal — con perseguirlos uno por uno, el
 * próximo endpoint nuevo repite el agujero. Como la RLS no se aplica (la app
 * corre como dueño de las tablas), este corte central es el perímetro real.
 */
const PREFIJOS_EMPRESA = [
  "/empresa",
  // Su propia clave. Sin esto, una contratista con clave temporal entraba en
  // un bucle: el middleware la mandaba a /clave por el flag ct y esta misma
  // allowlist la rebotaba de /clave a /empresa, para siempre.
  "/clave",
  // Bajar SU trabajo. La ruta ya resuelve la empresa desde la sesión, nunca
  // desde la URL: lo que exporta es lo suyo o nada.
  "/api/empresa",
  "/api/geocodificar",
  "/data",
  "/iconos",
  "/manifest",
];

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Entrada desde Ciudad Digital: ?auth=<token> en cualquier ruta → callback
  if (searchParams.has("auth")) {
    const url = req.nextUrl.clone();
    url.pathname = "/api/auth/callback";
    return NextResponse.redirect(url);
  }

  if (PUBLICAS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Cron: se autentica con CRON_SECRET, no con sesión
  if (pathname.startsWith("/api/sync") || pathname.startsWith("/api/cron")) return NextResponse.next();

  const token = req.cookies.get("cimba_sesion")?.value;
  if (token) {
    try {
      const secreto = new TextEncoder().encode(process.env.CIMBA_JWT_SECRET ?? "");
      const { payload } = await jwtVerify(token, secreto, { issuer: "cimba" });

      /**
       * Clave temporal sin cambiar: SOLO /clave (la página y sus server
       * actions postean ahí mismo) y /api/auth, para poder salir. Al cambiarla
       * la cookie se re-emite sin el flag y esto deja de aplicar.
       *
       * El /api entero estaba exceptuado y era un agujero: con la clave
       * inicial —la que se reparte por WhatsApp y puede estar en cualquier
       * lado— se llegaba igual a los endpoints. El cambio obligatorio no es
       * obligatorio si hay una puerta al costado.
       */
      if (
        payload.ct === true &&
        !pathname.startsWith("/clave") &&
        !pathname.startsWith("/api/auth")
      ) {
        if (pathname.startsWith("/api")) {
          return NextResponse.json({ error: "cambiá tu clave antes de seguir" }, { status: 403 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/clave";
        url.search = "";
        return NextResponse.redirect(url);
      }

      if (payload.rol_cimba === "empresa" && !PREFIJOS_EMPRESA.some((p) => pathname.startsWith(p))) {
        if (pathname.startsWith("/api")) {
          return NextResponse.json({ error: "sin permiso" }, { status: 403 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/empresa";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return NextResponse.next();
    } catch {
      /* sesión inválida → acceso */
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = "/acceso";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

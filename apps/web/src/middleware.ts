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
const PREFIJOS_EMPRESA = ["/empresa", "/api/geocodificar", "/data", "/iconos", "/manifest"];

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
  if (pathname.startsWith("/api/sync")) return NextResponse.next();

  const token = req.cookies.get("cimba_sesion")?.value;
  if (token) {
    try {
      const secreto = new TextEncoder().encode(process.env.CIMBA_JWT_SECRET ?? "");
      const { payload } = await jwtVerify(token, secreto, { issuer: "cimba" });

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

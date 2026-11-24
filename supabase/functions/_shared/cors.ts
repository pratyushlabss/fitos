// fitos.pages.dev belongs to another Cloudflare account; this project is fitos-3ka.pages.dev.
const ALLOWED_ORIGINS = ["https://fitos-3ka.pages.dev", "http://localhost:3000", "http://127.0.0.1:3000"];

// Local and LAN development on any port (a phone on the same Wi-Fi uses the Mac's 192.168.x.x address).
// Every function still requires a valid user JWT, so this only decides which pages may read responses.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

function allowedOrigin(origin: string | null): string {
  if (!origin) return ALLOWED_ORIGINS[0];
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (LOCAL_ORIGIN.test(origin)) return origin;
  // Cloudflare preview and branch deployments: https://<hash or branch>.fitos-3ka.pages.dev
  if (/^https:\/\/[a-z0-9-]+\.fitos-3ka\.pages\.dev$/.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("Origin")),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders(req) }) : null;
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function fail(req: Request, status: number, error: string, message: string): Response {
  return json(req, { error, message }, status);
}

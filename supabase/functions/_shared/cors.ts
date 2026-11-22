const ALLOWED_ORIGINS = ["https://fitos.pages.dev", "http://localhost:3000", "http://127.0.0.1:3000"];

function allowedOrigin(origin: string | null): string {
  if (!origin) return ALLOWED_ORIGINS[0];
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Cloudflare preview deployments: https://<hash>.fitos.pages.dev
  if (/^https:\/\/[a-z0-9-]+\.fitos\.pages\.dev$/.test(origin)) return origin;
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

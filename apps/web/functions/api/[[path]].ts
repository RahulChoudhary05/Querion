/**
 * Cloudflare Pages Function: same-origin proxy  https://<your-site>/api/*  →  Render API.
 *
 * Why: the session cookie must be FIRST-party (Safari/Chrome block third-party
 * cookies), and SameSite=Lax + __Host- prefix only work when the API shares the
 * site's origin. This function forwards requests and passes Set-Cookie back.
 *
 * Pages → Settings → Environment variables:
 *   API_ORIGIN    = https://<your-service>.onrender.com
 *   PROXY_SECRET  = same random value as PROXY_SECRET on Render
 */
interface Env {
  API_ORIGIN: string;
  PROXY_SECRET?: string;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!env.API_ORIGIN) return new Response('API_ORIGIN is not configured', { status: 500 });
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);

  const headers = new Headers(request.headers);
  headers.delete('host');
  // the real visitor IP, vouched for with a shared secret so it can't be spoofed by calling Render directly
  headers.set('x-querion-client-ip', request.headers.get('cf-connecting-ip') ?? '');
  if (env.PROXY_SECRET) headers.set('x-proxy-secret', env.PROXY_SECRET);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', 'https');

  const res = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
  // pass everything through, including Set-Cookie (now first-party on the Pages domain)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
};

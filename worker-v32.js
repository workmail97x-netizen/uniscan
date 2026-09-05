import baseWorker, { UniScanSession } from "./worker.js";
export { UniScanSession };

const ROOM_RE = /^[A-Z2-9]{8}$/;
const ICON_192_URL = "https://raw.githubusercontent.com/workmail97x-netizen/uniscan/main/icon-192.png";
const ICON_512_URL = "https://raw.githubusercontent.com/workmail97x-netizen/uniscan/main/icon-512.png";

function manifest(url) {
  const pair = (url.searchParams.get("pair") || "").toUpperCase();
  const start = ROOM_RE.test(pair) ? `/?pair=${encodeURIComponent(pair)}&installed=1` : "/";
  return JSON.stringify({
    name: "UniScan",
    short_name: "UniScan",
    description: "قارئ باركود لاسلكي للحاسبة",
    id: "/",
    start_url: start,
    scope: "/",
    display: "standalone",
    background_color: "#eef4f0",
    theme_color: "#0a7a35",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
    ]
  });
}

function brandedHTML(html) {
  html = html.replace(
    '<link rel="icon" href="/icon.svg">',
    '<link rel="apple-touch-icon" href="/icon-192.png"><link rel="icon" type="image/png" href="/icon-192.png">'
  );
  html = html.replace(
    '.brand{display:flex;align-items:center;gap:10px}.logo{width:50px;height:50px;border-radius:14px;background:var(--g);color:#fff;display:grid;place-items:center;font-size:28px;font-weight:900}.brand h1{margin:0;font-size:24px}.brand small{color:var(--m)}',
    '.brand{display:flex;align-items:center;gap:10px;min-width:0}.logo{width:58px;height:58px;border-radius:14px;background:#fff;object-fit:contain;border:1px solid var(--l);padding:2px;flex:0 0 auto}.brandcopy{min-width:0}.brand h1{margin:0;font-size:24px}.brand small{color:var(--m)}.credit{margin-top:4px;font-size:10.5px;line-height:1.55;color:#56645b}.credit a{display:block;color:var(--g);text-decoration:none;font-weight:750;white-space:nowrap}'
  );
  html = html.replace(
    '@media(max-width:520px){.pairrow{flex-direction:column}',
    '@media(max-width:520px){.top{align-items:flex-start}.logo{width:54px;height:54px}.brand h1{font-size:22px}.credit{font-size:9.8px}.pill{padding:7px 8px}.pairrow{flex-direction:column}'
  );
  html = html.replace(
    '<div class="brand"><div class="logo">U</div><div><h1>UniScan</h1><small>Mobile Barcode Reader</small></div></div><span id="conn" class="pill">غير مرتبط</span>',
    '<div class="brand"><img class="logo" src="/icon-192.png" alt="شعار وزارة الصحة العراقية"><div class="brandcopy"><h1>UniScan</h1><small>Mobile Barcode Reader</small><div class="credit"><div>تطوير مصطفى محمد / دائرة صحة الانبار</div><a href="https://wa.me/9647801252217" target="_blank" rel="noopener">🟢 واتساب: 07801252217</a></div></div></div><span id="conn" class="pill">غير مرتبط</span>'
  );
  return html;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/icon-192.png") return fetch(ICON_192_URL, { cf: { cacheTtl: 86400 } });
    if (url.pathname === "/icon-512.png") return fetch(ICON_512_URL, { cf: { cacheTtl: 86400 } });
    if (url.pathname === "/icon.svg") return Response.redirect(new URL("/icon-192.png", url).toString(), 302);
    if (url.pathname === "/manifest.webmanifest") {
      return new Response(manifest(url), {
        headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-store" }
      });
    }
    if (url.pathname === "/" && request.method === "GET") {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const html = brandedHTML(await response.text());
      const headers = new Headers(response.headers);
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("cache-control", "no-store");
      return new Response(html, { status: response.status, headers });
    }
    return baseWorker.fetch(request, env, ctx);
  }
};

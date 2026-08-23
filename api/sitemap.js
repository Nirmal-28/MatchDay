// Vercel serverless function — /sitemap.xml
//
// Lists the pages worth indexing: the discovery page, the leaderboard, and
// every published tournament. Generated on request rather than at build time
// because tournaments are created continuously and a build-time file would be
// stale the moment an organizer publishes anything.
//
// Reads with the PUBLISHABLE key and only sees what an anonymous visitor sees
// (RLS excludes drafts). No service_role key is involved.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const escapeXml = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export default async function handler(req, res) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const origin = `https://${host}`;

  const urls = [
    { loc: `${origin}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${origin}/leaderboard`, changefreq: "daily", priority: "0.6" },
    // The organizer landing page — the main non-tournament page worth indexing.
    { loc: `${origin}/host`, changefreq: "weekly", priority: "0.9" },
  ];

  try {
    if (SUPABASE_URL && SUPABASE_KEY) {
      const query =
        `${SUPABASE_URL}/rest/v1/tournaments` +
        `?status=neq.DRAFT&select=slug,updated_at,start_date&order=start_date.desc&limit=1000`;
      const r = await fetch(query, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (r.ok) {
        const rows = await r.json();
        for (const t of rows) {
          if (!t.slug) continue;
          urls.push({
            loc: `${origin}/t/${encodeURIComponent(t.slug)}`,
            lastmod: (t.updated_at || t.start_date || "").slice(0, 10) || undefined,
            changefreq: "daily",
            priority: "0.8",
          });
        }
      }
    }
  } catch {
    // A sitemap that lists only the static pages is still a valid sitemap.
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) =>
      `  <url><loc>${escapeXml(u.loc)}</loc>` +
      (u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : "") +
      `<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    ).join("\n") +
    `\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).send(body);
}

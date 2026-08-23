// Vercel serverless function — social link previews for shared tournaments.
//
// Why this exists: MatchDay is a single-page app, so the <meta> tags a
// crawler sees are whatever is in index.html. Facebook, WhatsApp, Slack,
// Twitter/X, LinkedIn and Discord do NOT run JavaScript, so setting og:title
// from React would change nothing for them — a shared tournament link would
// always show the generic site card. This function renders the real tags
// server-side for crawlers only; humans are served the normal app.
//
// vercel.json routes bot user-agents on /t/:slug here. Everyone else is
// untouched, so there is no cost or latency for real visitors.
//
// SECURITY: this reads with the PUBLISHABLE key and filters to published
// tournaments only, exactly as an anonymous browser would. RLS is still the
// thing enforcing that. No service_role key is used or needed here.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Anything interpolated into HTML must be escaped. Tournament names are
// organizer-supplied text and must never be able to close a tag.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDates(start, end) {
  if (!start) return null;
  const opts = { day: "numeric", month: "short", year: "numeric" };
  const s = new Date(start).toLocaleDateString("en-IN", opts);
  if (!end || end === start) return s;
  return `${s} – ${new Date(end).toLocaleDateString("en-IN", opts)}`;
}

function describe(t) {
  const bits = [];
  const dates = formatDates(t.start_date, t.end_date);
  if (dates) bits.push(dates);
  if (t.venue) bits.push(t.venue);
  if (t.city) bits.push(t.city);
  const head = bits.join(" · ");

  const status = {
    REGISTRATION_OPEN: "Registration is open.",
    REGISTRATION_CLOSED: "Registration has closed.",
    LIVE: "Live now — follow scores as they happen.",
    COMPLETED: "Results are final.",
  }[t.status];

  return [head, status].filter(Boolean).join(" ") || "A tournament on Matchday.";
}

function page({ title, description, image, url }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const i = escapeHtml(image);
  const u = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Matchday" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:image" content="${i}" />
<meta property="og:url" content="${u}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${i}" />
<link rel="canonical" href="${u}" />
</head>
<body>
<h1>${t}</h1>
<p>${d}</p>
<p><a href="${u}">View this tournament on Matchday</a></p>
</body>
</html>`;
}

export default async function handler(req, res) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const origin = `https://${host}`;

  // The slug comes from the path the rewrite matched: /t/<slug>.
  const path = (req.url || "").split("?")[0];
  const slug = decodeURIComponent(path.replace(/^\/t\//, "").replace(/\/.*$/, ""));

  const fallback = {
    title: "Matchday — run and play racket tournaments",
    description: "Create a tournament, seed the draw, schedule courts and score matches live.",
    image: `${origin}/logo.png`,
    url: `${origin}${path}`,
  };

  if (!slug || !SUPABASE_URL || !SUPABASE_KEY) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(page(fallback));
  }

  try {
    // Published tournaments only — the same view an anonymous visitor gets.
    const query =
      `${SUPABASE_URL}/rest/v1/tournaments` +
      `?slug=eq.${encodeURIComponent(slug)}` +
      `&status=neq.DRAFT` +
      `&select=name,venue,city,start_date,end_date,status,cover_image_url,logo_url` +
      `&limit=1`;

    const r = await fetch(query, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = r.ok ? await r.json() : [];
    const t = Array.isArray(rows) ? rows[0] : null;

    if (!t) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(page(fallback));
    }

    // Cache at the edge: a tournament's name and dates change rarely, and a
    // crawler re-fetching on every share should not hit the database.
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(page({
      title: `${t.name} — Matchday`,
      description: describe(t),
      image: t.cover_image_url || t.logo_url || `${origin}/logo.png`,
      url: `${origin}/t/${encodeURIComponent(slug)}`,
    }));
  } catch {
    // A preview failing must never make the link itself look broken.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(page(fallback));
  }
}

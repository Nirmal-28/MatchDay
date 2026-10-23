// Renders a Match Story card to a PNG Blob, entirely in the browser.
//
// 1080x1350 (4:5) is the size WhatsApp Status, Instagram feed and most chat
// previews show without cropping. Drawn with Canvas 2D rather than captured
// from the DOM: no html2canvas dependency, no CORS-tainted organizer images,
// identical output on every phone. Every value on the card is passed in by
// the caller, who reads it from the match — this file draws, it does not
// decide anything.

const C = {
  bg0: "#060911", bg1: "#0d1523", line: "#223251", ink: "#eef3fa", ink2: "#a4b3cd", ink3: "#67799a",
  A: "#16c5b0", B: "#f97316", gold: "#eab308",
};
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const BODY = 'Inter, system-ui, sans-serif';

async function ensureFonts() {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await Promise.all([
      document.fonts.load(`700 120px ${DISPLAY}`),
      document.fonts.load(`600 32px ${BODY}`),
    ]);
  } catch { /* fall back to system fonts; the card still renders */ }
}

function fit(ctx, text, maxWidth, startPx, font) {
  let px = startPx;
  ctx.font = font(px);
  while (px > 24 && ctx.measureText(text).width > maxWidth) { px -= 4; ctx.font = font(px); }
  return px;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param d {
 *   tournament, stage, division,
 *   sides: [{ name, won, delta, rating }, { ... }],   // A then B
 *   games: [{a, b}],
 *   series: [{ pA }] | [],
 *   moments: [{ title, side }],
 *   url
 * }
 */
export async function renderStoryCard(d) {
  await ensureFonts();
  const W = 1080, H = 1350, M = 72;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Ground
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0f2a27"); g.addColorStop(0.35, C.bg1); g.addColorStop(1, C.bg0);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Court lines, faint.
  ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 3;
  ctx.strokeRect(M / 2, M / 2, W - M, H - M);
  ctx.beginPath(); ctx.moveTo(W / 2, M / 2); ctx.lineTo(W / 2, H - M / 2); ctx.stroke();

  // Header
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink; ctx.font = `italic 700 54px ${DISPLAY}`;
  ctx.fillText("MATCH", M, M + 46);
  const mw = ctx.measureText("MATCH").width;
  ctx.fillStyle = C.A; ctx.fillText("DAY", M + mw, M + 46);
  ctx.fillStyle = C.ink3; ctx.font = `700 24px ${BODY}`;
  ctx.textAlign = "right"; ctx.fillText("MATCH STORY", W - M, M + 40); ctx.textAlign = "left";

  let y = M + 130;
  ctx.fillStyle = C.ink2; ctx.font = `600 30px ${BODY}`;
  ctx.fillText([d.stage, d.division].filter(Boolean).join("  ·  ").toUpperCase(), M, y);
  y += 54;
  const tSize = fit(ctx, d.tournament || "", W - 2 * M, 64, (px) => `700 ${px}px ${DISPLAY}`);
  ctx.fillStyle = C.ink; ctx.font = `700 ${tSize}px ${DISPLAY}`;
  ctx.fillText((d.tournament || "").toUpperCase(), M, y);

  // Score block
  y += 60;
  const rowH = 150;
  d.sides.forEach((s, i) => {
    const top = y + i * (rowH + 18);
    const color = i === 0 ? C.A : C.B;
    roundRect(ctx, M, top, W - 2 * M, rowH, 26);
    ctx.fillStyle = s.won ? "rgba(22,197,176,0.10)" : "rgba(255,255,255,0.035)";
    if (s.won && i === 1) ctx.fillStyle = "rgba(249,115,22,0.10)";
    ctx.fill();
    ctx.strokeStyle = s.won ? color : C.line; ctx.lineWidth = s.won ? 4 : 2; ctx.stroke();
    ctx.fillStyle = color; ctx.fillRect(M, top + 24, 8, rowH - 48);

    // Game scores, right-aligned columns.
    const colW = 96;
    const gx = W - M - 40 - d.games.length * colW;
    d.games.forEach((gm, gi) => {
      const mine = i === 0 ? gm.a : gm.b, theirs = i === 0 ? gm.b : gm.a;
      ctx.font = `700 76px ${DISPLAY}`;
      ctx.fillStyle = mine > theirs ? C.ink : C.ink3;
      ctx.textAlign = "center";
      ctx.fillText(String(mine), gx + gi * colW + colW / 2, top + 100);
      ctx.textAlign = "left";
    });

    const nameMax = gx - M - 60;
    const nSize = fit(ctx, s.name, nameMax, 60, (px) => `700 ${px}px ${DISPLAY}`);
    ctx.fillStyle = C.ink; ctx.font = `700 ${nSize}px ${DISPLAY}`;
    ctx.fillText(s.name.toUpperCase(), M + 40, top + 74);
    ctx.font = `600 24px ${BODY}`;
    let tx = M + 40;
    if (s.won) {
      ctx.fillStyle = color; ctx.fillText("WINNER", tx, top + 114);
      tx += ctx.measureText("WINNER").width + 22;
    }
    if (s.rating) {
      ctx.fillStyle = C.ink3;
      const r = `MDR ${s.rating}`;
      ctx.fillText(r, tx, top + 114);
      tx += ctx.measureText(r).width + 12;
    }
    if (s.delta) {
      ctx.fillStyle = s.delta > 0 ? C.A : C.B;
      ctx.fillText(s.delta > 0 ? `+${s.delta}` : String(s.delta), tx, top + 114);
    }
  });
  y += 2 * rowH + 18 + 56;

  // Momentum
  if (d.series && d.series.length > 2) {
    const ch = 250, cw = W - 2 * M;
    ctx.fillStyle = C.ink3; ctx.font = `700 22px ${BODY}`;
    ctx.fillText("MOMENTUM · WIN PROBABILITY BY RALLY", M, y);
    y += 22;
    const n = d.series.length - 1;
    const px = (i) => M + (i / n) * cw;
    const py = (p) => y + 10 + (1 - p) * (ch - 20);
    const mid = y + ch / 2;
    const trace = () => { ctx.beginPath(); d.series.forEach((s, i) => (i ? ctx.lineTo(px(i), py(s.pA)) : ctx.moveTo(px(i), py(s.pA)))); };
    for (const [clipTop, color] of [[true, C.A], [false, C.B]]) {
      ctx.save();
      ctx.beginPath(); ctx.rect(M, clipTop ? y : mid, cw, ch / 2); ctx.clip();
      trace(); ctx.lineTo(px(n), mid); ctx.lineTo(px(0), mid); ctx.closePath();
      ctx.globalAlpha = 0.28; ctx.fillStyle = color; ctx.fill();
      ctx.restore();
    }
    ctx.setLineDash([10, 10]); ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M, mid); ctx.lineTo(M + cw, mid); ctx.stroke(); ctx.setLineDash([]);
    trace(); ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.stroke();
    y += ch + 40;
  }

  // Moments
  ctx.font = `600 30px ${BODY}`;
  (d.moments || []).slice(0, 3).forEach((m) => {
    const color = m.side === "A" ? C.A : m.side === "B" ? C.B : C.gold;
    if (y > H - 190) return;
    const text = m.title;
    const tw = Math.min(ctx.measureText(text).width, W - 2 * M - 70);
    roundRect(ctx, M, y, tw + 70, 64, 32);
    ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(M + 32, y + 32, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.ink; ctx.fillText(text, M + 52, y + 43, W - 2 * M - 70);
    y += 82;
  });

  // Footer
  ctx.fillStyle = C.A; ctx.fillRect(0, H - 18, W, 18);
  ctx.fillStyle = C.ink3; ctx.font = `600 24px ${BODY}`;
  ctx.fillText("Scored live, rally by rally, on MatchDay", M, H - 62);
  if (d.url) {
    ctx.textAlign = "right"; ctx.fillStyle = C.ink2;
    ctx.fillText(d.url.replace(/^https?:\/\//, ""), W - M, H - 62, 440);
    ctx.textAlign = "left";
  }

  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

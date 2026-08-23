import { useEffect } from "react";

// Per-page document title and description.
//
// This is for the browser tab, bookmarks, and search engines that do execute
// JavaScript (Google does). It is NOT what fixes social link previews —
// Facebook, WhatsApp and the rest never run this code. That is handled
// server-side in api/preview.js; see the comment there.
//
// Passing a falsy title restores the site default, so a page that is still
// loading does not flash a wrong name into the tab.

const DEFAULT_TITLE = "Matchday — run and play racket tournaments";
const DEFAULT_DESCRIPTION =
  "Create a tournament, seed the draw, schedule courts and score matches live. Players find events, register and follow their results.";

function setMeta(selector, attr, value) {
  if (typeof document === "undefined") return;
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

export function useDocumentMeta({ title, description } = {}) {
  useEffect(() => {
    const fullTitle = title ? `${title} — Matchday` : DEFAULT_TITLE;
    const desc = description || DEFAULT_DESCRIPTION;

    document.title = fullTitle;
    setMeta('meta[name="description"]', "content", desc);
    setMeta('meta[property="og:title"]', "content", fullTitle);
    setMeta('meta[property="og:description"]', "content", desc);
    setMeta('meta[name="twitter:title"]', "content", fullTitle);
    setMeta('meta[name="twitter:description"]', "content", desc);

    return () => {
      document.title = DEFAULT_TITLE;
      setMeta('meta[name="description"]', "content", DEFAULT_DESCRIPTION);
      setMeta('meta[property="og:title"]', "content", DEFAULT_TITLE);
      setMeta('meta[property="og:description"]', "content", DEFAULT_DESCRIPTION);
      setMeta('meta[name="twitter:title"]', "content", DEFAULT_TITLE);
      setMeta('meta[name="twitter:description"]', "content", DEFAULT_DESCRIPTION);
    };
  }, [title, description]);
}

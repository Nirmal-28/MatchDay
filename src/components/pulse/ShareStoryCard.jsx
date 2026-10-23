import { useEffect, useState } from "react";
import { Share2, Download, Image as ImageIcon } from "lucide-react";
import { Btn, Modal } from "../ui/primitives";
import { renderStoryCard } from "./storyCard";

/* The share loop. A finished match becomes an image a player actually wants
   to post — their name, the score, the momentum line, the moment they turned
   it around. On a phone it goes straight to the native share sheet
   (WhatsApp, Instagram, Status); elsewhere it downloads, with a WhatsApp text
   link as the fallback. Each card carries the match URL, so every share is a
   way in for someone who has never heard of MatchDay. */
export default function ShareStoryCard({ card, fileName = "matchday-story.png", label = "Share match story", className }) {
  const [open, setOpen] = useState(false);
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const build = async () => {
    setBusy(true);
    try {
      const b = await renderStoryCard(card);
      setBlob(b);
      setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
      setOpen(true);
    } finally { setBusy(false); }
  };

  const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;
  const canShareFile = !!(file && navigator.canShare?.({ files: [file] }));
  const text = `${card.sides.map((s) => s.name).join(" vs ")} — ${card.games.map((g) => `${g.a}-${g.b}`).join(", ")}. ${card.url || ""}`.trim();

  const share = async () => {
    if (canShareFile) {
      try { await navigator.share({ files: [file], text }); return; } catch { /* cancelled */ return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <>
      <Btn size="md" variant="secondary" icon={ImageIcon} onClick={build} disabled={busy} className={className}>
        {busy ? "Drawing…" : label}
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Match Story" width="max-w-md">
        {url && <img src={url} alt="Match story card" className="w-full rounded-xl border border-line" />}
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn size="md" icon={Share2} onClick={share} className="flex-1">
            {canShareFile ? "Share" : "Share on WhatsApp"}
          </Btn>
          {url && (
            <a href={url} download={fileName} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-ink hover:border-accent-teal">
              <Download size={15} /> Save image
            </a>
          )}
        </div>
      </Modal>
    </>
  );
}

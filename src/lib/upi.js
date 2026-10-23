// UPI Direct — players pay the organizer straight from any UPI app.
//
// Why: UPI is 84% of India's digital payments, and a UPI transfer to a small
// merchant or a person carries no fee. A payment gateway costs ~2% + GST and
// a KYC onboarding most club organizers never finish — which is why every
// club tournament in India already runs on "send it to my GPay and post the
// screenshot in the group". This keeps that habit and removes its two
// failures: the organizer cannot tell which transfer is whose, and a
// screenshot proves nothing (fake "Payment Successful" screens are a
// well-known scam).
//
// So every entry gets a short reference that goes in the UPI note, the player
// gives the 12-digit UTR their app shows, and the ORGANIZER confirms after
// seeing the money in their own bank app. MatchDay never marks an entry paid
// on the player's word.
//
// Pure functions only.

// A UPI ID (VPA) is `handle@provider`: e.g. club.name@okhdfcbank, 98xxxxxx@ybl.
// Identical to the CHECK in migration 016 ({2,255}: Postgres caps a regex
// repetition at 255, so {2,256} is not even a valid pattern there).
const VPA = /^[a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
export const isValidUpiId = (s) => VPA.test(String(s || "").trim());

// The UTR (UPI transaction reference / RRN) every UPI app shows on a
// completed payment is 12 digits.
export const normaliseUtr = (s) => String(s || "").replace(/\D/g, "");
export const isValidUtr = (s) => /^\d{12}$/.test(normaliseUtr(s));

// A short, stable reference per entry, for the UPI note. Derived from the
// entry id, so it needs no storage and the organizer can match a transfer
// to an entry by searching their UPI app's history for it.
export function upiReference(entryId) {
  return `MD${String(entryId || "").replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/**
 * NPCI deep link. On an Android phone this opens the installed UPI app with
 * payee, amount and note filled in; elsewhere it is rendered as a QR code to
 * scan with any UPI app. `am` is fixed, so the amount is not editable.
 */
export function upiPayUrl({ upiId, payeeName, amount, note }) {
  const params = new URLSearchParams({
    pa: String(upiId || "").trim(),
    pn: (payeeName || "Tournament organizer").slice(0, 50),
    am: Number(amount || 0).toFixed(2),
    cu: "INR",
    tn: String(note || "").slice(0, 60),
  });
  return `upi://pay?${params.toString()}`;
}

/**
 * Organizer review aid: claims whose UTR was also submitted for a different
 * entry. One real transfer cannot pay for two entries, so a repeated UTR is
 * either a mistake or someone reusing another player's reference.
 * Returns { [claimId]: [otherEntryId, ...] }.
 */
export function duplicateUtrs(claims) {
  const byUtr = {};
  for (const c of claims || []) (byUtr[c.utr] = byUtr[c.utr] || []).push(c);
  const out = {};
  for (const list of Object.values(byUtr)) {
    const entries = new Set(list.map((c) => c.entry_id));
    if (entries.size < 2) continue;
    for (const c of list) out[c.id] = [...entries].filter((e) => e !== c.entry_id);
  }
  return out;
}

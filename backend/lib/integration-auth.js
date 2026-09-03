import crypto from "node:crypto";

/**
 * True iff the request carries a valid X-Bot-Secret header matching
 * process.env.BOT_REDEEM_SECRET. Timing-safe; false if either side is absent
 * or lengths differ.
 */
export function verifyBotSecret(req) {
  const provided = req.header("X-Bot-Secret") || "";
  const expected = process.env.BOT_REDEEM_SECRET || "";
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

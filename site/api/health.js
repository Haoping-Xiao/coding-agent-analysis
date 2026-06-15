import { db, ensureSchema } from "./_lib.js";

export default async function handler(req, res) {
  const hasApiKey = Boolean(process.env.CURSOR_API_KEY);
  try {
    await ensureSchema();
    const r = await db().execute("SELECT COUNT(*) AS n FROM faq WHERE status = 'published'");
    res.status(200).json({ ok: true, hasApiKey, runtime: "cloud", faqCount: Number(r.rows[0].n) });
  } catch (e) {
    res.status(200).json({ ok: true, hasApiKey, runtime: "cloud", faqCount: 0, dbError: String(e.message || e) });
  }
}

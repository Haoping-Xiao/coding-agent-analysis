import { readBody, checkLogin, adminToken } from "./_lib.js";

// 管理员登录：账号密码正确则返回一个 HMAC token（前端存起来，后续提问带上）。
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { username, password } = readBody(req);
  if (checkLogin(String(username || ""), String(password || ""))) {
    return res.status(200).json({ ok: true, token: adminToken() });
  }
  res.status(401).json({ ok: false, error: "账号或密码错误" });
}

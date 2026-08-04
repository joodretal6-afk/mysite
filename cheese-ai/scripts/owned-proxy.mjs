// ═══════════════════════════════════════════════════════════
// بروكسي بسيط بمفتاح حماية أمام Ollama (يخلي نموذجك المحلي آمن على النت)
// شيخ الجبنة يتصل فيه: baseUrl = http://IP:8080/v1  | المفتاح = PROXY_TOKEN
// ═══════════════════════════════════════════════════════════
import http from "node:http";

const TOKEN = process.env.PROXY_TOKEN || "";
const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const PORT = Number(process.env.PROXY_PORT || 8080);

if (!TOKEN) { console.error("⚠️ لازم تضبط PROXY_TOKEN (كلمة سر لحماية نموذجك)"); process.exit(1); }

http.createServer((req, res) => {
  // فحص المفتاح
  const auth = req.headers["authorization"] || "";
  if (auth !== "Bearer " + TOKEN) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthorized"}'); }

  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    try {
      const r = await fetch(OLLAMA + req.url, {
        method: req.method,
        headers: { "content-type": "application/json" },
        body: (req.method === "GET" || req.method === "HEAD") ? undefined : body
      });
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json" });
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
  });
}).listen(PORT, "0.0.0.0", () => console.log(`🔒 بروكسي نموذجك يعمل على المنفذ ${PORT} (يوجّه إلى ${OLLAMA})`));

// ═══════════════════════════════════════════════════════════
// 🧪 وحدة «أرقام من المحادثات»
//  - تلتقط 077/078/079 من كلام الزبون فقط (direction='in')
//  - تتجاهل أرقام بوتنا (direction='out')
//  - كل صفحة لحالها، وتجمّع لكل زبون
// ═══════════════════════════════════════════════════════════
if (!process.env.DB_PATH || /platform\.db/.test(process.env.DB_PATH))
  process.env.DB_PATH = "./data/smoke-phones.db";
if (/platform\.db/.test(process.env.DB_PATH)) {
  console.error("🔴 رفض: الاختبار ما بيشتغل على قاعدة الإنتاج"); process.exit(1);
}
import fs from "node:fs";
const wipe = () => ["", "-wal", "-shm"].forEach(x => { try { fs.rmSync(process.env.DB_PATH + x); } catch {} });
wipe();

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log("✅ " + m); } else { console.log("❌ " + m); fail++; } };
const threw = (fn) => { try { fn(); return false; } catch { return true; } };

const { db, logMessage } = await import("../src/db/database.js");
await new Promise(r => setTimeout(r, 600));
const ph = await import("../src/features/phones.js");

const P1 = "page1", P2 = "page2";
const msg = (page, sender, dir, body, at) => logMessage({ page_id: page, page_name: "صفحة " + page, sender_id: sender, direction: dir, body, created_at: at });

const T = Date.now();
// زبون A بصفحة 1: ذكر رقمه بصيغتين
msg(P1, "cA", "in", "مرحبا بدي اطلب رقمي 0791234567", T - 5000);
msg(P1, "cA", "in", "او تواصلو على +962788111222", T - 4000);
// بوتنا رد وفيه رقم → لازم يتجاهل
msg(P1, "cA", "out", "تم، للطلبات رقمنا 0779175042", T - 3000);
// زبون B بصفحة 1: بلا رقم
msg(P1, "cB", "in", "قديش السعر؟", T - 2000);
// زبون C بصفحة 2: رقم بأرقام عربية
msg(P2, "cC", "in", "رقمي ٠٧٧٩٩٨٨٧٧٦ ضروري", T - 1000);

const call = (urlPath, query = {}) => {
  const layer = ph.router.stack.find(l => l.route && l.route.path === urlPath && l.route.methods.get);
  const res = { body: null, status(){ return this; }, json(j){ this.body = j; return this; }, setHeader(){}, send(s){ this.sent = s; } };
  layer.route.stack[layer.route.stack.length - 1].handle({ query }, res);
  return res;
};

// ── كل الصفحات ──
let r = call("/", {});
ok(r.body.ok, "النقطة ترجّع بنجاح");
const all = r.body.rows;
ok(all.length === 2, "محادثتان فيهما أرقام (A بصفحة1، C بصفحة2) — B بلا رقم ما ظهرت");

// ── أرقام الزبون A مجمّعة، وبلا رقم البوت ──
const a = all.find(x => x.sender_id === "cA");
ok(a && a.page_id === P1, "زبون A بصفحة 1");
ok(a && a.phones.includes("0791234567") && a.phones.includes("0788111222"), "التقط رقمي الزبون بالصيغتين");
ok(a && !a.phones.includes("0779175042"), "🔴 رقم بوتنا (out) ما انلتقط نهائياً");
ok(a && a.phones.length === 2, "رقمين فقط للزبون A");

// ── الأرقام العربية ──
const c = all.find(x => x.sender_id === "cC");
ok(c && c.phones.includes("0779988776"), "التقط رقم مكتوب بأرقام عربية");

// ── الفصل لكل صفحة ──
ok(call("/", { page_id: P1 }).body.rows.length === 1, "صفحة 1 فيها محادثة وحدة بأرقام");
ok(call("/", { page_id: P2 }).body.rows.length === 1, "صفحة 2 فيها محادثة وحدة بأرقام");
ok(call("/", { page_id: "page3" }).body.rows.length === 0, "صفحة بلا محادثات → فاضية");

// ── meta بعدّاد لكل صفحة ──
const meta = call("/meta", {}).body;
ok(meta.total === 2, "الإجمالي محادثتان");

// ── CSV فيه BOM وأرقام ──
const csv = call("/export.csv", {});
ok(csv.sent && csv.sent.startsWith("﻿"), "التصدير فيه BOM لإكسل العربي");
ok(csv.sent.includes("0791234567") && !csv.sent.includes("0779175042"), "CSV فيه أرقام الزبون مش البوت");

wipe();
console.log(`\n${fail ? "🔴" : "🟢"} نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);

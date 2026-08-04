# 🧀👑 نموذج ملكك ١٠٠٪ ومجاني للأبد (Oracle + Ollama)

هدفك: نموذج ذكاء مفتوح (Qwen/Llama) يشتغل على **سيرفرك انت** — مجاني للأبد، مستقل تماماً عن جوجل وOpenAI وGroq.

> **صدق كامل:** مجاني فعلاً. التسجيل بدو بطاقة للتحقق فقط (ما بتخصم). الردود أبطأ من Groq (٥-١٥ ثانية) لأنها على معالج عادي — بس ملكك حرفياً.

---

## الخطوة ١ — أنشئ سيرفر Oracle المجاني (انت بتعملها)
1. سجّل على **cloud.oracle.com** ← Start for free (بدو بطاقة للتحقق، Always Free ما بتخصم).
2. من القائمة: **Compute ← Instances ← Create Instance**.
3. الإعدادات:
   - **Image:** Ubuntu 22.04
   - **Shape:** اضغط Change Shape ← **Ampere (ARM)** ← `VM.Standard.A1.Flex` ← حط **4 OCPU** و **24 GB RAM** (كلها ضمن المجاني).
4. **SSH Keys:** نزّل المفتاح الخاص (Private key) واحتفظ فيه.
5. اضغط **Create**. بعد دقيقة بيصير عندك **Public IP** — انسخه.

> لو طلع "Out of capacity" جرّب Region ثاني أو أعد المحاولة بعد شوي (شائع مع ARM المجاني).

## الخطوة ٢ — افتح المنفذ ٨٠٨٠
1. من صفحة الـ Instance ← **Virtual Cloud Network** ← **Security Lists** ← Default.
2. **Add Ingress Rule:** Source `0.0.0.0/0` ، Protocol TCP ، Destination Port `8080`. احفظ.

## الخطوة ٣ — ادخل السيرفر وشغّل الأمر الواحد (أنا جهّزته)
من جهازك (أو من Cloud Shell بموقع Oracle):
```bash
ssh -i مفتاحك.key ubuntu@IP-سيرفرك

# نزّل السكربت والبروكسي
sudo apt update && sudo apt install -y nodejs curl
curl -fsSL https://raw.githubusercontent.com/joodretal6-afk/mysite/claude/separate-complete-project-blta9i/cheese-ai/scripts/owned-proxy.mjs -o owned-proxy.mjs
curl -fsSL https://raw.githubusercontent.com/joodretal6-afk/mysite/claude/separate-complete-project-blta9i/cheese-ai/scripts/setup-owned-model.sh -o setup.sh

# شغّل (qwen2.5:3b أسرع | qwen2.5:7b أذكى)
bash setup.sh qwen2.5:3b
```
بعد ما يخلص، بيطبعلك **Base URL + المفتاح + اسم الموديل**. انسخهم.

## الخطوة ٤ — اربطه بشيخ الجبنة
افتح `موقعك/cheese/admin` ← الإعدادات:
| الخانة | القيمة |
|--------|--------|
| المزوّد | نموذج مفتوح / سيرفرك |
| Base URL | `http://IP-سيرفرك:8080/v1` |
| المفتاح | (اللي طبعه السكربت) |
| اسم الموديل | `qwen2.5:3b` |

احفظ ← جرّب الدردشة. **هلأ الدماغ على سيرفرك انت — ملكك ١٠٠٪.** 🌹

---

## نصائح
- **أذكى:** استعمل `qwen2.5:7b` لو الرام تكفي (٢٤ جيجا بتكفي).
- **أمان أعلى (https):** بدل فتح المنفذ، استخدم **Cloudflare Tunnel** المجاني — بيعطيك رابط https آمن بدون فتح بورت.
- **يبقى شغّال بعد إعادة التشغيل:** Ollama بينزّل كخدمة تلقائياً؛ للبروكسي اعمله systemd service لو حبيت (اسألني).

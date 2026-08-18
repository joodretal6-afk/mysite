#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# تجهيز نموذج مفتوح ملكك على سيرفرك (Oracle/أي لينكس) — بأمر واحد
# الاستخدام:  bash setup-owned-model.sh [اسم-النموذج]
# مثال:       bash setup-owned-model.sh qwen2.5:3b
# ═══════════════════════════════════════════════════════════
set -e
MODEL="${1:-qwen2.5:3b}"     # 3b أسرع | 7b أذكى (لو الرام تكفي)
PROXY_PORT="${PROXY_PORT:-8080}"

echo "════════════════════════════════════════"
echo "🧀 تجهيز نموذجك الخاص: $MODEL"
echo "════════════════════════════════════════"

# 1) تثبيت Ollama
if ! command -v ollama >/dev/null 2>&1; then
  echo "⬇️  تثبيت Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

# 2) تشغيل Ollama كخدمة (يبقى شغّال ويقلع مع السيرفر)
sudo systemctl enable ollama 2>/dev/null || true
sudo systemctl start ollama 2>/dev/null || (nohup ollama serve >/tmp/ollama.log 2>&1 &)
sleep 3

# 3) تنزيل النموذج
echo "⬇️  تنزيل النموذج $MODEL (قد يأخذ دقائق)..."
ollama pull "$MODEL"

# 4) توليد مفتاح حماية عشوائي إن لم يوجد
TOKEN_FILE="$HOME/.cheese_proxy_token"
if [ ! -f "$TOKEN_FILE" ]; then head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$TOKEN_FILE"; fi
TOKEN="$(cat "$TOKEN_FILE")"

# 5) تشغيل البروكسي المحمي (يحتاج Node 18+)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🔒 تشغيل البروكسي المحمي على المنفذ $PROXY_PORT..."
pkill -f owned-proxy.mjs 2>/dev/null || true
PROXY_TOKEN="$TOKEN" PROXY_PORT="$PROXY_PORT" nohup node "$SCRIPT_DIR/owned-proxy.mjs" >/tmp/cheese-proxy.log 2>&1 &
sleep 2

IP="$(curl -s ifconfig.me || echo 'IP-سيرفرك')"
echo ""
echo "✅ تم! نموذجك شغّال وملكك ١٠٠٪"
echo "════════════════════════════════════════"
echo "بلوحة شيخ الجبنة ← الإعدادات، حط:"
echo "  المزوّد     : نموذج مفتوح / سيرفرك"
echo "  Base URL    : http://$IP:$PROXY_PORT/v1"
echo "  المفتاح     : $TOKEN"
echo "  اسم الموديل : $MODEL"
echo "════════════════════════════════════════"
echo "⚠️ تأكد إنك فتحت المنفذ $PROXY_PORT في Oracle (Security List / Ingress Rules)."

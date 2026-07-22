// ═══════════════════════════════════════════════════════════
// صندوق الوارد: جلب المحادثات والرسائل من فيسبوك عبر Graph API
// يستخدم توكن كل صفحة لقراءة المحادثات الغير مقروءة والطلبات فيها
// ═══════════════════════════════════════════════════════════
import { CONFIG } from "../config.js";
import { PAGES } from "./brain.js";

const GRAPH = `https://graph.facebook.com/${CONFIG.GRAPH_VERSION}`;

// جلب قائمة المحادثات لصفحة (مع عدد الغير مقروء وآخر رسالة)
export async function fetchConversations(pageId, { limit = 30 } = {}) {
  const page = PAGES[pageId];
  if (!page) throw new Error("صفحة غير معروفة");
  const token = page.PAGE_TOKEN;

  const fields = "unread_count,updated_time,message_count,participants,messages.limit(1){message,from,created_time}";
  const url = `${GRAPH}/${pageId}/conversations?platform=messenger&fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${token}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "خطأ في جلب المحادثات");

  return (data.data || []).map(c => {
    const parts = c.participants?.data || [];
    const cust = parts.find(p => p.id !== pageId) || {};
    const last = c.messages?.data?.[0] || {};
    return {
      id: c.id,
      unread: c.unread_count || 0,
      updated: c.updated_time,
      messageCount: c.message_count || 0,
      customerId: cust.id || "",
      customerName: cust.name || "زبون",
      lastMessage: last.message || "(بدون نص)"
    };
  });
}

// جلب رسائل محادثة معينة (مرتّبة من الأقدم للأحدث)
export async function fetchMessages(pageId, conversationId, { limit = 50 } = {}) {
  const page = PAGES[pageId];
  if (!page) throw new Error("صفحة غير معروفة");
  const token = page.PAGE_TOKEN;

  const fields = `participants,messages.limit(${limit}){message,from,created_time}`;
  const url = `${GRAPH}/${conversationId}?fields=${encodeURIComponent(fields)}&access_token=${token}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "خطأ في جلب الرسائل");

  const parts = data.participants?.data || [];
  const cust = parts.find(p => p.id !== pageId) || {};

  const msgs = (data.messages?.data || [])
    .map(m => ({
      text: m.message || "",
      fromId: m.from?.id || "",
      fromName: m.from?.name || "",
      time: m.created_time,
      isPage: m.from?.id === pageId
    }))
    .reverse();   // الأقدم أولاً حتى تُقرأ كمحادثة طبيعية

  return { customerId: cust.id || "", customerName: cust.name || "زبون", messages: msgs };
}

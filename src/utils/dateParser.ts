/**
 * Parse a date/time string expressed in Thai or English relative/absolute format
 * into a JS Date object (system timezone = Asia/Bangkok assumed for relative terms).
 * Returns null if the string cannot be parsed.
 */
export function parseEntryTime(input: string | undefined | null): Date | null {
  if (!input) return null;
  const s = input.trim();

  // ISO 8601 string
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const lower = s.toLowerCase();
  const now = new Date();

  // "ตอนนี้" / "now" / "เดี๋ยวนี้"
  if (['ตอนนี้', 'now', 'เดี๋ยวนี้', 'just now', 'ขณะนี้'].some(k => lower.includes(k))) {
    return now;
  }

  // Relative minutes: "30 นาทีที่แล้ว" / "30min ago" / "30 minutes ago"
  const minuteMatch = lower.match(/(\d+)\s*(นาที|min|minute)/);
  if (minuteMatch) {
    return new Date(now.getTime() - parseInt(minuteMatch[1]) * 60 * 1000);
  }

  // Relative hours: "2 ชั่วโมงที่แล้ว" / "2h ago" / "2 hours ago"
  const hourMatch = lower.match(/(\d+)\s*(ชั่วโมง|ชม\b|h\b|hour)/);
  if (hourMatch) {
    return new Date(now.getTime() - parseInt(hourMatch[1]) * 60 * 60 * 1000);
  }

  // Relative days: "3 วันที่แล้ว" / "3 days ago" (exclude "วันนี้")
  const dayMatch = lower.match(/(\d+)\s*(วัน|day)/);
  if (dayMatch && !lower.includes('วันนี้')) {
    return new Date(now.getTime() - parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000);
  }

  // "เมื่อวาน" / "yesterday"
  const isYesterday = lower.includes('เมื่อวาน') || lower.includes('yesterday');
  // "วันนี้" / "today"
  const isToday = lower.includes('วันนี้') || lower.includes('today') ||
    lower.includes('เช้านี้') || lower.includes('คืนนี้');

  // Extract HH:MM time component from string
  const timeMatch = s.match(/(\d{1,2}):(\d{2})/);

  if (isYesterday || isToday) {
    const base = new Date(now);
    if (isYesterday) base.setDate(base.getDate() - 1);
    if (timeMatch) {
      base.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
    } else {
      base.setHours(0, 0, 0, 0);
    }
    return base;
  }

  // "DD/MM HH:MM" or "DD/MM/YYYY HH:MM"
  const dateSlash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})/);
  if (dateSlash) {
    const day = parseInt(dateSlash[1]);
    const month = parseInt(dateSlash[2]) - 1;
    const year = dateSlash[3] ? parseInt(dateSlash[3]) : now.getFullYear();
    const hour = parseInt(dateSlash[4]);
    const minute = parseInt(dateSlash[5]);
    const d = new Date(year, month, day, hour, minute, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  // Just HH:MM → assume today
  if (timeMatch) {
    const base = new Date(now);
    base.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
    return base;
  }

  // Last resort: native Date.parse
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

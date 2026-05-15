export function formatMoney(amount: number | string | null | undefined, symbol = "Rs") {
  const n = typeof amount === "string" ? Number(amount) : (amount ?? 0);
  if (!Number.isFinite(n)) return `${symbol}0.00`;
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PAKISTAN_TIME_ZONE = "Asia/Karachi";
const PAKISTAN_UTC_OFFSET_MINUTES = 5 * 60;

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PAKISTAN_TIME_ZONE,
  });
}

export function pakistanDateInputValue(date = new Date()) {
  const pakistanTime = new Date(date.getTime() + PAKISTAN_UTC_OFFSET_MINUTES * 60 * 1000);
  return pakistanTime.toISOString().slice(0, 10);
}

export function pakistanDayUtcRange(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const startUtcMs = Date.UTC(year, month - 1, day) - PAKISTAN_UTC_OFFSET_MINUTES * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;

  return {
    start: new Date(startUtcMs).toISOString(),
    end: new Date(endUtcMs).toISOString(),
  };
}

export function pakistanDateRangeUtcBounds(startDate: string, endDate: string) {
  return {
    start: pakistanDayUtcRange(startDate).start,
    end: pakistanDayUtcRange(endDate).end,
  };
}

export function formatPakistanDateLabel(dateValue: string, options?: Intl.DateTimeFormatOptions) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString(undefined, { timeZone: "UTC", ...options });
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

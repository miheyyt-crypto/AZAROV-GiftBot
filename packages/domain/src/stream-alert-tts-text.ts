/**
 * Worker-only spoken form for Silero CIS. Shop/DB/card keep the original message.
 * Lowercase before any alphabet constraint so "Привет" stays "привет", not "ривет".
 */

const ONES = [
  "ноль",
  "один",
  "два",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
] as const;

const TENS = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
] as const;

const HUNDREDS = [
  "",
  "сто",
  "двести",
  "триста",
  "четыреста",
  "пятьсот",
  "шестьсот",
  "семьсот",
  "восемьсот",
  "девятьсот",
] as const;

const MONTHS = [
  "",
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

const DAYS: Record<number, string> = {
  1: "первое",
  2: "второе",
  3: "третье",
  4: "четвёртое",
  5: "пятое",
  6: "шестое",
  7: "седьмое",
  8: "восьмое",
  9: "девятое",
  10: "десятое",
  11: "одиннадцатое",
  12: "двенадцатое",
  13: "тринадцатое",
  14: "четырнадцатое",
  15: "пятнадцатое",
  16: "шестнадцатое",
  17: "семнадцатое",
  18: "восемнадцатое",
  19: "девятнадцатое",
  20: "двадцатое",
  21: "двадцать первое",
  22: "двадцать второе",
  23: "двадцать третье",
  24: "двадцать четвёртое",
  25: "двадцать пятое",
  26: "двадцать шестое",
  27: "двадцать седьмое",
  28: "двадцать восьмое",
  29: "двадцать девятое",
  30: "тридцатое",
  31: "тридцать первое",
};

const LATIN: Record<string, string> = {
  a: "а",
  b: "б",
  c: "к",
  d: "д",
  e: "е",
  f: "ф",
  g: "г",
  h: "х",
  i: "и",
  j: "й",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  q: "к",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  v: "в",
  w: "в",
  x: "кс",
  y: "и",
  z: "з",
};

/** CIS v5 alphabet after lowercase (plus stress '+' added later). */
export const SILERO_CIS_SPEAKABLE =
  "абвгдеёжзийклмнопрстуфхцчшщъыьэюя .,!?+:-;";

export function ruInt(n: number): string {
  if (!Number.isFinite(n)) {
    return "ноль";
  }
  const value = Math.trunc(n);
  if (value < 0) {
    return `минус ${ruInt(-value)}`;
  }
  if (value < 20) {
    return ONES[value] ?? "ноль";
  }
  if (value < 100) {
    const a = Math.floor(value / 10);
    const b = value % 10;
    const tens = TENS[a] ?? "ноль";
    return b === 0 ? tens : `${tens} ${ONES[b] ?? "ноль"}`;
  }
  if (value < 1000) {
    const a = Math.floor(value / 100);
    const b = value % 100;
    const hundreds = HUNDREDS[a] ?? "ноль";
    return b === 0 ? hundreds : `${hundreds} ${ruInt(b)}`;
  }
  if (value < 1_000_000) {
    const a = Math.floor(value / 1000);
    const b = value % 1000;
    let head: string;
    if (a === 1) {
      head = "тысяча";
    } else if (a === 2 || a === 3 || a === 4) {
      const word = ruInt(a).replace("один", "одна").replace("два", "две");
      head = `${word} тысячи`;
    } else {
      head = `${ruInt(a)} тысяч`;
    }
    return b === 0 ? head : `${head} ${ruInt(b)}`;
  }
  return String(value)
    .split("")
    .map((ch) => ONES[Number(ch)] ?? "ноль")
    .join(" ");
}

function ruYear(y: number): string {
  if (y >= 2000 && y <= 2099) {
    const tail = y - 2000;
    return tail === 0 ? "две тысячи" : `две тысячи ${ruInt(tail)}`;
  }
  return ruInt(y);
}

function transliterateLatin(word: string): string {
  return [...word.toLowerCase()].map((ch) => LATIN[ch] ?? ch).join("");
}

function expandDatesAndNumbers(text: string): string {
  let next = text.replace(
    /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g,
    (_all, dRaw: string, mRaw: string, yRaw: string) => {
      const d = Number(dRaw);
      const m = Number(mRaw);
      const y = Number(yRaw);
      const day = DAYS[d] ?? ruInt(d);
      const month =
        m >= 1 && m <= 12 ? (MONTHS[m] ?? ruInt(m)) : ruInt(m);
      return `${day} ${month} ${ruYear(y)} года`;
    },
  );
  next = next.replace(/\b\d{1,3}(?:[ \u00a0]\d{3})+\b/g, (chunk) =>
    ruInt(Number(chunk.replace(/[ \u00a0]/g, ""))),
  );
  next = next.replace(/\b\d+\b/g, (chunk) => ruInt(Number(chunk)));
  next = next.replace(/\bazc\b/gi, "а зэ цэ");
  return next;
}

function mapLeftover(ch: string): string {
  if (SILERO_CIS_SPEAKABLE.includes(ch) || ch === "\n" || ch === "\t") {
    return ch === "\n" || ch === "\t" ? " " : ch;
  }
  if (/\p{Extended_Pictographic}/u.test(ch) || /\p{Emoji_Presentation}/u.test(ch)) {
    return " эмодзи ";
  }
  if (/[A-Za-z]/.test(ch)) {
    return transliterateLatin(ch);
  }
  switch (ch) {
    case "@":
      return " собака ";
    case "#":
      return " решётка ";
    case "%":
      return " процент ";
    case "&":
      return " и ";
    case "$":
      return " доллар ";
    case "€":
      return " евро ";
    case "+":
      return " плюс ";
    default:
      if (/\p{L}/u.test(ch)) {
        return " буква ";
      }
      return " ";
  }
}

/**
 * Spoken CIS text. Does not mutate the donation message.
 * Never strips whole words: latin is transliterated, symbols are named.
 */
export function prepareStreamAlertTtsText(raw: string): string {
  const expanded = expandDatesAndNumbers(raw.normalize("NFC"));
  const lowered = expanded.toLocaleLowerCase("ru-RU");
  const latinSwapped = lowered.replace(/[A-Za-z]+/g, transliterateLatin);
  let mapped = "";
  for (const ch of latinSwapped) {
    mapped += mapLeftover(ch);
  }
  const compact = mapped.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    return "сообщение";
  }
  if (!/[.!?]$/.test(compact)) {
    return `${compact}.`;
  }
  return compact;
}

export function splitStreamAlertTtsChunks(
  spoken: string,
  maxChars = 180,
): string[] {
  const parts = spoken
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const source = parts.length > 0 ? parts : [spoken.trim()];
  const out: string[] = [];
  for (const part of source) {
    if (part.length <= maxChars) {
      out.push(part);
      continue;
    }
    let rest = part;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut < 40) {
        cut = maxChars;
      }
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest.length > 0) {
      out.push(rest);
    }
  }
  return out.length > 0 ? out : [spoken];
}

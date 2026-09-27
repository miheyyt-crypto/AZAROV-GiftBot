import { DomainError } from "./errors.js";
import { normalizeHttpsAvatarUrl } from "./https-url.js";

export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;
export const TELEGRAM_CAPTION_MAX_LENGTH = 1024;

const ALLOWED = new Set(["b", "i", "u", "s", "code", "a"]);

export class BroadcastInvalidError extends DomainError {
  constructor(message: string) {
    super("BROADCAST_INVALID", message);
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readTag(source: string, start: number): {
  raw: string;
  name: string;
  closing: boolean;
  href?: string;
} | null {
  if (source[start] !== "<") {
    return null;
  }
  const end = source.indexOf(">", start);
  if (end < 0 || end - start > 256) {
    return null;
  }
  const inner = source.slice(start + 1, end).trim();
  if (!inner) {
    return null;
  }
  const closing = inner.startsWith("/");
  const body = closing ? inner.slice(1).trim() : inner;
  const nameMatch = /^([a-z]+)/i.exec(body);
  if (!nameMatch) {
    return null;
  }
  const name = nameMatch[1]!.toLowerCase();
  if (!ALLOWED.has(name)) {
    return null;
  }
  if (closing) {
    if (body.slice(name.length).trim() !== "") {
      return null;
    }
    return { raw: source.slice(start, end + 1), name, closing: true };
  }
  if (name === "a") {
    const hrefMatch = /^a\s+href="([^"]+)"\s*$/i.exec(body);
    if (!hrefMatch) {
      return null;
    }
    const href = normalizeHttpsAvatarUrl(hrefMatch[1]);
    if (!href) {
      return null;
    }
    return { raw: source.slice(start, end + 1), name, closing: false, href };
  }
  if (body !== name) {
    return null;
  }
  return { raw: source.slice(start, end + 1), name, closing: false };
}

export function sanitizeTelegramHtml(raw: string): string {
  const source = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let out = "";
  const stack: string[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) {
      break;
    }
    if (ch !== "<") {
      out += escapeText(ch);
      i += 1;
      continue;
    }
    const tag = readTag(source, i);
    if (!tag) {
      out += "&lt;";
      i += 1;
      continue;
    }
    if (tag.closing) {
      if (stack[stack.length - 1] !== tag.name) {
        out += escapeText(tag.raw);
        i += tag.raw.length;
        continue;
      }
      stack.pop();
      out += `</${tag.name}>`;
      i += tag.raw.length;
      continue;
    }
    stack.push(tag.name);
    if (tag.name === "a" && tag.href) {
      out += `<a href="${tag.href}">`;
    } else {
      out += `<${tag.name}>`;
    }
    i += tag.raw.length;
  }
  while (stack.length > 0) {
    const name = stack.pop();
    if (name) {
      out += `</${name}>`;
    }
  }
  return out;
}

export function assertTelegramHtmlLength(
  html: string,
  max = TELEGRAM_MESSAGE_MAX_LENGTH,
): void {
  if (html.length === 0) {
    throw new BroadcastInvalidError("message is required");
  }
  if (html.length > max) {
    throw new BroadcastInvalidError("message exceeds Telegram length limit");
  }
}

export function telegramHtmlFitsCaption(html: string): boolean {
  return html.length <= TELEGRAM_CAPTION_MAX_LENGTH;
}

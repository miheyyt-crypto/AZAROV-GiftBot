import type { RollsHubView } from "./rolls-spin.js";
import type { RollsParticipant } from "./rolls-types.js";
import { httpsAvatarSrc } from "../lib/https-url.js";

export type WheelSector = {
  participantId: string;
  displayName: string;
  stake: number;
  color: string;
  startAngle: number;
  sweep: number;
  avatarKey: string | null;
};

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function sectorColor(participantId: string, index: number): string {
  const hue = (hashHue(participantId) + index * 47) % 360;
  return `hsl(${hue} 48% 48%)`;
}

export function buildSectors(
  participants: RollsParticipant[],
  totalPot: number,
): WheelSector[] {
  if (participants.length === 0 || totalPot <= 0) {
    const slices = 8;
    const sweep = (Math.PI * 2) / slices;
    return Array.from({ length: slices }, (_, index) => ({
      participantId: `wait-${index}`,
      displayName: "",
      stake: 1,
      color: index % 2 === 0 ? "#6d3eb3" : "#3a2662",
      startAngle: index * sweep,
      sweep,
      avatarKey: null,
    }));
  }
  const sectors: WheelSector[] = [];
  let angle = 0;
  participants.forEach((p, index) => {
    const stake = Number(p.stakeAzc);
    const sweep = (stake / totalPot) * Math.PI * 2;
    sectors.push({
      participantId: p.participantId,
      displayName: p.displayName,
      stake,
      color: sectorColor(p.participantId, index),
      startAngle: angle,
      sweep,
      avatarKey: p.avatarUrl ?? p.avatarKey,
    });
    angle += sweep;
  });
  return sectors;
}

const MIN_AVATAR_SWEEP = (3 * Math.PI) / 180;
/** One full idle revolution while waiting. Linear, presentation-only. */
export const ROLLS_IDLE_TURN_MS = 24_000;

export class RollsWheelEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sectors: WheelSector[] = [];
  private rotation = 0;
  private raf = 0;
  private running = false;
  private mode: "idle" | "spin" | "stopped" = "stopped";
  private idleOrigin = 0;
  private idleStartedAt = 0;
  private waitingLabel = true;
  private hub: RollsHubView = { kind: "waiting" };
  private underPointerName = "";
  private onPointerName: ((name: string) => void) | undefined;
  private size = 280;
  private avatarCache = new Map<string, HTMLImageElement>();

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2d context unavailable");
    }
    this.canvas = canvas;
    this.ctx = ctx;
  }

  setOnPointerName(cb: ((name: string) => void) | undefined): void {
    this.onPointerName = cb;
  }

  rememberAvatar(src: string, img: HTMLImageElement): void {
    this.avatarCache.set(src, img);
    if (img.complete && img.naturalWidth > 0) {
      this.draw();
    }
  }

  setSectors(
    sectors: WheelSector[],
    options: { idle: boolean; placeholder: boolean },
  ): void {
    this.sectors = sectors;
    this.waitingLabel = options.placeholder;
    this.draw();
    if (this.mode === "spin") {
      return;
    }
    if (options.idle) {
      this.ensureIdle();
    } else {
      this.stopIdle();
    }
  }

  setHub(hub: RollsHubView): void {
    this.hub = hub;
    this.draw();
  }

  setRotation(radians: number): void {
    this.rotation = radians;
    this.draw();
  }

  getRotation(): number {
    return this.rotation;
  }

  resize(cssSize: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = cssSize;
    this.canvas.width = Math.floor(cssSize * dpr);
    this.canvas.height = Math.floor(cssSize * dpr);
    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  startLoop(tick: (now: number) => boolean): void {
    this.stopIdle();
    this.stopLoop();
    this.mode = "spin";
    this.running = true;
    const frame = (now: number) => {
      if (!this.running || this.mode !== "spin") {
        return;
      }
      const cont = tick(now);
      this.draw();
      if (cont) {
        this.raf = requestAnimationFrame(frame);
      } else {
        this.running = false;
        this.raf = 0;
        this.mode = "stopped";
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  stopLoop(): void {
    if (this.mode !== "spin") {
      return;
    }
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.mode = "stopped";
  }

  private stopIdle(): void {
    if (this.mode !== "idle") {
      return;
    }
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.mode = "stopped";
  }

  private ensureIdle(): void {
    if (this.mode === "spin") {
      return;
    }
    if (this.mode === "idle" && this.running) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    this.idleOrigin = this.rotation;
    this.idleStartedAt = performance.now();
    this.mode = "idle";
    this.running = true;
    const frame = (now: number) => {
      if (!this.running || this.mode !== "idle") {
        return;
      }
      const turns = (now - this.idleStartedAt) / ROLLS_IDLE_TURN_MS;
      this.rotation = this.idleOrigin + turns * Math.PI * 2;
      this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  destroy(): void {
    this.stopIdle();
    this.stopLoop();
    this.onPointerName = undefined;
    this.avatarCache.clear();
  }

  private drawHub(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    centerR: number,
  ): void {
    ctx.textAlign = "center";
    const hub = this.hub;
    if (hub.kind === "betting") {
      const urgent = hub.seconds <= 3;
      if (urgent) {
        ctx.save();
        ctx.shadowColor = "rgba(196, 168, 255, 0.45)";
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = "rgba(196, 181, 232, 0.78)";
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("СТАРТ ЧЕРЕЗ", cx, cy - centerR * 0.28);
      ctx.fillStyle = urgent ? "#f4e9c8" : "rgba(244, 240, 255, 0.96)";
      ctx.font = "800 36px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(String(hub.seconds), cx, cy + centerR * 0.18);
      if (urgent) {
        ctx.restore();
      }
      return;
    }
    ctx.fillStyle = "rgba(236, 230, 255, 0.82)";
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    if (hub.kind === "waiting") {
      ctx.fillText("Ожидание", cx, cy);
    } else if (hub.kind === "spinning") {
      ctx.fillText("КРУТИМ", cx, cy);
    }
  }

  private avatarImage(sector: WheelSector): HTMLImageElement | null {
    const src = httpsAvatarSrc(sector.avatarKey);
    if (!src) {
      return null;
    }
    const cached = this.avatarCache.get(src);
    if (cached) {
      return cached.complete && cached.naturalWidth > 0 ? cached : null;
    }
    return null;
  }

  private draw(): void {
    const ctx = this.ctx;
    const size = this.size;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.492;
    const centerR = radius * 0.32;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rotation - Math.PI / 2);

    for (const sector of this.sectors) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, sector.startAngle, sector.startAngle + sector.sweep);
      ctx.closePath();
      ctx.fillStyle = sector.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(8, 5, 18, 0.16)";
      ctx.lineWidth = 0.55;
      ctx.stroke();

      if (
        !this.waitingLabel &&
        sector.sweep >= MIN_AVATAR_SWEEP &&
        sector.displayName
      ) {
        const mid =
          sector.sweep >= Math.PI * 1.85
            ? sector.startAngle
            : sector.startAngle + sector.sweep / 2;
        const r = (radius + centerR) * 0.58;
        const x = Math.cos(mid) * r;
        const y = Math.sin(mid) * r;
        const avatarR = Math.min(15, Math.max(9, sector.sweep * radius * 0.28));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-(this.rotation - Math.PI / 2));
        ctx.beginPath();
        ctx.arc(0, 0, avatarR, 0, Math.PI * 2);
        ctx.fillStyle = "#efe7ff";
        ctx.fill();
        ctx.clip();
        const img = this.avatarImage(sector);
        if (img) {
          ctx.drawImage(img, -avatarR, -avatarR, avatarR * 2, avatarR * 2);
        } else {
          ctx.fillStyle = "#1a1028";
          ctx.font = "bold 11px system-ui,sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const initial = sector.displayName.trim().charAt(0).toUpperCase() || "?";
          ctx.fillText(initial, 0, 1);
        }
        ctx.restore();
      }
    }

    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(196, 168, 255, 0.22)";
    ctx.lineWidth = 1.35;
    ctx.stroke();

    const hub = ctx.createRadialGradient(cx, cy - centerR * 0.28, 1, cx, cy, centerR);
    hub.addColorStop(0, "#2a1b44");
    hub.addColorStop(0.55, "#141022");
    hub.addColorStop(1, "#0b0714");
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.strokeStyle = "rgba(232, 220, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    this.drawHub(ctx, cx, cy, centerR);

    const pointerWorld = -this.rotation;
    let name = "";
    for (const sector of this.sectors) {
      const a0 = sector.startAngle;
      const a1 = sector.startAngle + sector.sweep;
      const ang = ((pointerWorld % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (ang >= a0 && ang < a1) {
        name = sector.displayName;
        break;
      }
    }
    if (name !== this.underPointerName) {
      this.underPointerName = name;
      this.onPointerName?.(name);
    }
  }
}

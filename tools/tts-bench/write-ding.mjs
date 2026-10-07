import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 22_050;
const seconds = 0.32;
const samples = new Int16Array(Math.round(sampleRate * seconds));
for (let i = 0; i < samples.length; i += 1) {
  const t = i / sampleRate;
  const env = Math.exp(-t * 8);
  const tone =
    Math.sin(2 * Math.PI * 880 * t) + 0.45 * Math.sin(2 * Math.PI * 1320 * t);
  samples[i] = Math.max(-32767, Math.min(32767, Math.round(tone * env * 12000)));
}
const dataBytes = samples.byteLength;
const buffer = Buffer.alloc(44 + dataBytes);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataBytes, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataBytes, 40);
Buffer.from(samples.buffer, samples.byteOffset, dataBytes).copy(buffer, 44);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "apps/web/public/assets/donation-alert.wav");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, buffer);
process.stdout.write(`${out} ${buffer.length} bytes\n`);

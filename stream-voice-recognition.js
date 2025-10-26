import { spawn } from "node:child_process";
import fs from "node:fs";
import pkg from "vosk";
import AhoCorasick from "aho-corasick-node";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { executePiShock } from "./pi-shock-shared.js";


const { Model, Recognizer } = pkg;

// 1) configure
const CHANNEL = "nyaravt";           // e.g., "hasanthehun"

const normalize = s => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

const KEY_PHRASES = [
 "bottom",
  "trans",
  "insult",
  "asmongold",
  "femboy",
  "banana"
].map(normalize);
// 2) keyword matcher (fast multi-pattern search)
const builder = AhoCorasick.builder();
for (const k of KEY_PHRASES) builder.add(k);
const ac = builder.build();

// 3) load Vosk model (download a small English model and set path)
const MODEL_PATH = "./vosk-model-en-us-0.22-lgraph"; // example folder
if (!fs.existsSync(MODEL_PATH)) {
  console.error("Vosk model folder not found:", MODEL_PATH);
  process.exit(1);
}
//Model.setLogLevel(0);
const model = new Model(MODEL_PATH);
const sampleRate = 16000;
const recognizer = new Recognizer({ model, sampleRate });
recognizer.setWords(true);

// 4) start streamlink (MPEG-TS audio-only) → ffmpeg → PCM
// Note: streamlink handles Twitch auth/playlist negotiation for you.
const streamlink = spawn("streamlink", [
  `twitch.tv/${CHANNEL}`,
  "audio_only",
  "--stdout"
], { stdio: ["ignore", "pipe", "inherit"] });


const ffmpeg = spawn("ffmpeg", [
  "-hide_banner",
  "-loglevel", "error",
  "-f", "mpegts",
  "-i", "pipe:0",
  "-vn",
  "-ac", "1",
  "-ar", String(sampleRate),
  "-f", "s16le",
  "-acodec", "pcm_s16le",
  "pipe:1"
], { stdio: ["pipe", "pipe", "inherit"] });

// ⚡ Windows quirk fix:
if (ffmpeg.stdout._handle && ffmpeg.stdout._handle.setBlocking)
  ffmpeg.stdout._handle.setBlocking(true);

streamlink.stdout.pipe(ffmpeg.stdin);

// 5) consume PCM and recognize
ffmpeg.stdout.on("data", (chunk) => {
  const ok = recognizer.acceptWaveform(chunk);
  if (ok) {
    const res = safeParse(recognizer.result());
    handleTranscript(res.text || "");
  } else {
    // partial results arrive frequently; you can use them too:
    const partial = safeParse(recognizer.partialResult());
    if (partial.partial) handleTranscript(partial.partial, true);
  }
});

ffmpeg.on("close", (code) => {
  console.log("ffmpeg closed:", code);
  const finalRes = safeParse(recognizer.finalResult());
  handleTranscript(finalRes.text || "");
});

process.on("SIGINT", () => {
  console.log("\nStopping…");
  streamlink.kill("SIGINT");
  ffmpeg.kill("SIGINT");
  process.exit(0);
});

function safeParse(obj) {
  if (typeof obj === "string") {
    try { return JSON.parse(obj); } catch { return {}; }
  }
  return obj; // already an object
}

const COOLDOWN_MS = 10_000; // 10 seconds between hits (adjust as you like)
const lastHit = new Map();  // remembers last trigger time per phrase

// --- your action on keyword hit
function onKeywordHit(phrase, text) {
  console.log(`🫨🫨 Maza triggered for "${phrase}"! (context: "${text}")`);
  // TODO: add whatever you want here (webhook, OBS, Discord, etc.)
  executePiShock();
}

// --- handleTranscript with cooldown logic
function handleTranscript(text, isPartial = false) {
  //debug output  
  console.log("Searching in <" + text + ">");
  if (!text) return;

  const norm = normalize(text);
  const hits = ac.match(norm); // from aho-corasick-node

  if (!hits.length) return;

  const now = Date.now();
  const phrases = [...new Set(hits)]; // remove duplicates

  for (const phrase of phrases) {
    const last = lastHit.get(phrase) || 0;
    if (now - last >= COOLDOWN_MS) {
      lastHit.set(phrase, now);        // update timestamp
      onKeywordHit(phrase, text);      // trigger your action
    } else {
      console.log(`(cooldown) Skipped "${phrase}" — ${(COOLDOWN_MS - (now - last)) / 1000}s remaining`);
    }
  }
}
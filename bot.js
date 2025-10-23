/*
bot.js
usage: probably something like node bot.js <user> <type> <durationSeconds> <intensity1to100>
*/
// Env: PISHOCK_CODE=YOUR_SHARE_CODE  PISHOCK_NAME="pi-shock-demo"
import fetch from "node-fetch";


const API_URL = "https://do.pishock.com/api/apioperate/";

// Credentials (use env overrides if you like)
const USERNAME = process.env.PISHOCK_USERNAME || "shockers_user_name";
const APIKEY   = process.env.PISHOCK_APIKEY   || "apikey-xxxxxxxxxxx";

// Required by API
const CODE = process.env.PISHOCK_CODE;                
const NAME = process.env.PISHOCK_NAME || "pi-shock-demo"; // will show in PiShock logs

// CLI args
const [, , typeArg, durationArg, intensityArg] = process.argv;
const ShockType  = Number(typeArg ?? 1);
const Duration  = Number(durationArg ?? 1);
const Intensity = Number(intensityArg ?? 50);

// Basic validation
function fail(msg) {
  console.error(msg);
  process.exit(1);
}
if (!CODE) fail("Missing env PISHOCK_CODE (your Share Code).");
if (!NAME) fail("Missing env PISHOCK_NAME (Name shown in logs).");
if (!Number.isInteger(Duration) || Duration < 1) fail("Duration must be an integer >= 1.");
if (!Number.isInteger(Intensity) || Intensity < 1 || Intensity > 100) fail("Intensity must be an integer 1–100.");

const payload = {
  Username: USERNAME,
  Name: NAME,
  Code: CODE,
  Intensity: String(Intensity),
  Duration: String(Duration),
  Apikey: APIKEY,
  Op: String(ShockType), // 1 = Vibrate
};

async function main() {
  try {
    
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`HTTP ${res.status} – ${text}`);
      process.exit(2);
    }

    console.log("Server response:", text);
    if (text.includes("Operation Succeeded")) {
      console.log("Vibrate command sent successfully.");
    } else {
      console.log("ℹ️ The API returned a non-success message. Check your inputs above.");
    }
  } catch (err) {
    console.error("Request failed:", err?.message || err);
    process.exit(3);
  }
}

main();
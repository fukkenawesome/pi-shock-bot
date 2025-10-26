
/* 
 pi-shock-shared.js
 Usage examples:

 OWN device by name (recommended):
   PISHOCK_NAME="My Script" \
   PISHOCK_MODE=own PISHOCK_TARGET_NAME="Shocker 1" \
   node pi-shock-shared.js 1 2 35

 OWN device by shockerId (numeric):
   PISHOCK_NAME="My Script" \
   PISHOCK_MODE=own PISHOCK_TARGET_ID=789 \
   node pi-shock-shared.js 1 2 35

 SHARED device (direct code you received):
   PISHOCK_NAME="My Script" \
   PISHOCK_MODE=shared PISHOCK_CODE="XXXXXXXXXX" \
   node pi-shock-shared.js 1 2 35

 SHARED device (shareId you were given; we resolve the code):
   PISHOCK_NAME="My Script" \
   PISHOCK_MODE=shared PISHOCK_SHAREID=123 \
   node pi-shock-shared.js 1 2 35

 Credentials (defaults set as requested; override in env if needed):
   PISHOCK_USERNAME="puppyfun"
  PISHOCK_APIKEY="apikey-xxxxxxxxxxx"
 */
import dotenv from 'dotenv';
import fetch from "node-fetch";

dotenv.config({ path: '.env' })

const API_OPERATE_URL = "https://do.pishock.com/api/apioperate/";

// New(er) docs auth + device/share endpoints
const AUTH_USERINFO_URL = "https://auth.pishock.com/Auth/GetUserIfAPIKeyValid";
const GET_USER_DEVICES_URL = "https://ps.pishock.com/PiShock/GetUserDevices";
const GET_SHARECODES_BY_OWNER_URL = "https://ps.pishock.com/PiShock/GetShareCodesByOwner";
const GET_SHOCKERS_BY_SHARE_IDS_URL = "https://ps.pishock.com/PiShock/GetShockersByShareIds";

// Requested defaults
const USERNAME = process.env.PISHOCK_USERNAME || "puppyfun";
const APIKEY   = process.env.PISHOCK_APIKEY   || "apikey-xxxxxxxxxxx";

// Script display name (required by classic endpoint)
const CONTROLLER_NAME = process.env.PISHOCK_NAME || "pi-shock-demo-twitch-integration";

// Target selection
const MODE = (process.env.PISHOCK_MODE || "shared").toLowerCase(); // "own" | "shared"
const TARGET_NAME = process.env.PISHOCK_TARGET_NAME || "";         // for MODE=own
const TARGET_ID   = process.env.PISHOCK_TARGET_ID || "";           // for MODE=own (numeric string ok)
const DIRECT_CODE = process.env.PISHOCK_CODE || "";                // for MODE=shared
const SHARE_ID    = process.env.PISHOCK_SHAREID || "";             // for MODE=shared (numeric string ok)

// CLI args: duration + intensity
const [, , typeArg, durationArg, intensityArg] = process.argv;
const ShockType  = Number(typeArg ?? 1);
const Duration  = Number(durationArg ?? 1);
const Intensity = Number(intensityArg ?? 50);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
if (!CONTROLLER_NAME) fail("Missing PISHOCK_NAME (display name for logs).");
if (!Number.isInteger(ShockType) || ShockType < 1) fail("ShockType must be an integer: 0 Shock, 1 Vibrate, 2 Beep.");
if (!Number.isInteger(Duration) || Duration < 1) fail("Duration must be an integer >= 1.");
if (!Number.isInteger(Intensity) || Intensity < 1 || Intensity > 100) fail("Intensity must be an integer 1–100.");

async function httpGet(url, params) {
    const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));

  // Explicitly await fetch and response text before parsing
  const res = await fetch(u.toString(), { method: "GET" }).catch(err => {
    throw new Error(`Network error while fetching ${u}: ${err.message}`);
  });

  const text = await res.text(); // wait for body
  if (!res.ok) {
    throw new Error(`GET ${u.pathname} -> HTTP ${res.status}: ${text}`);
  }

  // Safely parse JSON if possible
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn(`Non-JSON response from ${u.pathname}:`, text);
    data = {};
  }
  return data;
}

async function authenticate(username, apikey) {
  // GET https://auth.pishock.com/Auth/GetUserIfAPIKeyValid?apikey={apikey}&username={username}
  const data = await httpGet(AUTH_USERINFO_URL, { apikey, username });
  console.log(data);
  const userId = data?.UserId;
  if (!userId) throw new Error("Auth okay but no UserID returned.");
  return { userId, username, apikey };
}

async function getUserDevices(userId, apikey) {
  // GET https://ps.pishock.com/PiShock/GetUserDevices?UserId={userid}&Token={apikey}&api=true
  const data = await httpGet(GET_USER_DEVICES_URL, { UserId: userId, Token: apikey, api: true });
  // shape per docs: [{ clientId, name, userId, username, shockers: [{ name, shockerId, isPaused }, ...] }, ...]
  return Array.isArray(data) ? data : [];
}

async function getShareCodesByOwner(userId, apikey) {
  // GET https://ps.pishock.com/PiShock/GetShareCodesByOwner?UserId={userid}&Token={apikey}&api=true
  const data = await httpGet(GET_SHARECODES_BY_OWNER_URL, { UserId: userId, Token: apikey, api: true });
  // shape per docs: { "username1": [123, 456], "username2": [111, ...] }
  return data && typeof data === "object" ? data : {};
}

async function getShockersByShareIds(userId, apikey, shareIds) {
  // GET https://ps.pishock.com/PiShock/GetShockersByShareIds?UserId={userid}&Token={apikey}&api=true&shareIds=123&shareIds=456
  const u = new URL(GET_SHOCKERS_BY_SHARE_IDS_URL);
  u.searchParams.set("UserId", String(userId));
  u.searchParams.set("Token", apikey);
  u.searchParams.set("api", "true");
  for (const id of shareIds) u.searchParams.append("shareIds", String(id));
  const res = await fetch(u.toString(), { method: "GET" });
  console.log(res);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${u.pathname} -> HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text);
  // shape per docs:
  // { "username": [ { shareId, clientId, shockerId, shockerName, ..., shareCode }, ... ] }
  return json && typeof json === "object" ? json : {};
}

async function resolveShareCodeForOwnDevice({ userId, apikey, targetName, targetId }) {
  // 1) List your own devices + shockers
  const devices = await getUserDevices(userId, apikey);
  const allShockers = [];
  for (const hub of devices) {
    for (const s of hub.shockers || []) {
      allShockers.push({ ...s, hubName: hub.name, clientId: hub.clientId });
    }
  }
  if (allShockers.length === 0) {
    throw new Error("No shockers found on your account.");
  }

  // 2) Pick a target shocker either by name or by numeric id
  let target = null;
  if (targetId) {
    const idNum = Number(targetId);
    target = allShockers.find(s => Number(s.shockerId) === idNum);
  } else if (targetName) {
    const lc = targetName.toLowerCase();
    target = allShockers.find(s => (s.name || "").toLowerCase() === lc);
  } else {
    // If neither provided, just pick the first one (explicitness recommended)
    target = allShockers[0];
  }
  if (!target) {
    throw new Error("Target shocker not found. Provide PISHOCK_TARGET_NAME or PISHOCK_TARGET_ID.");
  }

  // 3) Get share IDs you (the owner) have for shockers
  const shareIdMap = await getShareCodesByOwner(userId, apikey);
  const allShareIds = Object.values(shareIdMap).flat();
  if (!allShareIds.length) {
    throw new Error("No share IDs found for your shockers. Create a Share Code for the target shocker in the PiShock UI, then retry.");
  }

  // 4) Resolve those share IDs into detailed entries, including shareCode
  const byOwner = await getShockersByShareIds(userId, apikey, allShareIds);
  // Flatten to array
  const detailed = Object.values(byOwner).flat();
  // Find the share belonging to our target shocker
  const match = detailed.find(d => Number(d.shockerId) === Number(target.shockerId));
  if (!match?.shareCode) {
    throw new Error("Could not resolve a shareCode for the selected shocker. Ensure a Share Code exists for it.");
  }
  return { shareCode: match.shareCode, shockerId: match.shockerId, shockerName: match.shockerName };
}

async function resolveShareCodeForShared({ userId, apikey, directCode, shareId }) {
  // If the user already has a share *code*, we're done.
  if (directCode) return { shareCode: directCode };

  // If they only have a share *ID*, resolve it into a code via GetShockersByShareIds
  if (shareId) {
    const map = await getShockersByShareIds(userId, apikey, [shareId]);
    console.log(map);
    const arr = Object.values(map).flat();
    const entry = arr.find(e => Number(e.shareId) === Number(shareId));
    if (!entry?.shareCode) {
      throw new Error("Could not resolve Share Code from the provided Share ID.");
    }
    return { shareCode: entry.shareCode, shockerId: entry.shockerId, shockerName: entry.shockerName };
  }

  throw new Error("For MODE=shared, provide PISHOCK_CODE (share code) or PISHOCK_SHAREID (share id).");
}

async function vibrateWithShareCode({ username, apikey, shareCode, controllerName,shocktype, duration, intensity }) {
  // Classic v1 endpoint still sends the command:
  // POST https://do.pishock.com/api/apioperate/  (Op=1)
  const payload = {
    Username: username,
    Name: controllerName,
    Code: shareCode,
    Intensity: String(intensity),
    Duration: String(duration),
    Apikey: apikey,
    Op: String(shocktype), // Vibrate
  };

  const res = await fetch(API_OPERATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${text}`);

  console.log("Server response:", text);
  if (text.includes("Operation Succeeded")) {
    console.log("✅ Vibrate command sent successfully.");
  } else {
    console.log("⚠️ Non-success message. Check share code, device status, or limits.");
  }
}

export async function executePiShock () {
  try {
    // 1) Authenticate to get UserID (no timeout when using apikey path)
    const { userId } = await authenticate(USERNAME, APIKEY);

    // 2) Resolve a shareCode depending on MODE
    let resolved;
   /*  if (MODE === "own") {
      resolved = await resolveShareCodeForOwnDevice({
        userId,
        apikey: APIKEY,
        targetName: TARGET_NAME,
        targetId: TARGET_ID,
      });
      console.log(`Using OWN device "${resolved.shockerName || ""}" via shareCode.`);
    } else if (MODE === "shared") {
      resolved = await resolveShareCodeForShared({
        userId,
        apikey: APIKEY,
        directCode: DIRECT_CODE,
        shareId: SHARE_ID,
      });
      console.log(`Using SHARED device via shareCode.`);
    } else {
      throw new Error(`Unknown PISHOCK_MODE "${MODE}". Use "own" or "shared".`);
    } */

    // 3) Send the vibrate command
    await vibrateWithShareCode({
      username: USERNAME,
      apikey: APIKEY,
      //shareCode: resolved.shareCode,
      shareCode: PISHOCK_CODE,
      controllerName: CONTROLLER_NAME,
      shocktype: ShockType,
      duration: Duration,
      intensity: Intensity,
    });
  } catch (err) {
    console.error("❌ Error:", err?.message || err);
    process.exit(2);
  }
}


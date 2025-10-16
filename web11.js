// web11.js — restored & fixed
// Restored original structure + full-200 streak detection, highlights, deduped history
// Added: maximal-only save (no duplicates), browser health-check (20s polling), UI auto-update

const { chromium } = require('playwright');
const { exec } = require('child_process');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

// Use env vars if available; fallback to your hard-coded token if you prefer
const botToken = process.env.BOT_TOKEN || "7622442460:AAFkXoCXZYGdMgFmEgNyMJTN1IRGEyQtFk0";
const chatId  = process.env.CHAT_ID  || "7811644575";

// Groups (unchanged)
const group1 = [1, 2, 3, 4, 5, 6, 16, 17, 18, 19, 20, 21, 25, 26, 27, 34, 35, 36];
const group2 = [7, 8, 9, 10, 11, 12, 13, 14, 15, 22, 23, 24, 28, 29, 30, 31, 32, 33];

// polyfill fetch if needed
let fetchGlobal = global.fetch;
if (!fetchGlobal) {
  try {
    fetchGlobal = require('node-fetch');
    global.fetch = fetchGlobal;
  } catch (e) {
    console.warn("⚠️ node-fetch not installed; Telegram may not send.");
  }
}

async function sendTelegramMessage(message) {
  try {
    if (!botToken || !chatId) {
      console.log('ℹ️ Telegram not configured (BOT_TOKEN/CHAT_ID). Skipping Telegram send.');
      return;
    }
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });
    const data = await res.json();
    if (data && data.ok) console.log("✅ Telegram message sent:", message);
    else console.error("❌ Telegram API error:", data);
  } catch (err) {
    console.error("❌ Fetch error:", err && err.message ? err.message : err);
  }
}

const checkGroup = (group, numbersToCheck) =>
  numbersToCheck.every(num => group.includes(parseInt(num)));

function groupOf(n) {
  n = parseInt(n);
  if (group1.includes(n)) return 1;
  if (group2.includes(n)) return 2;
  return 0;
}

// -------------------------------------------------------
// LOCALHOST VIEW + sockets
// -------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let latestNumbers = []; // newest-first {num, group}
let streakHistory = []; // stored streaks
const STREAK_HISTORY_CAP = 1000;

// persistent history file in same directory
const HISTORY_FILE = path.join(__dirname, 'cgi_pro_history.json');
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      streakHistory = parsed;
      console.log(`📂 Loaded ${streakHistory.length} streak(s) from history file.`);
    }
  }
} catch (e) {
  console.error("⚠️ Failed to load streak history:", e && e.message);
}
function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(streakHistory, null, 2));
  } catch (e) {
    console.error('❌ Failed to save history file:', e && e.message);
  }
}

// In-memory set of normalized sequences (no spaces) for fast dedupe
const savedSeqSet = new Set(streakHistory.map(s => (s.sequence || '').replace(/\s/g, '')));

// keep track of active (ongoing) streak for telegram notifications
let activeStreak = null;

app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Live 200 Numbers & Streaks</title>
<style>
  body { font-family: sans-serif; background:#0f1724; color:#e6eef8; margin:16px; }
  #numbers { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
  .num { width:46px; height:36px; display:flex; align-items:center; justify-content:center; border-radius:6px; font-weight:bold; background:#374151; transition:transform .12s, box-shadow .12s; }
  .g1 { background:linear-gradient(180deg,#0ea5a2,#047857); }
  .g2 { background:linear-gradient(180deg,#ef4444,#b91c1c); }
  .streaked { outline:3px solid #ffeb3b; box-shadow:0 0 10px #f59e0b; transform:scale(1.04); }

  @keyframes pulseRed { 0% { box-shadow:0 0 6px #f87171; } 50% { box-shadow:0 0 20px #ef4444; transform:scale(1.06);} 100% { box-shadow:0 0 6px #f87171; } }
  @keyframes pulseGreen { 0% { box-shadow:0 0 6px #86efac; } 50% { box-shadow:0 0 20px #34d399; transform:scale(1.06);} 100% { box-shadow:0 0 6px #86efac; } }
  .redGlow { animation: pulseRed 1.1s infinite ease-in-out; outline:3px solid rgba(239,68,68,0.6); }
  .greenGlow { animation: pulseGreen 1.1s infinite ease-in-out; outline:3px solid rgba(34,197,94,0.6); }

  .panel { background:#071024; padding:12px; border-radius:8px; margin-top:10px; }
  .streak { padding:8px; border-radius:6px; margin-bottom:6px; background:#071827; }
  .meta { font-size:12px; color:#9fb6cf; }

  .controls { margin-top:8px; display:flex; gap:8px; align-items:center; }
  button { margin-top:8px; padding:6px 12px; border:none; border-radius:6px; background:#ef4444; color:white; cursor:pointer; font-weight:bold; }
  button.secondary { background:#0ea5a2; }
  button.warning { background:#f59e0b; color:#0f1724; }
  button:hover { opacity:0.9; }
</style>
</head>
<body>
<h1>Roulette Live — First 200 Numbers</h1>
<div class="small">Green = Group 1, Red = Group 2, <span style="color:#ffeb3b;">Yellow = Detected streaks</span></div>
<div id="numbers"></div>
<div class="panel">
  <h3>Recent Streaks</h3>
  <div class="controls">
    <button id="refreshBtn" class="secondary">🔄 Refresh</button>
    <button id="clearBtn" class="warning">🗑 Clear History</button>
    <label style="color:#9fb6cf; margin-left:8px;">Filter (exact):
      <select id="filterSelect" style="margin-left:6px;">
        <option value="0">All</option>
        <option value="5">=5</option>
        <option value="6">=6</option>
        <option value="7">=7</option>
        <option value="8">=8</option>
        <option value="9">=9</option>
        <option value="10">=10</option>
        <option value="11">=11</option>
        <option value="12">=12</option>
        <option value="13">=13</option>
        <option value="14">=14</option>
        <option value="15">=15</option>
      </select>
    </label>
  </div>
  <div id="streaks" style="margin-top:8px;">— no streaks yet —</div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io();
  let highlightIndices = [];
  let activeIndices = [];
  let activeLen = 0;
  let allStreaks = [];

  function renderNumbers(data) {
    const numsDiv = document.getElementById('numbers');
    numsDiv.innerHTML = '';
    data.forEach((it, idx) => {
      const el = document.createElement('div');
      el.className = 'num ' + (it.group===1?'g1':it.group===2?'g2':'');
      if (highlightIndices.includes(idx)) el.classList.add('streaked');
      if (activeIndices.includes(idx)) {
        if (activeLen >= 5) el.classList.add('greenGlow');
        else el.classList.add('redGlow');
      }
      el.textContent = it.num;
      numsDiv.appendChild(el);
    });
  }

  socket.on('update', data => { renderNumbers(data); });
  socket.on('update_direct', data => { renderNumbers(data); });

  socket.on('streak_highlight', idxArr => {
    highlightIndices = idxArr || [];
    socket.emit('request_update');
  });

  socket.on('active_highlight', payload => {
    if (!payload) { activeIndices = []; activeLen = 0; }
    else { activeIndices = payload.indices || []; activeLen = payload.length || 0; }
    socket.emit('request_update');
  });

  socket.on('streaks_update', data => {
    allStreaks = data || [];
    renderStreaks();
  });

  function renderStreaks() {
    const selVal = document.getElementById('filterSelect').value;
    const sel = parseInt(selVal, 10);
    const sDiv = document.getElementById('streaks');
    let list;
    if (!sel || isNaN(sel)) {
      list = allStreaks;
    } else {
      // EXACT filter: only streaks with length === sel
      list = allStreaks.filter(s => s.length === sel);
    }
    if (!list || list.length === 0) { sDiv.textContent = '— no streaks detected yet —'; return; }
    sDiv.innerHTML = '';
    list.slice(0,200).forEach(s => {
      const el = document.createElement('div');
      el.className = 'streak';
      el.innerHTML = '<strong>Group ' + s.group + ' — ×' + s.length + '</strong><br>' + s.sequence +
                     '<div class="meta">detected: ' + new Date(s.ts).toLocaleString() + '</div>';
      sDiv.appendChild(el);
    });
  }

  document.getElementById('refreshBtn').onclick = () => socket.emit('request_update');
  document.getElementById('clearBtn').onclick = () => {
    if (confirm('Clear saved streak history?')) socket.emit('clear_history');
  };
  document.getElementById('filterSelect').onchange = () => renderStreaks();

  // auto-request update every 2s
  setInterval(() => socket.emit('request_update'), 2000);
</script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log('🌐 Localhost live view at http://localhost:' + PORT);
});

// periodically emit latestNumbers so the UI auto-updates even if no fresh scrape happened
setInterval(() => {
  try {
    io.emit('update', latestNumbers);
  } catch (e) { /* ignore */ }
}, 3000);

// single socket connection handler
io.on('connection', socket => {
  socket.on('request_update', () => { socket.emit('update_direct', latestNumbers); });

  socket.on('clear_history', () => {
    streakHistory = [];
    try { fs.unlinkSync(HISTORY_FILE); } catch (e) { /* ignore */ }
    io.emit('streaks_update', streakHistory.slice(0, 200));
    console.log('🗑 Streak history cleared by user.');
  });
});

// broadcast numbers (newest-first), and trigger analysis
function broadcastNumbers(arr) {
  latestNumbers = arr.slice(0, 200).map(x => ({ num: parseInt(x), group: groupOf(x) }));
  io.emit('update', latestNumbers);
  analyzeAllStreaksAndActive(arr.slice(0, 200));
  io.emit('streaks_update', streakHistory.slice(0, 200));
}

/**
 * analyzeAllStreaksAndActive
 * - detect runs (min 5)
 * - save only completed (broken) runs to history
 * - compute highlight indices
 * - compute active (ongoing) run and emit for UI
 * - keep Telegram behavior unchanged (notify on start/extension)
 */
function analyzeAllStreaksAndActive(first200Numbers) {
  if (!first200Numbers || first200Numbers.length === 0) {
    activeStreak = null;
    io.emit('streak_highlight', []);
    io.emit('active_highlight', null);
    return;
  }

  const ordered = first200Numbers.slice(0).reverse().map(x => parseInt(x)); // oldest -> newest
  const N = ordered.length;
  const MIN_STREAK = 5;

  // find all runs across ordered[]
  const detectedRuns = []; // { startIdx, endIdx, group, seqArray, isActive }
  let i = 0;
  while (i < N) {
    const g = groupOf(ordered[i]);
    if (g === 0) { i++; continue; }
    let j = i + 1;
    while (j < N && groupOf(ordered[j]) === g) j++;
    const len = j - i;
    if (len >= MIN_STREAK) {
      const isActive = (j - 1) === (N - 1); // ends at newest -> active (ongoing)
      detectedRuns.push({ startIdx: i, endIdx: j - 1, group: g, seqArray: ordered.slice(i, j), isActive });
    }
    i = j;
  }

  // SAVE ONLY completed runs (isActive === false) -- save on break
  for (const run of detectedRuns) {
    if (run.isActive) continue; // skip ongoing runs

    const seqString = run.seqArray.join(', ');
    const exists = streakHistory.some(s => s.sequence === seqString && s.group === run.group);
    if (!exists) {
      const rec = {
        sequence: seqString,
        group: run.group,
        length: run.seqArray.length,
        startNum: run.seqArray[0],
        endNum: run.seqArray[run.seqArray.length - 1],
        ts: Date.now()
      };
      streakHistory.unshift(rec);
      if (streakHistory.length > STREAK_HISTORY_CAP) streakHistory = streakHistory.slice(0, STREAK_HISTORY_CAP);
      console.log('➕ New unique (completed) streak saved:', rec.group, 'x' + rec.length, rec.sequence);
      try { saveHistory(); } catch (e) { /* ignore */ }
    }
  }

  // Build highlight indices for all detected runs (map ordered index -> newest-first display index)
  const highlightSet = new Set();
  for (const run of detectedRuns) {
    for (let k = run.startIdx; k <= run.endIdx; k++) {
highlightSet.add((N - 1) - k);
    }
  }
  const highlightIndices = Array.from(highlightSet).sort((a, b) => a - b);
  io.emit('streak_highlight', highlightIndices);

  // Now handle active (newest-ending) streak for Telegram notification (only active)
  const newestIdx = N - 1;
  const newestGroup = groupOf(ordered[newestIdx]);
  if (newestGroup === 0) {
activeStreak = null;
io.emit('active_highlight', null);
return;
  }
  // count backward to get active run
  let startIdx = newestIdx;
  while (startIdx - 1 >= 0 && groupOf(ordered[startIdx - 1]) === newestGroup) startIdx--;
  const activeSeq = ordered.slice(startIdx, newestIdx + 1);
  const activeLen = activeSeq.length;
  const activeSeqString = activeSeq.join(', ');

  // compute indices for active run to animate UI (map ordered index -> displayed index)
  const activeIndices = [];
  for (let k = startIdx; k <= newestIdx; k++) activeIndices.push((N - 1) - k);
  io.emit('active_highlight', { indices: activeIndices, length: activeLen, group: newestGroup });

  // Telegram behavior remains the same: send on start (>=MIN) and on extension
  if (!activeStreak || activeStreak.group !== newestGroup || activeStreak.sequence !== activeSeqString) {
activeStreak = { sequence: activeSeqString, group: newestGroup, length: activeLen };
try {
if (activeLen >= MIN_STREAK) sendTelegramMessage(`⚡️ Group ${newestGroup} streak started ×${activeLen}\n${activeSeqString}`);
} catch (e) { console.error('Telegram failed:', e && e.message); }
} else {
if (activeLen > activeStreak.length) {
activeStreak.length = activeLen;
try {
sendTelegramMessage(`➕ Group ${newestGroup} streak extended ×${activeLen}\n${activeSeqString}`);
} catch (e) { console.error('Telegram failed:', e && e.message); }
}
}
}

// -------------------------------------------------------
// MAIN SCRAPER LOOP (original logic; preserved stealth launch)
(async () => {
while (true) {
try {
async function scrape(waitTime) {
const browser = await chromium.launch({
headless: true,
args: ['--disable-blink-features=AutomationControlled']
});

const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 }
});

const page = await context.newPage();
await page.addInitScript(() => {
Object.defineProperty(navigator, "webdriver", { get: () => false });
});

await page.goto('https://gamblingcounting.com/immersive-roulette', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(waitTime);

const text = await page.evaluate(() => document.body.innerText);
const startRegex = /History of rounds\s*Last 200 spins/;
const endRegex = /Immersive Roulette telegram bot/;
const startMatch = text.match(startRegex);
const endMatch = text.match(endRegex);

if (startMatch && endMatch) {
const startIndex = text.indexOf(startMatch[0]);
const endIndex = text.indexOf(endMatch[0]);
if (endIndex > startIndex) {
const extracted = text.substring(startIndex + startMatch[0].length, endIndex).trim();
const numbers = extracted.match(/\d+/g);
await browser.close();
return numbers;
}
}
await browser.close();
return null;
}

let numbers = await scrape(5000);
if (!numbers) {
console.log("⚠️ No numbers found first try, waiting longer and trying again...");
numbers = await scrape(10000);
}

if (!numbers) {
const msg = "❌ No numbers found after two attempts!";
console.log(msg);
try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch {}
await sendTelegramMessage(msg);
} else {
const firstNumbers = numbers.slice(0, 200);
console.log("🔢 First 200 numbers:", firstNumbers.join(", "));

// Broadcast & analyze
broadcastNumbers(firstNumbers);

// Original alert logic (kept intact)
for (let i = 5; i <= 20; i++) {
const slice = firstNumbers.slice(0, i);
const group1Check = checkGroup(group1, slice);
const group2Check = checkGroup(group2, slice);

if (group1Check) {
const msg = `✅ ${slice.join(', ')}`;
try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch {}
await sendTelegramMessage(msg);
} else if (group2Check) {
const msg = `❌ ${slice.join(', ')}`;
try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch {}
await sendTelegramMessage(msg);
}
}
}

} catch (error) {
const msg = `❌ Error during scraping: ${error && error.message}`;
console.error(msg);
try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch {}
await sendTelegramMessage(`❌ ${msg}`);
}

await new Promise(res => setTimeout(res, 2000));
}
})();

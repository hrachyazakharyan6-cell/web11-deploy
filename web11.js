// web11.js — replaced to save only maximal unique completed streaks, avoid duplicates
const { chromium } = require('playwright');
const { exec } = require('child_process');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

// Telegram bot config (env fallback)
const botToken = process.env.BOT_TOKEN || "7622442460:AAFkXoCXZYGdMgFmEgNyMJTN1IRGEyQtFk0";
const chatId = process.env.CHAT_ID || "7811644575";

// Groups
const group1 = [1,2,3,4,5,6,16,17,18,19,20,21,25,26,27,34,35,36];
const group2 = [7,8,9,10,11,12,13,14,15,22,23,24,28,29,30,31,32,33];

let fetchGlobal = global.fetch;
if (!fetchGlobal) {
  try { fetchGlobal = require('node-fetch'); global.fetch = fetchGlobal; } catch (e) { console.warn("node-fetch not installed"); }
}

async function sendTelegramMessage(message){
  try {
    if (!botToken || !chatId) return;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chat_id: chatId, text: message })});
    const data = await res.json().catch(()=>null);
    if (!data || !data.ok) console.error("Telegram send failed", data);
  } catch (e) { console.error("Telegram error:", e && e.message); }
}

const checkGroup = (group, numbersToCheck) => numbersToCheck.every(num => group.includes(parseInt(num)));
function groupOf(n){ n = parseInt(n); if (group1.includes(n)) return 1; if (group2.includes(n)) return 2; return 0; }

// ---- UI + sockets ----
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let latestNumbers = [];
let streakHistory = [];
const STREAK_HISTORY_CAP = 1000;
const HISTORY_FILE = path.join(__dirname, 'cgi_pro_history.json');

try {
  if (fs.existsSync(HISTORY_FILE)) {
    const raw = fs.readFileSync(HISTORY_FILE,'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) streakHistory = parsed;
  }
} catch (e) { console.error("Failed loading history:", e && e.message); }

function saveHistory(){ try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(streakHistory, null, 2)); } catch (e){ console.error("Failed saving history:", e && e.message); } }

// In-memory set of saved sequences (normalized no-spaces) for fast dedupe
const savedSeqSet = new Set(streakHistory.map(s => (s.sequence||'').replace(/\s/g,'')));

let activeStreak = null;

app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Live 200 Numbers</title>
<style>body{font-family:sans-serif;background:#0f1724;color:#e6eef8;margin:16px}#numbers{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}.num{width:46px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;font-weight:bold;background:#374151}.g1{background:linear-gradient(180deg,#0ea5a2,#047857)}.g2{background:linear-gradient(180deg,#ef4444,#b91c1c)}.streaked{outline:3px solid #ffeb3b;box-shadow:0 0 10px #f59e0b;transform:scale(1.04)}.redGlow{animation:pulseRed 1.1s infinite}.greenGlow{animation:pulseGreen 1.1s infinite}@keyframes pulseRed{0%{box-shadow:0 0 6px #f87171}50%{box-shadow:0 0 20px #ef4444;transform:scale(1.06)}100%{box-shadow:0 0 6px #f87171}}@keyframes pulseGreen{0%{box-shadow:0 0 6px #86efac}50%{box-shadow:0 0 20px #34d399;transform:scale(1.06)}100%{box-shadow:0 0 6px #86efac}}</style>
</head><body>
<h1>Roulette Live — First 200 Numbers</h1>
<div id="numbers"></div>
<div><h3>Recent Streaks</h3><div id="streaks">— no streaks yet —</div></div>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
function renderNumbers(data){ const d=document.getElementById('numbers'); d.innerHTML=''; data.forEach((it,idx)=>{ const el=document.createElement('div'); el.className='num '+(it.group===1?'g1':it.group===2?'g2':''); el.textContent=it.num; d.appendChild(el); }); }
socket.on('update', data=>renderNumbers(data));
socket.on('update_direct', data=>renderNumbers(data));
setInterval(()=>socket.emit('request_update'),2000);
</script>
</body></html>`);
});

server.listen(PORT, () => console.log('Server listening on port '+PORT));

// emit regularly so UI auto-refreshes
setInterval(()=>{ try{ io.emit('update', latestNumbers); }catch(e){} },3000);

io.on('connection', socket => {
  socket.on('request_update', ()=> socket.emit('update_direct', latestNumbers));
});

// Broadcast & analysis entry
function broadcastNumbers(arr){
  latestNumbers = arr.slice(0,200).map(x=>({ num: parseInt(x), group: groupOf(x) }));
  io.emit('update', latestNumbers);
  analyzeAllStreaksAndActive(arr.slice(0,200));
  io.emit('streaks_update', streakHistory.slice(0,200));
}

// Helper: check if arrSmall appears consecutively inside arrBig
function isContainedConsecutive(arrSmall, arrBig){
  if (!arrSmall || !arrBig || arrSmall.length>arrBig.length) return false;
  for (let i=0;i<=arrBig.length-arrSmall.length;i++){
    let ok=true;
    for (let j=0;j<arrSmall.length;j++) if (arrBig[i+j] !== arrSmall[j]) { ok=false; break; }
    if (ok) return true;
  }
  return false;
}

// Given detected runs, return only maximal non-overlapping runs (choose longest in overlaps)
function pickMaximalRuns(runs){
  if (!runs || runs.length===0) return [];
  // sort by start
  runs.sort((a,b)=> a.startIdx - b.startIdx || (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx));
  const clusters = [];
  let cur = [runs[0]];
  let curEnd = runs[0].endIdx;
  for (let i=1;i<runs.length;i++){
    const r = runs[i];
    if (r.startIdx <= curEnd){ // overlap -> add to cluster
      cur.push(r);
      curEnd = Math.max(curEnd, r.endIdx);
    } else {
      clusters.push(cur);
      cur = [r];
      curEnd = r.endIdx;
    }
  }
  clusters.push(cur);
  const picked = [];
  for (const c of clusters){
    // pick the run with max length in this cluster (if tie, earliest)
    c.sort((a,b)=> (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx));
    picked.push(c[0]);
  }
  return picked;
}

function analyzeAllStreaksAndActive(first200Numbers){
  if (!first200Numbers || first200Numbers.length===0){
    activeStreak = null;
    io.emit('streak_highlight', []);
    io.emit('active_highlight', null);
    return;
  }
  const ordered = first200Numbers.slice(0).reverse().map(x=>parseInt(x)); // oldest->newest
  const N = ordered.length;
  const MIN_STREAK = 5;

  // detect runs
  const detectedRuns = [];
  let i=0;
  while (i<N){
    const g = groupOf(ordered[i]);
    if (g===0){ i++; continue; }
    let j=i+1;
    while (j<N && groupOf(ordered[j])===g) j++;
    const len = j - i;
    if (len >= MIN_STREAK) {
      const isActive = (j-1) === (N-1);
      detectedRuns.push({ startIdx: i, endIdx: j-1, group: g, seqArray: ordered.slice(i,j), isActive });
    }
    i = j;
  }

  // choose only maximal non-overlapping completed runs to consider saving
  const candidateRuns = pickMaximalRuns(detectedRuns).filter(r => !r.isActive);

  for (const run of candidateRuns){
    // normalized key without spaces
    const key = run.seqArray.join(',');
    // skip if we've already saved exactly this sequence
    if (savedSeqSet.has(key)) continue;

    // ensure we don't save if this run is contained in any previously saved longer run
    let containedInSaved = false;
    for (const s of streakHistory){
      const savedArr = (s.sequence||'').replace(/\s/g,'').split(',').map(n=>parseInt(n));
      if (isContainedConsecutive(run.seqArray, savedArr)) { containedInSaved = true; break; }
    }
    if (containedInSaved) continue;

    // Remove any existing saved streaks that are fully contained in this new run (we prefer maximal)
    streakHistory = streakHistory.filter(s => {
      const savedArr = (s.sequence||'').replace(/\s/g,'').split(',').map(n=>parseInt(n));
      if (isContainedConsecutive(savedArr, run.seqArray)) {
        savedSeqSet.delete(savedArr.join(','));
        return false; // remove it
      }
      return true;
    });

    const rec = {
      sequence: run.seqArray.join(', '),
      group: run.group,
      length: run.seqArray.length,
      startNum: run.seqArray[0],
      endNum: run.seqArray[run.seqArray.length - 1],
      ts: Date.now()
    };
    streakHistory.unshift(rec);
    if (streakHistory.length > STREAK_HISTORY_CAP) streakHistory = streakHistory.slice(0, STREAK_HISTORY_CAP);
    savedSeqSet.add(key);
    console.log('➕ New unique (completed) streak saved:', rec.group, 'x'+rec.length, rec.sequence);
    try { saveHistory(); } catch (e){/*ignore*/}
  }

  // Build highlight indices for all detected runs (including active ones)
  const highlightSet = new Set();
  for (const run of detectedRuns){
    for (let k = run.startIdx; k <= run.endIdx; k++){
      highlightSet.add((N-1)-k);
    }
  }
  const highlightIndices = Array.from(highlightSet).sort((a,b)=>a-b);
  io.emit('streak_highlight', highlightIndices);

  // active streak handling (newest-ending)
  const newestIdx = N-1;
  const newestGroup = groupOf(ordered[newestIdx]);
  if (newestGroup === 0){ activeStreak = null; io.emit('active_highlight', null); return; }
  let startIdx = newestIdx;
  while (startIdx-1 >=0 && groupOf(ordered[startIdx-1])===newestGroup) startIdx--;
  const activeSeq = ordered.slice(startIdx, newestIdx+1);
  const activeLen = activeSeq.length;
  const activeSeqString = activeSeq.join(', ');

  const activeIndices = [];
  for (let k=startIdx;k<=newestIdx;k++) activeIndices.push((N-1)-k);
  io.emit('active_highlight', { indices: activeIndices, length: activeLen, group: newestGroup });

  if (!activeStreak || activeStreak.group !== newestGroup || activeStreak.sequence !== activeSeqString){
    activeStreak = { sequence: activeSeqString, group: newestGroup, length: activeLen };
    try { if (activeLen >= MIN_STREAK) sendTelegramMessage(`⚡️ Group ${newestGroup} streak started ×${activeLen}\n${activeSeqString}`); } catch(e){}
  } else {
    if (activeLen > activeStreak.length){
      activeStreak.length = activeLen;
      try { sendTelegramMessage(`➕ Group ${newestGroup} streak extended ×${activeLen}\n${activeSeqString}`); } catch(e){}
    }
  }
}

// MAIN SCRAPER LOOP (improved retries & fallbacks)
(async ()=>{
  while(true){
    try{
      async function scrapeAttempt(waitTime){
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
        const context = await browser.newContext({
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          viewport: { width:1280, height:800 }
        });
        const page = await context.newPage();
        await page.addInitScript(()=>{ Object.defineProperty(navigator,'webdriver',{get:()=>false}); });
        await page.goto('https://gamblingcounting.com/immersive-roulette', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(waitTime);
        // 1) simple body text parse
        const text = await page.evaluate(()=>document.body.innerText || '');
        const startRegex = /History of rounds\\s*Last 200 spins/i;
        const endRegex = /Immersive Roulette telegram bot/i;
        const startMatch = text.match(startRegex);
        const endMatch = text.match(endRegex);
        if (startMatch && endMatch){
          const startIndex = text.indexOf(startMatch[0]);
          const endIndex = text.indexOf(endMatch[0]);
          if (endIndex > startIndex){
            const extracted = text.substring(startIndex + startMatch[0].length, endIndex).trim();
            const numbers = extracted.match(/\\b([0-9]|[1-2][0-9]|3[0-6])\\b/g);
            await browser.close();
            return numbers;
          }
        }
        // 2) selector fallbacks
        try {
          const selectors = ['.history','#history','.spin-history','.spins','table','tbody','.rounds','.history-table'];
          for (const sel of selectors){
            const found = await page.$$eval(sel, nodes => nodes.map(n=>n.innerText).join(' '));
            if (found && found.length > 10){
              const nums = found.match(/\\b([0-9]|[1-2][0-9]|3[0-6])\\b/g);
              if (nums && nums.length>0){ await browser.close(); return nums; }
            }
          }
        } catch(e){}
        // 3) brute text node scan
        const allText = await page.evaluate(()=>{ function getText(node){ if(!node) return ''; if(node.nodeType===Node.TEXT_NODE) return node.textContent||''; let out=''; node.childNodes.forEach(n=>out += ' ' + getText(n)); return out;} return getText(document.body).replace(/\\s+/g,' ');});
        const nums = (allText && allText.match(/\\b([0-9]|[1-2][0-9]|3[0-6])\\b/g)) || null;
        await browser.close();
        return nums;
      }

      let numbers = await scrapeAttempt(5000);
      if (!numbers || numbers.length===0){ numbers = await scrapeAttempt(10000); }
      if (!numbers || numbers.length===0){ numbers = await scrapeAttempt(15000); }

      if (!numbers || numbers.length===0){
        const msg = "❌ No numbers found after attempts!";
        console.log(msg);
        io.emit('update', latestNumbers);
        try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch(e){}
        await sendTelegramMessage(msg);
      } else {
        const firstNumbers = numbers.slice(0,200);
        console.log("🔢 First 200 numbers:", firstNumbers.join(", "));
        broadcastNumbers(firstNumbers);
        for (let i=5;i<=20;i++){
          const slice = firstNumbers.slice(0,i);
          if (checkGroup(group1,slice)){ const msg = `✅ ${slice.join(', ')}`; try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch(e){} await sendTelegramMessage(msg); }
          else if (checkGroup(group2,slice)){ const msg = `❌ ${slice.join(', ')}`; try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch(e){} await sendTelegramMessage(msg); }
        }
      }
    } catch (error){
      const msg = `❌ Error during scraping: ${error && error.message}`;
      console.error(msg);
      io.emit('update', latestNumbers);
      try { exec(`termux-notification --title "Roulette Alert" --content "${msg}"`); } catch(e){}
      await sendTelegramMessage(msg);
    }
    await new Promise(res => setTimeout(res,2000));
  }
})();

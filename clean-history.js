/**
 * clean-history.js
 * - watches cgi_pro_history.json (same dir)
 * - every 1s: loads file, removes duplicates & contained smaller streaks
 * - keeps only the maximal (longest) streak for overlapping sequences per group
 * - atomic write back to file only if changes were made
 *
 * Usage: node clean-history.js
 * Set environment variable CLEAN_HISTORY_PATH to point to a different file.
 */

const fs = require('fs');
const path = require('path');

const HISTORY_FILE = process.env.CLEAN_HISTORY_PATH || path.join(__dirname, 'cgi_pro_history.json');
const INTERVAL_MS = 1000; // check every 1s

function log(...args) { console.log(new Date().toISOString(), ...args); }

// helper: parse item.sequence "1, 2, 3" -> [1,2,3]
function seqToArray(seq) {
  if (!seq) return [];
  return seq.toString().split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
}

// returns true if a is contained consecutively inside b
function isContainedConsecutive(a, b) {
  if (!a.length || !b.length || a.length > b.length) return false;
  for (let s = 0; s <= b.length - a.length; s++) {
    let ok = true;
    for (let t = 0; t < a.length; t++) {
      if (a[t] !== b[s + t]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function cleanHistoryArray(items) {
  // Items expected: { sequence: "1, 2, 3", group: 1, length: n, ts: ... }
  // Defensive copy
  const arr = (items || []).map(it => {
    const seqArr = seqToArray(it.sequence);
    return Object.assign({}, it, { seqArr, _orig: it });
  });

  // Sort by group, then by descending length — so longer items processed first
  arr.sort((a,b) => {
    if ((a.group || 0) !== (b.group || 0)) return (a.group||0) - (b.group||0);
    return (b.seqArr.length - a.seqArr.length) || ( (a.ts||0) - (b.ts||0) );
  });

  const kept = [];
  const removedIdx = new Set();

  for (let i = 0; i < arr.length; i++) {
    if (removedIdx.has(i)) continue;
    const a = arr[i];
    // skip if empty
    if (!a.seqArr || a.seqArr.length === 0) { removedIdx.add(i); continue; }

    // Keep 'a'
    kept.push(a);

    // Remove any later item in same group that is fully contained in a.seqArr
    for (let j = i + 1; j < arr.length; j++) {
      if (removedIdx.has(j)) continue;
      const b = arr[j];
      if ((b.group || 0) !== (a.group || 0)) continue; // different group
      if (!b.seqArr || b.seqArr.length === 0) { removedIdx.add(j); continue; }
      if (isContainedConsecutive(b.seqArr, a.seqArr)) {
        removedIdx.add(j);
      }
    }
  }

  // produce cleaned array as original objects (kept._orig)
  return kept.map(k => k._orig);
}

function tryLoadJSON(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function atomicWriteJSON(file, obj) {
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// run once
function runOnce() {
  const data = tryLoadJSON(HISTORY_FILE);
  if (!Array.isArray(data)) {
    // nothing to do
    return false;
  }
  const cleaned = cleanHistoryArray(data);
  // quick equality check by lengths and sequences
  if (cleaned.length === data.length) {
    // extra check if sequences differ
    let same = true;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i].sequence !== data[i].sequence || (cleaned[i].group !== data[i].group)) { same = false; break; }
    }
    if (same) return false;
  }
  // Save cleaned; keep newest-first semantics as originally (we preserved order by group/length but that's OK)
  try {
    atomicWriteJSON(HISTORY_FILE, cleaned);
    log(`Cleaned history: ${data.length} -> ${cleaned.length} entries`);
    return true;
  } catch (err) {
    log('Error writing cleaned history:', err && err.message ? err.message : err);
    return false;
  }
}

// Loop every second, but perform quick sleeps if file doesn't exist
log('clean-history.js starting; file=', HISTORY_FILE);
setInterval(() => {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      // nothing to do
      return;
    }
    runOnce();
  } catch (err) {
    log('Unexpected error in cleaner loop:', err && err.message ? err.message : err);
  }
}, INTERVAL_MS);

// allow running once and exit: node clean-history.js --once
if (process.argv.includes('--once')) {
  setTimeout(() => {
    const changed = runOnce();
    process.exit(changed ? 0 : 0);
  }, 50);
}

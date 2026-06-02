import fs from 'node:fs';
import { config } from './config.js';
import { createInitialState } from './gameEngine.js';

let state = null;
let saveTimer = null;

function ensureStateDir() {
  try {
    fs.mkdirSync(config.paths.stateDir, { recursive: true });
  } catch { /* ignore */ }
}

/** Load snapshot from disk if present and compatible, else create fresh state. */
export function initState(teams, order) {
  ensureStateDir();
  let restored = null;
  try {
    if (fs.existsSync(config.paths.snapshot)) {
      const raw = JSON.parse(fs.readFileSync(config.paths.snapshot, 'utf8'));
      // Only restore if the team set still matches (avoids stale-team crashes).
      const sameTeams = teams.every((t) => raw.teams && raw.teams[t.id]);
      if (sameTeams && Array.isArray(raw.order)) {
        restored = raw;
      }
    }
  } catch (e) {
    console.warn('[stateStore] snapshot unreadable, starting fresh:', e.message);
  }

  if (restored) {
    state = restored;
    // Re-sync question order from disk file in case content changed; keep scores/phase.
    state.order = order;
    // Connections never survive a restart — everyone re-joins.
    for (const id of Object.keys(state.teams)) state.teams[id].connected = false;
    console.log('[stateStore] restored snapshot at version', state.version);
  } else {
    state = createInitialState(teams, order);
    console.log('[stateStore] fresh game state created');
  }
  return state;
}

export function getState() {
  return state;
}

/** Bump version and schedule a debounced snapshot write. Call after every mutation. */
export function commit() {
  state.version += 1;
  scheduleSave();
  return state.version;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 250);
}

export function saveNow() {
  try {
    ensureStateDir();
    fs.writeFileSync(config.paths.snapshot, JSON.stringify(state));
  } catch (e) {
    console.warn('[stateStore] snapshot save failed:', e.message);
  }
}

/** Replace entire state (used by host Import / restore). */
export function replaceState(next) {
  state = next;
  commit();
  return state;
}

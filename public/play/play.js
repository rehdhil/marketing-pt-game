import { el, clientId, initAudio, beep } from '/shared/util.js';

const socket = io({ transports: ['websocket', 'polling'] });
const app = document.getElementById('app');
const reconnectBar = document.getElementById('reconnect');

let teams = [];
let myTeamId = localStorage.getItem('ptg_team') || null;
let last = null;            // last state:sync
let pendingBuzz = false;    // optimistic local lock
let wakeLock = null;

const myTeam = () => teams.find((t) => t.id === myTeamId) || (last && last.teams.find((t) => t.id === myTeamId));

async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

// ---- connection ----
socket.on('connect', () => {
  reconnectBar.classList.add('hidden');
  if (myTeamId) socket.emit('captain:join', { teamId: myTeamId, clientId: clientId() });
});
socket.on('disconnect', () => reconnectBar.classList.remove('hidden'));

socket.on('state:sync', (s) => {
  const wasQ = last && last.question && last.question.id;
  last = s;
  // new question clears any optimistic lock
  if (!s.question || s.question.id !== wasQ) pendingBuzz = false;
  if (s.phase === 'BUZZERS_OPEN' || s.phase === 'STEAL_OPEN') { /* keep pending until ack */ }
  render();
});

socket.on('buzz:ack', ({ youWon }) => {
  pendingBuzz = false; // resolved by server
  render();
});

socket.on('pulse', ({ type }) => {
  if (type === 'open') { beep('open'); navigator.vibrate?.(60); }
});

socket.on('error:notice', ({ message }) => { /* silent for captains */ });

// ---- team picker ----
async function loadTeams() {
  try { teams = await (await fetch('/api/teams')).json(); } catch { teams = []; }
}

function renderPicker() {
  app.innerHTML = '';
  const wrap = el('div', { class: 'picker' });
  wrap.append(el('h1', { class: 'display' }, '🎮 Marketing PT Game'));
  wrap.append(el('p', {}, 'Captain — pick your Power Team:'));
  for (const t of teams) {
    const b = el('button', { class: 'team-btn', onclick: () => chooseTeam(t.id) });
    const sw = el('span', { class: 'swatch' }); sw.style.background = t.color;
    b.append(sw, `${t.emoji || ''} ${t.name}`);
    wrap.append(b);
  }
  app.append(wrap);
}

function chooseTeam(id) {
  initAudio();
  keepAwake();
  myTeamId = id;
  localStorage.setItem('ptg_team', id);
  socket.emit('captain:join', { teamId: id, clientId: clientId() });
}

// ---- buzzer screen ----
function doBuzz() {
  if (!last || pendingBuzz) return;
  const open = last.phase === 'BUZZERS_OPEN' || last.phase === 'STEAL_OPEN';
  if (!open) return;
  if (last.q && last.q.openAt && Date.now() < last.q.openAt) return;
  if (last.q && last.q.eliminated.includes(myTeamId)) return;
  pendingBuzz = true;
  navigator.vibrate?.(120);
  beep('buzz');
  socket.emit('captain:buzz', { questionId: last.question?.id, teamId: myTeamId }, () => {});
  render();
}

let countdownTimer = null;
function render() {
  if (!myTeamId) { renderPicker(); return; }
  const t = myTeam();
  if (!last) { app.innerHTML = '<div class="buzz-wrap"><div class="status dim">Connecting…</div></div>'; return; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  const team = (last.teams || []).find((x) => x.id === myTeamId) || t || {};
  app.innerHTML = '';

  // header
  const head = el('div', { class: 'play-head' });
  const tag = el('div', { class: 'team-tag' });
  const sw = el('span', { class: 'swatch' }); sw.style.background = team.color || '#888';
  tag.append(sw, `${team.emoji || ''} ${team.name || 'Team'}`);
  head.append(tag, el('div', { class: 'score-tag' }, `${team.score ?? 0} pts`));
  app.append(head);

  const wrap = el('div', { class: 'buzz-wrap' });
  const phase = last.phase;
  const eliminated = last.q && last.q.eliminated.includes(myTeamId);
  const iWon = last.q && last.q.winnerTeam === myTeamId;
  const teamColor = team.color || '#ff4d8d';

  const mkBuzzer = (live) => {
    const b = el('button', { class: 'buzzer' + (live ? ' live' : ''), onclick: doBuzz });
    b.style.setProperty('--team', teamColor);
    b.textContent = live ? 'BUZZ!' : (pendingBuzz ? '…' : 'BUZZ');
    b.disabled = !live;
    return b;
  };

  if (phase === 'LOBBY') {
    wrap.append(el('div', { class: 'status dim' }, 'You\'re in! Waiting for the game to start…'), mkBuzzer(false));
  } else if (phase === 'BUZZERS_ARMED') {
    const cd = el('div', { class: 'countdown' }, '…');
    wrap.append(el('div', { class: 'status' }, 'Get ready!'), cd);
    const tick = () => {
      const ms = (last.q?.openAt || 0) - Date.now();
      cd.textContent = ms > 0 ? Math.ceil(ms / 1000) : 'GO!';
      if (ms <= 0 && countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    };
    tick(); countdownTimer = setInterval(tick, 100);
  } else if (phase === 'BUZZERS_OPEN' || phase === 'STEAL_OPEN') {
    if (eliminated) {
      wrap.append(el('div', { class: 'status dim' }, 'You\'re out this question 🙈'), mkBuzzer(false));
    } else if (pendingBuzz) {
      wrap.append(el('div', { class: 'status' }, 'Buzzing…'), mkBuzzer(false));
    } else {
      wrap.append(el('div', { class: 'status' }, phase === 'STEAL_OPEN' ? 'STEAL — buzz now!' : 'BUZZ NOW!'), mkBuzzer(true));
    }
  } else if (phase === 'BUZZERS_LOCKED') {
    if (iWon) {
      wrap.append(el('div', { class: 'banner win' }, '🎤 You buzzed first — ANSWER!'), mkBuzzer(false));
    } else {
      const w = (last.teams || []).find((x) => x.id === last.q?.winnerTeam);
      wrap.append(el('div', { class: 'banner lose' }, `${w ? w.name : 'Another team'} buzzed first`), mkBuzzer(false));
    }
  } else if (phase === 'ANSWER_JUDGED') {
    const judged = last.q?.judged;
    if (judged === 'correct') {
      const who = last.q?.awardedTo;
      wrap.append(el('div', { class: 'banner ' + (who === myTeamId ? 'correct' : 'lose') }, who === myTeamId ? '✅ Correct! Points to you!' : 'Answer revealed'), mkBuzzer(false));
    } else {
      wrap.append(el('div', { class: 'banner lose' }, 'Next up…'), mkBuzzer(false));
    }
  } else if (phase === 'GAME_OVER') {
    const won = last.winnerTeam === myTeamId;
    wrap.append(el('div', { class: 'banner ' + (won ? 'win' : 'lose') }, won ? '🏆 YOUR TEAM WON!' : 'Game over — thanks for playing!'));
  } else {
    wrap.append(el('div', { class: 'status dim' }, 'Waiting for the host…'), mkBuzzer(false));
  }

  app.append(wrap);
}

// boot
loadTeams().then(() => { if (!myTeamId) renderPicker(); else app.innerHTML = '<div class="buzz-wrap"><div class="status dim">Connecting…</div></div>'; });

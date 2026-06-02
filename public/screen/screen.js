import { qs, el, initAudio, beep, confettiBurst } from '/shared/util.js';

const key = qs('key') || '';
const socket = io({ transports: ['websocket', 'polling'] });
const stage = document.getElementById('stage');
const soundBtn = document.getElementById('soundBtn');
let state = null;
let soundOn = false;
let lastRevealId = null;
let lastWinPulse = false;

soundBtn.onclick = () => { initAudio(); soundOn = true; soundBtn.classList.add('hidden'); };

socket.on('connect', () => socket.emit('screen:join', { key }));
socket.on('state:sync', (s) => { state = s; render(); });
socket.on('pulse', ({ type, teamId }) => {
  if (!soundOn) return;
  if (type === 'buzz') beep('buzz');
  else if (type === 'correct') beep('correct');
  else if (type === 'wrong') beep('wrong');
  else if (type === 'open') beep('open');
  else if (type === 'win') beep('win');
});

function teamById(id) { return state.teams.find((t) => t.id === id); }
function logoUrl(file) { return file ? `/assets/logos/${file}` : null; }

function titleBar() {
  const bar = el('div', { class: 'title-bar' });
  bar.append(el('div', { class: 'logo display' }, '🎮 Marketing PT Game'));
  if (state.question && state.phase !== 'GAME_OVER') bar.append(el('div', { class: 'round' }, `${state.question.roundTitle} · Q ${state.question.index + 1}/${state.question.total}`));
  return bar;
}

function render() {
  if (!state) return;
  stage.innerHTML = '';

  if (state.phase === 'LOBBY') { renderLobby(); return; }
  if (state.phase === 'GAME_OVER') { renderWinner(); return; }

  stage.append(titleBar());

  // Only reveal the answer when resolved (correct, or host gave up = 'none').
  // A WRONG judgment keeps the answer hidden so the steal is still a real contest.
  const judgedWrong = state.phase === 'ANSWER_JUDGED' && state.q && state.q.judged === 'wrong';
  if (state.phase === 'ANSWER_JUDGED' && !judgedWrong) { renderReveal(); return; }

  // question + buzz states (+ wrong-answer steal hold)
  const area = el('div', { class: 'q-area' });
  const q = state.question;

  if (state.phase === 'BUZZERS_ARMED') {
    const cd = el('div', { class: 'countdown-big' }, '…');
    area.append(el('div', { class: 'q-status' }, 'Get ready to buzz!'), cd);
    const tick = () => {
      const ms = (state.q?.openAt || 0) - Date.now();
      cd.textContent = ms > 0 ? Math.ceil(ms / 1000) : 'GO!';
    };
    tick(); clearInterval(window._cd); window._cd = setInterval(tick, 100);
  } else {
    clearInterval(window._cd);
    const clues = el('div', { class: 'clues' });
    (q.clues || []).forEach((c) => clues.append(el('div', { class: 'clue-line' }, c)));
    area.append(clues);

    if (state.phase === 'BUZZERS_OPEN' || state.phase === 'STEAL_OPEN') {
      area.append(el('div', { class: 'q-status live' }, state.phase === 'STEAL_OPEN' ? '🔁 STEAL — BUZZ NOW!' : '🔔 BUZZ NOW!'));
      area.append(lampsRow());
    } else if (state.phase === 'BUZZERS_LOCKED') {
      const w = teamById(state.q.winnerTeam);
      const flash = el('div', { class: 'buzz-flash' }, `${w?.emoji || ''} ${w ? w.name : ''} buzzed first!`);
      flash.style.background = (w?.color || '#444');
      area.append(flash);
    } else if (judgedWrong) {
      const allOut = state.q.eliminated.length >= state.teams.length;
      area.append(el('div', { class: 'q-status' }, allOut ? '❌ Wrong! No teams left — host will reveal.' : '❌ Wrong! Steal is open to the other teams 👀'));
      area.append(lampsRow());
    } else {
      area.append(el('div', { class: 'q-status' }, 'Read the clues…'));
    }
  }
  stage.append(area);
}

function lampsRow() {
  const row = el('div', { class: 'lamps' });
  for (const t of state.teams) {
    const out = state.q?.eliminated.includes(t.id);
    const lamp = el('div', { class: 'lamp ' + (out ? 'out' : 'active') }, `${t.emoji || ''} ${t.name}`);
    lamp.style.background = out ? 'transparent' : t.color;
    row.append(lamp);
  }
  return row;
}

function renderReveal() {
  const q = state.question;
  const judged = state.q?.judged;
  const wrap = el('div', { class: 'reveal' });

  if (judged === 'correct') {
    const who = teamById(state.q.awardedTo);
    wrap.append(el('div', { class: 'verdict correct' }, `✅ ${who ? who.name : ''} +${state.q.awardedPoints} pts`));
  } else {
    // 'none' — nobody got it / host revealed
    wrap.append(el('div', { class: 'verdict wrong' }, 'Nobody got it — the answer was…'));
  }

  const lw = el('div', { class: 'logo-wrap' });
  const url = logoUrl(q.logo);
  if (url) {
    const img = el('img', { src: url, alt: q.businessName, onerror: () => { img.style.display = 'none'; lw.append(el('div', { class: 'biz' }, q.businessName)); } });
    lw.append(img);
  } else {
    lw.append(el('div', { class: 'biz' }, q.businessName));
  }
  wrap.append(lw);
  wrap.append(el('div', { class: 'biz' }, q.businessName));
  if (q.category) wrap.append(el('div', { class: 'cat' }, q.category));
  wrap.append(el('div', { class: 'member' }, `— ${q.memberName}`));
  stage.append(wrap);

  // celebrate once per reveal
  if (judged === 'correct' && lastRevealId !== q.id + ':' + state.version) {
    lastRevealId = q.id + ':' + state.version;
    const who = teamById(state.q.awardedTo);
    confettiBurst(who?.color || '#ffd23f', 90);
  }
  // mini bar race under reveal
  stage.append(barRace(false));
}

function barRace(showHeading = true) {
  const wrap = el('div', { class: 'race' });
  if (showHeading) wrap.append(el('h2', {}, '🏁 Scoreboard'));
  const max = Math.max(100, ...state.teams.map((t) => t.score));
  const bars = el('div', { class: 'bars' });
  // already ranked desc by server
  for (const t of state.teams) {
    const row = el('div', { class: 'bar-row' });
    const lbl = el('div', { class: 'blabel' });
    const sw = el('span', { class: 'swatch' }); sw.style.background = t.color;
    lbl.append(sw, `${t.emoji || ''} ${t.name}`);
    const track = el('div', { class: 'bar-track' });
    const fill = el('div', { class: 'bar-fill' }, String(t.score));
    fill.style.width = Math.max(6, (t.score / max) * 100) + '%';
    fill.style.background = t.color;
    track.append(fill);
    row.append(lbl, track);
    bars.append(row);
  }
  wrap.append(bars);
  return wrap;
}

function renderLobby() {
  const lobby = el('div', { class: 'lobby' });
  const left = el('div', { class: 'left' });
  left.append(el('h1', { class: 'display', html: 'Guess the<br>Marketing Member\'s<br>Business!' }));
  left.append(el('p', {}, 'Captains — scan to grab your buzzer 👉'));
  lobby.append(left);

  const playUrl = location.origin + '/play';
  const card = el('div', { class: 'qr-card' });
  card.append(el('img', { src: '/qr?data=' + encodeURIComponent(playUrl), alt: 'Scan to join' }));
  card.append(el('div', { class: 'cap' }, 'SCAN TO PLAY'));
  card.append(el('div', { class: 'url' }, playUrl.replace(/^https?:\/\//, '')));
  lobby.append(card);

  const badges = el('div', { class: 'team-badges' });
  for (const t of state.teams) {
    const b = el('div', { class: 'badge ' + (t.connected ? 'on' : '') });
    const d = el('span', { class: 'bdot' });
    b.style.borderColor = t.connected ? t.color : 'rgba(255,255,255,.2)';
    b.append(d, `${t.emoji || ''} ${t.name}`);
    badges.append(b);
  }
  lobby.append(badges);
  stage.append(titleBar(), lobby);
}

function renderWinner() {
  const w = teamById(state.winnerTeam);
  const wrap = el('div', { class: 'winner' });
  wrap.append(el('div', { class: 'crown' }, '🏆'));
  wrap.append(el('div', { class: 'wname', html: `${w?.emoji || ''} ${w ? w.name : 'Winner'}` }));
  wrap.append(el('div', { class: 'prize' }, 'wins the MEGA PRIZE! 🎁'));
  const st = el('div', { class: 'standings' });
  state.teams.forEach((t, i) => st.append(el('div', { class: 's-row' }, `${i + 1}. ${t.name} — ${t.score} pts`)));
  wrap.append(st);
  stage.append(wrap);
  if (!lastWinPulse) { lastWinPulse = true; confettiBurst(w?.color || '#ffd23f', 220); if (soundOn) beep('win'); }
  if (state.phase !== 'GAME_OVER') lastWinPulse = false;
}

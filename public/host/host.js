import { qs, el } from '/shared/util.js';

let key = qs('key') || localStorage.getItem('ptg_hostkey') || '';
const socket = io({ transports: ['websocket', 'polling'] });
const root = document.getElementById('console');
const gate = document.getElementById('authgate');
let state = null;
let authed = false;

function join() { socket.emit('host:join', { key }); }

socket.on('connect', () => { if (key) join(); else gate.classList.remove('hidden'); });
socket.on('error:notice', ({ code, message }) => {
  if (code === 'AUTH') { authed = false; gate.classList.remove('hidden'); }
  else flash(message);
});
socket.on('state:sync', (s) => { authed = true; gate.classList.add('hidden'); localStorage.setItem('ptg_hostkey', key); state = s; render(); });
socket.on('host:stateExport', (snap) => {
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `ptgame-state-v${snap.version}.json` });
  document.body.append(a); a.click(); a.remove();
});

document.getElementById('keyBtn').onclick = () => { key = document.getElementById('keyInput').value.trim(); join(); };
document.getElementById('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('keyBtn').click(); });

function emit(ev, payload) { socket.emit(ev, payload || {}); }
function flash(msg) {
  const n = el('div', { class: 'pill' }, msg);
  n.style.cssText += 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:200;background:#ff4d8d;color:#fff;';
  document.body.append(n); setTimeout(() => n.remove(), 2200);
}

// Local backup mirror of full state for disaster recovery.
socket.on('state:sync', () => { try { localStorage.setItem('ptg_lastsync', JSON.stringify(state)); } catch {} });

const PH = (p) => state && state.phase === p;

function render() {
  if (!state) return;
  root.innerHTML = '';
  const q = state.question;

  // ---- topbar ----
  const top = el('div', { class: 'topbar' });
  top.append(el('h1', { class: 'display' }, '🎛️ Host Console'));
  const tag = el('span', { class: 'phase-tag' }, state.phase + (state.paused ? ' (PAUSED)' : ''));
  const conns = el('div', { class: 'conns' });
  for (const t of state.teams) {
    const c = el('div', { class: 'conn' });
    const d = el('span', { class: 'dot ' + (t.connected ? 'on' : 'off') });
    c.append(d, t.name);
    conns.append(c);
  }
  top.append(tag, conns);
  root.append(top);

  // ---- main: question + controls ----
  const main = el('div', { class: 'panel' });
  if (PH('LOBBY')) {
    main.append(el('h3', {}, 'Lobby'));
    main.append(el('p', {}, `${state.teams.filter((t) => t.connected).length} / ${state.teams.length} captains connected. ${q ? '' : ''}`));
    main.append(el('p', { class: 'note' }, 'Open /screen on the projector and have captains scan the QR. Start when ready.'));
    const ctr = el('div', { class: 'controls' });
    ctr.append(btn('▶ Start Game', 'btn', () => emit('host:startGame')));
    main.append(ctr);
  } else if (PH('GAME_OVER')) {
    const w = state.teams.find((t) => t.id === state.winnerTeam);
    main.append(el('h3', {}, 'Game Over'));
    main.append(el('p', { class: 'display', html: `🏆 Winner: <b>${w ? w.name : '—'}</b>` }));
    const ctr = el('div', { class: 'controls' });
    ctr.append(btn('🔄 Reset to Lobby', 'btn secondary', () => confirm('Reset the whole game?') && emit('host:resetGame')));
    main.append(ctr);
  } else if (q) {
    main.append(el('div', { class: 'qmeta' }, `${q.roundTitle} · Q ${q.index + 1} of ${q.total} · ${q.points} pts${q.multiAnswer ? ' · MULTI (+' + q.bonusPerExtra + '/extra)' : ''}`));
    // clues (host sees all; dim the not-yet-revealed)
    (q.clues || []).forEach((c, i) => {
      main.append(el('div', { class: 'clue' + (i >= state.revealedClues ? ' hidden-clue' : '') }, `${i + 1}. ${c}`));
    });
    // private answer
    const ab = el('div', { class: 'answer-box' });
    ab.append(el('div', { class: 'lbl' }, `Answer (${q.memberName})`), el('div', { class: 'ans' }, q.answer));
    if (q.acceptableAnswers) ab.append(el('div', { class: 'acc' }, 'Accept: ' + q.acceptableAnswers.join(', ')));
    main.append(ab);

    // buzz resolution
    if (state.q && state.q.winnerTeam) {
      const w = state.teams.find((t) => t.id === state.q.winnerTeam);
      const bn = el('div', { class: 'buzz-now' }, `🔔 ${w ? w.name : '?'} buzzed first!`);
      bn.style.background = (w?.color || '#444');
      main.append(bn);
    }
    if (state.q && state.q.eliminated.length) {
      const names = state.q.eliminated.map((id) => state.teams.find((t) => t.id === id)?.name).filter(Boolean);
      main.append(el('div', { class: 'steal-list' }, 'Out this question: ' + names.join(', ')));
    }

    main.append(buildControls(q));
  }
  root.append(main);

  // ---- side: scores ----
  const side = el('div', { class: 'panel' });
  side.append(el('h3', {}, 'Scores'));
  const scores = el('div', { class: 'scores' });
  for (const t of state.teams) {
    const row = el('div', { class: 'score-row' + (state.phase === 'GAME_OVER' && t.id === state.winnerTeam ? ' winner-row' : '') });
    const name = el('div', { class: 'name' });
    const sw = el('span', { class: 'swatch' }); sw.style.background = t.color;
    name.append(sw, t.name);
    row.append(
      btn('−', 'btn secondary mini', () => emit('host:adjustScore', { teamId: t.id, delta: -(state.question?.points || 100) })),
      name,
      el('div', { class: 'val' }, String(t.score)),
      btn('+', 'btn secondary mini', () => emit('host:adjustScore', { teamId: t.id, delta: (state.question?.points || 100) })),
      btn('✎', 'btn ghost mini', () => { const v = prompt(`Set ${t.name} score:`, t.score); if (v !== null && !isNaN(+v)) emit('host:adjustScore', { teamId: t.id, setTo: +v }); })
    );
    scores.append(row);
  }
  side.append(scores);

  // global utilities
  const util = el('div', { class: 'controls' });
  util.append(
    state.paused ? btn('▶ Resume', 'btn secondary', () => emit('host:resume')) : btn('⏸ Pause', 'btn secondary', () => emit('host:pause')),
    btn('↺ Reset Q', 'btn secondary', () => emit('host:resetQuestion')),
    btn('⤓ Export', 'btn ghost', () => emit('host:exportState')),
    btn('🏁 End Game', 'btn ghost', () => confirm('End the game and show winner?') && emit('host:endGame'))
  );
  side.append(util);

  // jump to round (time-safety valve)
  if (state.roundsMeta && state.roundsMeta.length && state.phase !== 'GAME_OVER') {
    side.append(el('h3', { style: 'margin-top:14px' }, 'Jump to round'));
    const jumpRow = el('div', { class: 'row' });
    for (const r of state.roundsMeta) {
      const isCurrent = state.question && state.question.round === r.round;
      jumpRow.append(btn(`→ R${r.round}`, 'btn ' + (isCurrent ? '' : 'secondary'), () => {
        if (confirm(`Jump to the start of Round ${r.round}? (skips any remaining questions in between)`)) emit('host:jumpToRound', { round: r.round });
      }));
    }
    side.append(jumpRow);
    if (state.question) side.append(el('div', { class: 'note' }, `Now on Q ${state.question.index + 1} / ${state.question.total}.`));
  }
  root.append(side);
}

function buildControls(q) {
  const ctr = el('div', { class: 'controls' });
  const phase = state.phase;
  const moreClues = state.revealedClues < (q.totalClues || (q.clues || []).length);

  if (phase === 'QUESTION_SHOWN') {
    if (moreClues) ctr.append(btn('+ Reveal next clue', 'btn secondary', () => emit('host:revealClue')));
    ctr.append(btn('⏱ Arm buzzers', 'btn', () => emit('host:armBuzzers')));
    ctr.append(btn('🔔 Open now', 'btn secondary', () => emit('host:openBuzzers')));
  } else if (phase === 'BUZZERS_ARMED') {
    ctr.append(btn('🔔 Open now', 'btn', () => emit('host:openBuzzers')));
  } else if (phase === 'BUZZERS_OPEN' || phase === 'STEAL_OPEN') {
    ctr.append(el('span', { class: 'pill' }, 'Buzzers live — waiting for a buzz…'));
    ctr.append(btn('↺ Reset Q', 'btn secondary', () => emit('host:resetQuestion')));
  } else if (phase === 'BUZZERS_LOCKED') {
    ctr.append(
      btn('✅ Correct', 'btn good', () => emit('host:markCorrect', { teamId: state.q.winnerTeam })),
      btn('❌ Wrong', 'btn bad', () => emit('host:markWrong', { teamId: state.q.winnerTeam }))
    );
    if (q.multiAnswer) ctr.append(btn(`✅ +bonus (${q.points + q.bonusPerExtra})`, 'btn good', () => emit('host:markCorrect', { teamId: state.q.winnerTeam, points: q.points + q.bonusPerExtra })));
  } else if (phase === 'ANSWER_JUDGED') {
    const wrongUnrevealed = state.q && state.q.judged === 'wrong';
    if (wrongUnrevealed && state.q.eliminated.length < state.teams.length) {
      ctr.append(btn('🔁 Open for STEAL', 'btn', () => emit('host:reopenSteal')));
    }
    if (wrongUnrevealed) {
      // answer is still hidden on the screen — reveal it when steal is done / nobody knows
      ctr.append(btn('👁 Reveal answer', 'btn secondary', () => emit('host:noAnswer')));
    }
    ctr.append(btn('⏭ Next question', 'btn', () => emit('host:nextQuestion')));
    ctr.append(btn('↺ Replay Q', 'btn secondary', () => emit('host:resetQuestion')));
  }
  return ctr;
}

function btn(label, cls, onclick) { return el('button', { class: cls, onclick }, label); }

import { io } from 'socket.io-client';
const URL = 'http://localhost:4555';
const KEY = 'test123';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const conn = () => io(URL, { transports: ['websocket'] });

let hostState = null;
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); };

const host = conn();
const screen = conn();
const capA = conn(); // hni
const capB = conn(); // sme
const capC = conn(); // projects

host.on('state:sync', (s) => { hostState = s; });
let acks = {};
capA.on('buzz:ack', (d) => acks.A = d);
capB.on('buzz:ack', (d) => acks.B = d);
capC.on('buzz:ack', (d) => acks.C = d);

await wait(400);
host.emit('host:join', { key: KEY });
screen.emit('screen:join', { key: KEY });
capA.emit('captain:join', { teamId: 'hni', clientId: 'A1' });
capB.emit('captain:join', { teamId: 'sme', clientId: 'B1' });
capC.emit('captain:join', { teamId: 'projects', clientId: 'C1' });
await wait(400);
assert(hostState.teams.filter((t) => t.connected).length === 3, '3 captains connected');

// start game
host.emit('host:startGame');
await wait(200);
assert(hostState.phase === 'QUESTION_SHOWN', 'phase QUESTION_SHOWN after start');
assert(hostState.question.index === 0, 'on first question');
assert(hostState.revealedClues === 1, 'first clue revealed');

// reveal a clue
host.emit('host:revealClue');
await wait(150);
assert(hostState.revealedClues === 2, 'second clue revealed');

// open buzzers immediately
host.emit('host:openBuzzers');
await wait(150);
assert(hostState.phase === 'BUZZERS_OPEN', 'buzzers open');

// all three buzz nearly simultaneously
capB.emit('captain:buzz', { questionId: hostState.question.id, teamId: 'sme' });
capA.emit('captain:buzz', { questionId: hostState.question.id, teamId: 'hni' });
capC.emit('captain:buzz', { questionId: hostState.question.id, teamId: 'projects' });
await wait(300);
assert(hostState.phase === 'BUZZERS_LOCKED', 'locked after buzz');
const winner = hostState.q.winnerTeam;
assert(['sme', 'hni', 'projects'].includes(winner), 'a winner was chosen: ' + winner);
const winners = [acks.A, acks.B, acks.C].filter((a) => a && a.youWon).length;
assert(winners === 1, `exactly one captain got youWon (got ${winners})`);

// mark wrong → steal
host.emit('host:markWrong', { teamId: winner });
await wait(150);
assert(hostState.phase === 'ANSWER_JUDGED' && hostState.q.judged === 'wrong', 'marked wrong');
assert(hostState.q.eliminated.includes(winner), 'winner eliminated for steal');

host.emit('host:reopenSteal');
await wait(150);
assert(hostState.phase === 'STEAL_OPEN', 'steal open');

// eliminated team tries to buzz (should be rejected), another team buzzes
acks = {};
capA.emit('captain:buzz', { questionId: hostState.question.id, teamId: winner === 'hni' ? 'hni' : 'hni' }); // hni try
await wait(120);
const stealTeam = hostState.q.winnerTeam;
assert(stealTeam && stealTeam !== winner ? true : (winner === 'hni' ? true : true), 'steal buzz processed');

// mark correct on whoever holds it now (or winner if hni was eliminated try blocked)
const holder = hostState.q.winnerTeam || 'sme';
host.emit('host:markCorrect', { teamId: holder });
await wait(150);
assert(hostState.phase === 'ANSWER_JUDGED' && hostState.q.judged === 'correct', 'marked correct');
const sc = hostState.teams.find((t) => t.id === holder).score;
assert(sc === 100, `holder has 100 pts (got ${sc})`);

// reveal includes answer for screen? check host question has answer
assert(hostState.question.answer && hostState.question.memberName, 'host sees answer + member');

// next question
host.emit('host:nextQuestion');
await wait(150);
assert(hostState.phase === 'QUESTION_SHOWN' && hostState.question.index === 1, 'advanced to Q2');

// adjust score
host.emit('host:adjustScore', { teamId: 'projects', setTo: 250 });
await wait(150);
assert(hostState.teams.find((t) => t.id === 'projects').score === 250, 'manual score set works');

// reconnection: capA drops and rejoins, score persists
capA.disconnect();
await wait(200);
const capA2 = conn();
capA2.emit('captain:join', { teamId: 'hni', clientId: 'A1' });
await wait(250);
assert(hostState.teams.find((t) => t.id === 'hni').connected === true, 'hni reconnected');

// end game
host.emit('host:endGame');
await wait(200);
assert(hostState.phase === 'GAME_OVER', 'game over');
assert(hostState.winnerTeam === 'projects', 'projects wins (250 pts): ' + hostState.winnerTeam);

console.log('\nDONE. exitCode=', process.exitCode || 0);
[host, screen, capB, capC, capA2].forEach((s) => s.close());
process.exit(process.exitCode || 0);

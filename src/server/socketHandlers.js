import { config } from './config.js';
import * as engine from './gameEngine.js';
import { getState, commit, saveNow, replaceState } from './stateStore.js';

const { PHASES } = engine;

export function registerHandlers(io, byId, order = []) {
  let armTimer = null;

  // Round boundaries (first question id per round) — for host "jump to round".
  const roundsMeta = [];
  const seenRounds = new Set();
  for (const id of order) {
    const q = byId[id];
    if (q && !seenRounds.has(q.round)) {
      seenRounds.add(q.round);
      roundsMeta.push({ round: q.round, title: q.roundTitle, firstQuestionId: id });
    }
  }

  // ---- payload builders (role-aware) ----
  function buildQuestion(state, role) {
    const q = engine.currentQuestion(state, byId);
    if (!q) return null;
    const base = {
      id: q.id,
      round: q.round,
      roundTitle: q.roundTitle,
      roundSubtitle: q.roundSubtitle,
      type: q.type,
      points: q.points,
      multiAnswer: !!q.multiAnswer,
      bonusPerExtra: q.bonusPerExtra || 0,
      totalClues: (q.clues || []).length,
      index: state.currentIndex,
      total: state.order.length,
    };
    const revealing = state.phase === PHASES.ANSWER_JUDGED;
    if (role === 'host') {
      return {
        ...base,
        clues: q.clues,
        revealedClues: state.revealedClues,
        answer: q.answer,
        acceptableAnswers: q.acceptableAnswers,
        memberName: q.memberName,
        businessName: q.businessName,
        category: q.category,
        logo: q.logo,
        revealed: true,
      };
    }
    // screen / play: only clues revealed so far; answer hidden until judged
    return {
      ...base,
      clues: (q.clues || []).slice(0, state.revealedClues),
      revealedClues: state.revealedClues,
      revealed: revealing,
      ...(revealing
        ? {
            answer: q.answer,
            memberName: q.memberName,
            businessName: q.businessName,
            category: q.category,
            logo: q.logo,
          }
        : {}),
    };
  }

  function syncPayload(state, role) {
    return {
      version: state.version,
      phase: state.phase,
      paused: state.paused,
      testMode: state.testMode,
      revealedClues: state.revealedClues,
      ...(role === 'host' ? { roundsMeta } : {}),
      teams: engine.rankedTeams(state),
      question: buildQuestion(state, role),
      q: state.q
        ? {
            winnerTeam: state.q.winnerTeam,
            eliminated: state.q.eliminated,
            stealQueue: state.q.stealQueue,
            openAt: state.q.openAt,
            judged: state.q.judged,
            awardedTo: state.q.awardedTo,
            awardedPoints: state.q.awardedPoints,
          }
        : null,
      winnerTeam: state.winnerTeam,
      countdownMs: config.countdownMs,
    };
  }

  function syncAll() {
    const state = getState();
    io.to('host').emit('state:sync', syncPayload(state, 'host'));
    io.to('screen').emit('state:sync', syncPayload(state, 'screen'));
    io.to('players').emit('state:sync', syncPayload(state, 'play'));
  }

  function pulse(type, data = {}) {
    io.emit('pulse', { type, ...data });
  }

  // After a host action: commit (version + snapshot) then broadcast.
  function commitAndSync() {
    commit();
    syncAll();
  }

  io.on('connection', (socket) => {
    // ---------- joins ----------
    socket.on('host:join', ({ key } = {}) => {
      if (key !== config.hostKey) return socket.emit('error:notice', { code: 'AUTH', message: 'Bad host key' });
      socket.data.role = 'host';
      socket.join('host');
      socket.emit('state:sync', syncPayload(getState(), 'host'));
    });

    socket.on('screen:join', ({ key } = {}) => {
      if (key !== config.hostKey) return socket.emit('error:notice', { code: 'AUTH', message: 'Bad key' });
      socket.data.role = 'screen';
      socket.join('screen');
      socket.emit('state:sync', syncPayload(getState(), 'screen'));
    });

    socket.on('captain:join', ({ teamId, clientId, name } = {}) => {
      const state = getState();
      if (!state.teams[teamId]) return socket.emit('error:notice', { code: 'TEAM', message: 'Unknown team' });
      socket.data.role = 'play';
      socket.data.teamId = teamId;
      socket.data.clientId = clientId;
      socket.join('players');
      const team = state.teams[teamId];
      team.connected = true;
      team.clientId = clientId;
      if (name) team.captainName = name;
      commit();
      socket.emit('state:sync', syncPayload(state, 'play'));
      io.to('host').emit('state:sync', syncPayload(state, 'host'));
      io.to('screen').emit('state:sync', syncPayload(state, 'screen'));
    });

    // ---------- captain buzz ----------
    socket.on('captain:buzz', ({ questionId, teamId } = {}, ack) => {
      const state = getState();
      const tid = teamId || socket.data.teamId;
      const current = engine.currentQuestion(state, byId);
      if (!current || (questionId && questionId !== current.id)) {
        if (typeof ack === 'function') ack({ received: true, stale: true });
        return;
      }
      const res = engine.buzz(state, tid);
      if (typeof ack === 'function') ack({ received: true, won: res.won, error: res.error });
      socket.emit('buzz:ack', { questionId: current.id, youWon: !!res.won, error: res.error });
      if (res.ok) {
        pulse('buzz', { teamId: tid });
        commitAndSync();
      }
    });

    // ---------- host controls ----------
    const hostOnly = (fn) => (payload) => {
      if (socket.data.role !== 'host') return socket.emit('error:notice', { code: 'AUTH', message: 'Host only' });
      fn(payload || {});
    };

    socket.on('host:startGame', hostOnly(() => {
      engine.startGame(getState(), byId);
      commitAndSync();
    }));

    socket.on('host:revealClue', hostOnly(() => {
      engine.revealClue(getState(), byId);
      commitAndSync();
    }));

    socket.on('host:armBuzzers', hostOnly(() => {
      const state = getState();
      const r = engine.armBuzzers(state, config.countdownMs);
      if (!r.ok) return socket.emit('error:notice', { code: 'PHASE', message: r.error });
      commitAndSync();
      const openAt = state.q.openAt;
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        const s = getState();
        if (s.phase === PHASES.BUZZERS_ARMED) {
          engine.openBuzzers(s);
          pulse('open');
          commitAndSync();
        }
      }, Math.max(0, openAt - Date.now()));
    }));

    socket.on('host:openBuzzers', hostOnly(() => {
      const r = engine.openBuzzers(getState());
      if (!r.ok) return socket.emit('error:notice', { code: 'PHASE', message: r.error });
      pulse('open');
      commitAndSync();
    }));

    socket.on('host:reopenSteal', hostOnly(() => {
      engine.reopenSteal(getState());
      pulse('open');
      commitAndSync();
    }));

    socket.on('host:markCorrect', hostOnly(({ teamId, points }) => {
      const state = getState();
      const tid = teamId || state.q?.winnerTeam;
      const r = engine.markCorrect(state, byId, tid, points);
      if (!r.ok) return socket.emit('error:notice', { code: 'JUDGE', message: r.error });
      pulse('correct', { teamId: tid });
      commitAndSync();
    }));

    socket.on('host:markWrong', hostOnly(({ teamId }) => {
      const state = getState();
      const tid = teamId || state.q?.winnerTeam;
      const r = engine.markWrong(state, tid);
      if (!r.ok) return socket.emit('error:notice', { code: 'JUDGE', message: r.error });
      pulse('wrong', { teamId: tid });
      commitAndSync();
    }));

    socket.on('host:noAnswer', hostOnly(() => {
      engine.noAnswer(getState());
      commitAndSync();
    }));

    socket.on('host:adjustScore', hostOnly(({ teamId, delta, setTo }) => {
      engine.adjustScore(getState(), teamId, { delta, setTo });
      commitAndSync();
    }));

    socket.on('host:nextQuestion', hostOnly(() => {
      const state = getState();
      const wasOver = state.phase === PHASES.GAME_OVER;
      engine.nextQuestion(state, byId);
      if (!wasOver && state.phase === PHASES.GAME_OVER) pulse('win', { teamId: state.winnerTeam });
      commitAndSync();
    }));

    socket.on('host:jumpToQuestion', hostOnly(({ questionId }) => {
      engine.jumpToQuestionId(getState(), byId, questionId);
      commitAndSync();
    }));

    socket.on('host:jumpToRound', hostOnly(({ round }) => {
      const meta = roundsMeta.find((r) => r.round === round);
      if (meta) engine.jumpToQuestionId(getState(), byId, meta.firstQuestionId);
      commitAndSync();
    }));

    socket.on('host:resetQuestion', hostOnly(() => {
      engine.resetQuestion(getState(), byId);
      commitAndSync();
    }));

    socket.on('host:pause', hostOnly(() => { engine.setPaused(getState(), true); commitAndSync(); }));
    socket.on('host:resume', hostOnly(() => { engine.setPaused(getState(), false); commitAndSync(); }));

    socket.on('host:endGame', hostOnly(() => {
      engine.endGame(getState());
      pulse('win', { teamId: getState().winnerTeam });
      commitAndSync();
    }));

    socket.on('host:resetGame', hostOnly(() => {
      engine.resetGame(getState());
      commitAndSync();
    }));

    // Host durable backup: export current full state / import a saved one.
    socket.on('host:exportState', hostOnly(() => {
      socket.emit('host:stateExport', getState());
    }));
    socket.on('host:importState', hostOnly(({ snapshot }) => {
      if (snapshot && snapshot.teams && Array.isArray(snapshot.order)) {
        replaceState(snapshot);
        saveNow();
        syncAll();
      }
    }));

    // ---------- disconnect ----------
    socket.on('disconnect', () => {
      if (socket.data.role === 'play' && socket.data.teamId) {
        const state = getState();
        const team = state.teams[socket.data.teamId];
        // Only mark offline if this socket is still the active client for the team.
        if (team && team.clientId === socket.data.clientId) {
          team.connected = false;
          commit();
          io.to('host').emit('state:sync', syncPayload(state, 'host'));
          io.to('screen').emit('state:sync', syncPayload(state, 'screen'));
        }
      }
    });
  });
}

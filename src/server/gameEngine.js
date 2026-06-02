// Pure-ish game logic. Functions mutate the passed-in `state` object in place
// (single server instance owns the only copy) and return { ok, error? } so the
// caller can decide whether to broadcast. Version bump + snapshot happen in the store.

export const PHASES = {
  LOBBY: 'LOBBY',
  QUESTION_SHOWN: 'QUESTION_SHOWN',
  BUZZERS_ARMED: 'BUZZERS_ARMED',
  BUZZERS_OPEN: 'BUZZERS_OPEN',
  BUZZERS_LOCKED: 'BUZZERS_LOCKED',
  ANSWER_JUDGED: 'ANSWER_JUDGED',
  STEAL_OPEN: 'STEAL_OPEN',
  GAME_OVER: 'GAME_OVER',
};

const ok = () => ({ ok: true });
const err = (error) => ({ ok: false, error });

/** Flatten the questions file into an ordered list + lookup map. */
export function buildQuestionIndex(questionsData) {
  const order = [];
  const byId = {};
  for (const round of questionsData.rounds || []) {
    for (const q of round.questions || []) {
      order.push(q.id);
      byId[q.id] = {
        ...q,
        roundTitle: round.title,
        roundSubtitle: round.subtitle,
      };
    }
  }
  return { order, byId };
}

export function createInitialState(teams, order) {
  const teamMap = {};
  for (const t of teams) {
    teamMap[t.id] = { ...t, score: 0, connected: false, clientId: null };
  }
  return {
    version: 0,
    phase: PHASES.LOBBY,
    paused: false,
    testMode: false,
    teams: teamMap,
    order: [...order],
    currentIndex: -1,
    revealedClues: 0,
    q: null,
    eventLog: [],
    winnerTeam: null,
    startedAt: null,
    endedAt: null,
  };
}

function newQuestionContext(questionId) {
  return {
    questionId,
    winnerTeam: null,
    stealQueue: [],
    eliminated: [],
    openAt: null,
    judged: null, // 'correct' | 'wrong' | 'none'
    awardedTo: null,
    awardedPoints: 0,
  };
}

export function currentQuestion(state, byId) {
  if (state.currentIndex < 0 || state.currentIndex >= state.order.length) return null;
  return byId[state.order[state.currentIndex]] || null;
}

export function startGame(state, byId) {
  if (!state.order.length) return err('No questions loaded');
  state.startedAt = state.startedAt || Date.now();
  return showQuestionAt(state, byId, 0);
}

export function showQuestionAt(state, byId, index) {
  if (index < 0) return err('Invalid question index');
  if (index >= state.order.length) return endGame(state);
  state.currentIndex = index;
  state.q = newQuestionContext(state.order[index]);
  state.revealedClues = 1; // first clue shown immediately
  state.phase = PHASES.QUESTION_SHOWN;
  return ok();
}

export function nextQuestion(state, byId) {
  return showQuestionAt(state, byId, state.currentIndex + 1);
}

export function jumpToQuestionId(state, byId, questionId) {
  const idx = state.order.indexOf(questionId);
  if (idx < 0) return err('Unknown question');
  return showQuestionAt(state, byId, idx);
}

export function revealClue(state, byId) {
  const q = currentQuestion(state, byId);
  if (!q) return err('No active question');
  const total = (q.clues || []).length;
  if (state.revealedClues < total) state.revealedClues += 1;
  return ok();
}

export function armBuzzers(state, countdownMs) {
  if (![PHASES.QUESTION_SHOWN, PHASES.STEAL_OPEN, PHASES.ANSWER_JUDGED].includes(state.phase)) {
    return err(`Cannot arm from ${state.phase}`);
  }
  state.q.openAt = Date.now() + countdownMs;
  state.phase = PHASES.BUZZERS_ARMED;
  return ok();
}

export function openBuzzers(state) {
  if (![PHASES.BUZZERS_ARMED, PHASES.QUESTION_SHOWN, PHASES.ANSWER_JUDGED].includes(state.phase)) {
    return err(`Cannot open from ${state.phase}`);
  }
  state.q.openAt = Date.now();
  state.q.winnerTeam = null;
  state.phase = PHASES.BUZZERS_OPEN;
  return ok();
}

export function reopenSteal(state) {
  if (!state.q) return err('No active question');
  state.q.winnerTeam = null;
  state.q.openAt = Date.now();
  state.q.judged = null;
  state.phase = PHASES.STEAL_OPEN;
  return ok();
}

/** A captain pressed their buzzer. Returns { ok, won, error }. */
export function buzz(state, teamId) {
  if (state.paused) return err('Game paused');
  if (![PHASES.BUZZERS_OPEN, PHASES.STEAL_OPEN].includes(state.phase)) {
    return { ok: false, won: false, error: 'Buzzers not open' };
  }
  if (state.q.openAt && Date.now() < state.q.openAt) {
    return { ok: false, won: false, error: 'Too early' };
  }
  if (!state.teams[teamId]) return { ok: false, won: false, error: 'Unknown team' };
  if (state.q.eliminated.includes(teamId)) {
    return { ok: false, won: false, error: 'Already out this question' };
  }
  if (state.q.stealQueue.includes(teamId)) {
    return { ok: false, won: false, error: 'Already buzzed' };
  }
  // First press to reach this single-threaded handler wins.
  state.q.stealQueue.push(teamId);
  state.q.winnerTeam = teamId;
  state.phase = PHASES.BUZZERS_LOCKED;
  return { ok: true, won: true };
}

export function markCorrect(state, byId, teamId, pointsOverride) {
  const team = state.teams[teamId];
  if (!team) return err('Unknown team');
  const q = currentQuestion(state, byId);
  const points = Number.isFinite(pointsOverride) ? pointsOverride : (q?.points || 0);
  team.score += points;
  state.q.judged = 'correct';
  state.q.awardedTo = teamId;
  state.q.awardedPoints = points;
  state.phase = PHASES.ANSWER_JUDGED;
  state.eventLog.push({ questionId: state.q.questionId, teamId, correct: true, delta: points, ts: Date.now() });
  return ok();
}

export function markWrong(state, teamId) {
  if (!state.teams[teamId]) return err('Unknown team');
  if (!state.q.eliminated.includes(teamId)) state.q.eliminated.push(teamId);
  state.q.judged = 'wrong';
  state.q.winnerTeam = null;
  state.phase = PHASES.ANSWER_JUDGED;
  state.eventLog.push({ questionId: state.q.questionId, teamId, correct: false, delta: 0, ts: Date.now() });
  return ok();
}

export function noAnswer(state) {
  if (!state.q) return err('No active question');
  state.q.judged = 'none';
  state.q.winnerTeam = null;
  state.phase = PHASES.ANSWER_JUDGED;
  return ok();
}

export function adjustScore(state, teamId, { delta, setTo }) {
  const team = state.teams[teamId];
  if (!team) return err('Unknown team');
  if (Number.isFinite(setTo)) team.score = setTo;
  else if (Number.isFinite(delta)) team.score += delta;
  return ok();
}

export function setPaused(state, paused) {
  state.paused = !!paused;
  return ok();
}

export function resetQuestion(state, byId) {
  if (!state.q) return err('No active question');
  // Revert any points awarded for this question before clearing.
  if (state.q.judged === 'correct' && state.q.awardedTo && state.teams[state.q.awardedTo]) {
    state.teams[state.q.awardedTo].score -= state.q.awardedPoints;
  }
  state.q = newQuestionContext(state.order[state.currentIndex]);
  state.revealedClues = 1;
  state.phase = PHASES.QUESTION_SHOWN;
  return ok();
}

export function endGame(state) {
  let winner = null;
  let best = -Infinity;
  for (const id of Object.keys(state.teams)) {
    if (state.teams[id].score > best) {
      best = state.teams[id].score;
      winner = id;
    }
  }
  state.winnerTeam = winner;
  state.endedAt = Date.now();
  state.phase = PHASES.GAME_OVER;
  return ok();
}

export function resetGame(state) {
  for (const id of Object.keys(state.teams)) state.teams[id].score = 0;
  state.phase = PHASES.LOBBY;
  state.currentIndex = -1;
  state.revealedClues = 0;
  state.q = null;
  state.eventLog = [];
  state.winnerTeam = null;
  state.startedAt = null;
  state.endedAt = null;
  state.paused = false;
  return ok();
}

/** Ranked team list (desc by score) for the bar-race graph. */
export function rankedTeams(state) {
  return Object.values(state.teams)
    .map((t) => ({ id: t.id, name: t.name, color: t.color, emoji: t.emoji, score: t.score, connected: t.connected }))
    .sort((a, b) => b.score - a.score);
}

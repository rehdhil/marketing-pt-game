import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '../..');

export const config = {
  port: Number(process.env.PORT) || 3000,
  // Shared secret to open /host and /screen. Override in prod via env.
  hostKey: process.env.HOST_KEY || 'marketing2026',
  // Buzzer arming countdown (ms) before buzzers go live.
  countdownMs: Number(process.env.COUNTDOWN_MS) || 3000,
  // Points awarded for a correct answer (host can override per-question).
  defaultPoints: Number(process.env.DEFAULT_POINTS) || 100,
  paths: {
    public: path.join(ROOT, 'public'),
    data: path.join(ROOT, 'data'),
    teams: path.join(ROOT, 'data', 'teams.json'),
    questions: path.join(ROOT, 'data', 'questions.json'),
    stateDir: path.join(ROOT, 'state'),
    snapshot: path.join(ROOT, 'state', 'snapshot.json'),
  },
};

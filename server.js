const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

const ADMIN_API_PATHS = new Set([
  '/api/round',
  '/api/round-status',
  '/api/round-target',
  '/api/guesses',
  '/api/delete-guess',
  '/api/reset',
]);

function isLocalRequest(req) {
  const address = req.socket && req.socket.remoteAddress;
  return address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1';
}

function publicRound(round) {
  return {
    id: round.id,
    name: round.name,
    isOpen: round.isOpen,
  };
}

function requireLocalAdmin(req, res, next) {
  if (isLocalRequest(req)) return next();
  return res.status(403).json({
    error: 'Admin access is only available from this Mac.',
  });
}

app.use(express.json());
app.use((req, res, next) => {
  if (req.path === '/admin.html' || req.path === '/admin copy.html') {
    if (!isLocalRequest(req)) {
      return res.status(403).send('Admin page is only available from this Mac.');
    }
  }
  next();
});
app.use((req, res, next) => {
  if (ADMIN_API_PATHS.has(req.path)) {
    return requireLocalAdmin(req, res, next);
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------
// PERSISTENCE
// ------------------------------
const DATA_FILE = path.join(__dirname, 'quiz-state.json');

// rounds: { id, name, isOpen, target: {lat, lng} | null }
const rounds = [];

// guesses[roundId] = { teamName: { lat, lng, ts, deviceId } }
const guesses = {};

function saveState() {
  const payload = { rounds, guesses };
  fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), err => {
    if (err) {
      console.error('Failed to save state:', err);
    }
  });
}

function loadState() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('No existing quiz-state.json, starting fresh.');
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed.rounds)) {
      rounds.length = 0;
      parsed.rounds.forEach(r => rounds.push(r));
    }
    if (parsed.guesses && typeof parsed.guesses === 'object') {
      Object.keys(parsed.guesses).forEach(k => {
        guesses[k] = parsed.guesses[k];
      });
    }
    console.log('Loaded state from quiz-state.json');
  } catch (e) {
    console.error('Failed to load state, starting fresh:', e);
  }
}

// ------------------------------
// STATE HELPERS
// ------------------------------
function createRound(name, isOpen = false) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const round = {
    id,
    name,
    isOpen,
    target: null,
  };
  rounds.push(round);
  return round;
}

function resetState() {
  rounds.length = 0;
  for (const k of Object.keys(guesses)) {
    delete guesses[k];
  }
  const r = createRound("Test Round", true);
  saveState();
  console.log('State reset. Created default round:', r);
}

// ------------------------------
// INITIAL LOAD
// ------------------------------
loadState();
if (rounds.length === 0) {
  console.log('No rounds found after load, creating default Test Round.');
  resetState();
}

// ------------------------------
// API ENDPOINTS
// ------------------------------

// List rounds
app.get('/api/rounds', (req, res) => {
  res.json(isLocalRequest(req) ? rounds : rounds.map(publicRound));
});

// Create round
app.post('/api/round', (req, res) => {
  const { name } = req.body || {};
  const round = createRound(name || `Round ${rounds.length + 1}`, false);
  saveState();
  console.log("Created round:", round);
  res.json(round);
});

// Toggle open/closed
app.post('/api/round-status', (req, res) => {
  const { id, isOpen } = req.body || {};
  const round = rounds.find(r => r.id === id);
  if (!round) return res.status(404).json({ error: "Round not found" });

  round.isOpen = isOpen;
  saveState();
  console.log(`Round ${round.name} is now ${isOpen ? "OPEN" : "CLOSED"}`);
  res.json(round);
});

// Set target for a round
app.post('/api/round-target', (req, res) => {
  const { id, lat, lng } = req.body || {};
  const round = rounds.find(r => r.id === id);
  if (!round) return res.status(404).json({ error: "Round not found" });

  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng must be numbers" });
  }

  round.target = { lat, lng };
  saveState();
  console.log("Set target for", round.name, round.target);
  res.json(round);
});

// Get guesses for a round
app.get('/api/guesses', (req, res) => {
  const { roundId } = req.query;
  res.json(guesses[roundId] || {});
});

// Submit guess
app.post('/api/guess', (req, res) => {
  const { roundId, teamName, lat, lng, deviceId } = req.body || {};

  if (!roundId || !teamName || typeof lat !== "number" || typeof lng !== "number" || !deviceId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const round = rounds.find(r => r.id === roundId);
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (!round.isOpen) return res.status(400).json({ error: "Round closed" });

  if (!guesses[roundId]) guesses[roundId] = {};

  // One device can only play as one team in a given round
  for (const [team, g] of Object.entries(guesses[roundId])) {
    if (g.deviceId === deviceId && team !== teamName) {
      return res.status(400).json({
        error: `This device already submitted as "${team}" in this round.`,
      });
    }
  }

  guesses[roundId][teamName] = {
    lat,
    lng,
    ts: Date.now(),
    deviceId,
  };

  saveState();
  console.log("Guess:", roundId, teamName, lat, lng);
  res.json({ ok: true });
});

// Get all guesses for THIS device (for all rounds)
app.get('/api/my-guesses', (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId query parameter required" });
  }

  const result = [];

  for (const round of rounds) {
    const roundGuesses = guesses[round.id] || {};
    for (const [teamName, g] of Object.entries(roundGuesses)) {
      if (g.deviceId === deviceId) {
        result.push({
          roundId: round.id,
          roundName: round.name,
          teamName,
          lat: g.lat,
          lng: g.lng,
          ts: g.ts,
        });
      }
    }
  }

  res.json(result);
});

// Delete a guess (admin)
app.post('/api/delete-guess', (req, res) => {
  const { roundId, teamName } = req.body || {};
  if (!roundId || !teamName) {
    return res.status(400).json({ error: "roundId and teamName are required" });
  }

  const round = rounds.find(r => r.id === roundId);
  if (!round) return res.status(404).json({ error: "Round not found" });

  const roundGuesses = guesses[roundId];
  if (!roundGuesses || !roundGuesses[teamName]) {
    return res.status(404).json({ error: "Guess not found for this team in this round" });
  }

  delete roundGuesses[teamName];
  if (Object.keys(roundGuesses).length === 0) {
    delete guesses[roundId];
  }

  saveState();
  console.log(`Deleted guess for team "${teamName}" in round "${round.name}"`);
  res.json({ ok: true });
});

// Reset everything (admin)
app.post('/api/reset', (req, res) => {
  console.log('Received RESET request – clearing all rounds & guesses.');
  resetState();
  res.json({ ok: true });
});

// ------------------------------
// START SERVER
// ------------------------------
app.listen(PORT, () => {
  console.log(`Mariki Pub Quizz server running at http://localhost:${PORT}`);
});

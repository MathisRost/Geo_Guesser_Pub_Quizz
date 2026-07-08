const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------
// STATE
// ------------------------------

// rounds: { id, name, isOpen, target: {lat, lng} | null }
const rounds = [];

// guesses[roundId] = { teamName: { lat, lng, ts, deviceId } }
const guesses = {};

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

// Default round visible immediately
createRound("Test Round", true);

// ------------------------------
// API ENDPOINTS
// ------------------------------

// List rounds
app.get('/api/rounds', (req, res) => {
  res.json(rounds);
});

// Create round
app.post('/api/round', (req, res) => {
  const { name } = req.body || {};
  const round = createRound(name || `Round ${rounds.length + 1}`, false);
  console.log("Created round:", round);
  res.json(round);
});

// Toggle open/closed
app.post('/api/round-status', (req, res) => {
  const { id, isOpen } = req.body || {};
  const round = rounds.find(r => r.id === id);
  if (!round) return res.status(404).json({ error: "Round not found" });

  round.isOpen = isOpen;
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
// body: { roundId, teamName }
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
  // If no guesses left for that round, we could optionally delete the object:
  if (Object.keys(roundGuesses).length === 0) {
    delete guesses[roundId];
  }

  console.log(`Deleted guess for team "${teamName}" in round "${round.name}"`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Mariki Pub Quizz server running at http://localhost:${PORT}`);
});

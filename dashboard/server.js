const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3456;

const PIPE_DIR = path.join(__dirname, '..', 'var', 'pipe');
const STATE_DIR = path.join(__dirname, '..', 'state');
const ARCHIVE_DIR = path.join(__dirname, '..', 'var', 'archive');

app.use(express.static(__dirname));

function getTaskIds() {
  if (!fs.existsSync(PIPE_DIR)) return [];
  return fs.readdirSync(PIPE_DIR).filter(id => {
    return fs.statSync(path.join(PIPE_DIR, id)).isDirectory();
  });
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function getTaskCost(taskId) {
  const costFile = path.join(ARCHIVE_DIR, `cost-${taskId}.json`);
  const data = readJsonSafe(costFile);
  return data ? data.totalCost : 0;
}

function getTaskSummary(taskId) {
  const stateFile = path.join(STATE_DIR, `${taskId}.json`);
  const state = readJsonSafe(stateFile);
  const metaFile = path.join(PIPE_DIR, taskId, '.meta');
  const meta = readJsonSafe(metaFile);

  if (!state) return null;

  const totalDuration = state.phaseHistory
    ? state.phaseHistory.reduce((sum, ph) => sum + (ph.duration || 0), 0)
    : 0;

  return {
    id: taskId,
    type: meta ? meta.type || 'unknown' : 'unknown',
    status: state.currentPhase === 'completed' ? 'success' :
            state.currentPhase === 'failed' ? 'failed' : 'running',
    currentPhase: state.currentPhase,
    duration: totalDuration,
    cost: getTaskCost(taskId),
    createdAt: meta ? meta.createdAt : null
  };
}

app.get('/api/tasks', (req, res) => {
  const taskIds = getTaskIds();
  const tasks = taskIds
    .map(id => getTaskSummary(id))
    .filter(t => t !== null)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(tasks);
});

app.get('/api/phases', (req, res) => {
  const taskIds = getTaskIds();
  const phaseStats = {};

  taskIds.forEach(id => {
    const stateFile = path.join(STATE_DIR, `${id}.json`);
    const state = readJsonSafe(stateFile);
    if (!state || !state.phaseHistory) return;

    state.phaseHistory.forEach(ph => {
      if (!phaseStats[ph.phase]) {
        phaseStats[ph.phase] = { total: 0, count: 0, success: 0 };
      }
      phaseStats[ph.phase].total += ph.duration || 0;
      phaseStats[ph.phase].count += 1;
      if (ph.retries === 0) {
        phaseStats[ph.phase].success += 1;
      }
    });
  });

  const result = Object.entries(phaseStats).map(([phase, stats]) => ({
    phase,
    avg_duration_ms: stats.count > 0 ? Math.round(stats.total / stats.count) : 0,
    success_rate: stats.count > 0 ? (stats.success / stats.count) : 0
  }));

  res.json(result);
});

app.get('/api/costs', (req, res) => {
  const taskIds = getTaskIds();
  const costs = taskIds
    .map(id => {
      const costFile = path.join(ARCHIVE_DIR, `cost-${id}.json`);
      const data = readJsonSafe(costFile);
      const metaFile = path.join(PIPE_DIR, id, '.meta');
      const meta = readJsonSafe(metaFile);
      if (!data) return null;
      return {
        taskId: id,
        cost: data.totalCost,
        completedAt: data.completedAt,
        createdAt: meta ? meta.createdAt : null
      };
    })
    .filter(c => c !== null)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  res.json(costs);
});

app.get('/api/status', (req, res) => {
  const taskIds = getTaskIds();
  const running = taskIds
    .map(id => {
      const stateFile = path.join(STATE_DIR, `${id}.json`);
      const state = readJsonSafe(stateFile);
      if (!state) return null;
      if (state.currentPhase !== 'completed' && state.currentPhase !== 'failed') {
        return {
          taskId: id,
          currentPhase: state.currentPhase,
          phaseStartTime: state.phaseStartTime
        };
      }
      return null;
    })
    .filter(t => t !== null)
    .sort((a, b) => (b.phaseStartTime || 0) - (a.phaseStartTime || 0));

  res.json({ running, count: running.length });
});

app.listen(PORT, () => {
  console.log(`Dashboard server running at http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  GET http://localhost:${PORT}/api/tasks`);
  console.log(`  GET http://localhost:${PORT}/api/phases`);
  console.log(`  GET http://localhost:${PORT}/api/costs`);
  console.log(`  GET http://localhost:${PORT}/api/status`);
});

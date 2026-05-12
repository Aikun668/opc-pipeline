const fs = require('fs');
const path = require('path');

const BENCHMARK_DIR = path.join(__dirname, '..', 'var', 'benchmark');

class BenchmarkArchiver {
  constructor() {
    this.ensureBenchmarkDir();
  }

  ensureBenchmarkDir() {
    if (!fs.existsSync(BENCHMARK_DIR)) {
      fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
    }
  }

  getNextRoundId() {
    if (!fs.existsSync(BENCHMARK_DIR)) return 'round-001';
    const dirs = fs.readdirSync(BENCHMARK_DIR)
      .filter(d => d.startsWith('round-'))
      .map(d => parseInt(d.replace('round-', ''), 10))
      .filter(n => !isNaN(n));
    const max = dirs.length > 0 ? Math.max(...dirs) : 0;
    return `round-${String(max + 1).padStart(3, '0')}`;
  }

  createRound(mode, tasksFile) {
    const roundId = this.getNextRoundId();
    const roundDir = path.join(BENCHMARK_DIR, roundId);
    fs.mkdirSync(roundDir, { recursive: true });
    fs.mkdirSync(path.join(roundDir, 'tasks'), { recursive: true });

    const meta = {
      roundId,
      date: new Date().toISOString().replace('T', ' ').substring(0, 16),
      mode,
      tasksFile,
      createdAt: Date.now()
    };
    fs.writeFileSync(path.join(roundDir, 'meta.json'), JSON.stringify(meta, null, 2));

    return { roundId, roundDir };
  }

  archiveTask(roundId, taskId, workDir, result) {
    const roundDir = path.join(BENCHMARK_DIR, roundId);
    const taskDir = path.join(roundDir, 'tasks', taskId);
    fs.mkdirSync(taskDir, { recursive: true });

    const outputDir = path.join(taskDir, 'output');
    let archived = false;
    let archiveReason = '';

    if (workDir && fs.existsSync(workDir)) {
      try {
        this.copyDir(workDir, outputDir);
        archived = true;
      } catch (e) {
        archiveReason = e.message;
      }
    } else {
      archiveReason = '临时目录已清理';
    }

    const hasHtml = this.hasHtmlFile(outputDir);
    const taskResult = {
      taskId,
      success: result.success,
      duration: result.duration,
      totalCost: result.totalCost,
      phases: result.phases,
      finalPhase: result.finalPhase,
      hasHtml,
      archived,
      archiveReason: archiveReason || undefined
    };
    fs.writeFileSync(path.join(taskDir, 'task-result.json'), JSON.stringify(taskResult, null, 2));

    return taskResult;
  }

  copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  hasHtmlFile(dir) {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (this.hasHtmlFile(path.join(dir, entry.name))) return true;
      } else if (entry.name.endsWith('.html') || entry.name.endsWith('.htm')) {
        return true;
      }
    }
    return false;
  }

  finalizeRound(roundId, summary) {
    const roundDir = path.join(BENCHMARK_DIR, roundId);
    const results = {
      roundId,
      ...summary,
      finalizedAt: Date.now()
    };
    fs.writeFileSync(path.join(roundDir, 'results.json'), JSON.stringify(results, null, 2));

    const snapshot = this.buildSnapshot(roundId);
    fs.writeFileSync(path.join(roundDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));

    const roundsPath = path.join(BENCHMARK_DIR, 'rounds.json');
    let rounds = [];
    if (fs.existsSync(roundsPath)) {
      try { rounds = JSON.parse(fs.readFileSync(roundsPath, 'utf8')); }
      catch (e) { rounds = []; }
    }
    rounds.push({
      roundId,
      date: new Date().toISOString().replace('T', ' ').substring(0, 16),
      mode: summary.mode || 'mock',
      tasksFile: summary.tasksFile || 'tasks.json',
      taskCount: summary.taskCount,
      successCount: summary.successCount,
      totalCost: summary.totalCost,
      totalDuration: summary.totalDuration
    });
    fs.writeFileSync(roundsPath, JSON.stringify(rounds, null, 2));

    return results;
  }

  buildSnapshot(roundId) {
    const roundDir = path.join(BENCHMARK_DIR, roundId);
    const tasksDir = path.join(roundDir, 'tasks');
    const tasks = [];
    let totalCost = 0, totalDuration = 0, successCount = 0;

    if (fs.existsSync(tasksDir)) {
      const taskIds = fs.readdirSync(tasksDir);
      for (const taskId of taskIds) {
        const resultPath = path.join(tasksDir, taskId, 'task-result.json');
        if (!fs.existsSync(resultPath)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
          totalCost += data.totalCost || 0;
          totalDuration += data.duration || 0;
          if (data.success) successCount++;

          let reviewData = null;
          const scoresPath = path.join(tasksDir, taskId, 'output', 'review-scores.json');
          if (fs.existsSync(scoresPath)) {
            try { reviewData = JSON.parse(fs.readFileSync(scoresPath, 'utf8')); }
            catch (e) {}
          }

          tasks.push({
            taskId: data.taskId,
            success: data.success,
            duration: data.duration,
            totalCost: data.totalCost,
            phases: data.phases,
            hasHtml: data.hasHtml,
            reviewData
          });
        } catch (e) {}
      }
    }

    return {
      roundId,
      timestamp: Date.now(),
      summary: {
        taskCount: tasks.length,
        successCount,
        totalCost,
        totalDuration
      },
      tasks
    };
  }
}

module.exports = { BenchmarkArchiver };

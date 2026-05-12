const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventBus, EVENTS } = require('./event-bus');
const { QualityScorer } = require('./quality-scorer');

const PORT = 3456;
const ROOT = path.join(__dirname, '..');
const BENCHMARK_DIR = path.join(ROOT, 'var', 'benchmark');
const PIPE_DIR = path.join(ROOT, 'var', 'pipe');
const HUMAN_SCORES_PATH = path.join(BENCHMARK_DIR, 'human-scores.json');

const TEXT_EXTS = new Set(['.js', '.py', '.html', '.md', '.json', '.css', '.sh', '.yml', '.yaml', '.txt', '.ts', '.tsx', '.jsx', '.vue']);

class LiveServer {
  constructor() {
    this.eventBus = new EventBus();
    this.clients = [];
    this.taskWorkDirs = new Map();
    this.taskResults = new Map();
    this.qualityScorer = new QualityScorer();
    this.setupEventForwarding();
    this.ensureHumanScoresFile();
    this.loadHistoryData();
  }

  setupEventForwarding() {
    Object.values(EVENTS).forEach(eventName => {
      this.eventBus.on(eventName, (data) => {
        if (eventName === EVENTS.TASK_COMPLETED && data.workDir) {
          this.taskWorkDirs.set(data.taskId, data.workDir);
          this.taskResults.set(data.taskId, data.result || {});
        }
        this.broadcast({ type: eventName, ...data });
      });
    });
  }

  broadcast(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    this.clients = this.clients.filter(client => {
      try { client.write(payload); return true; }
      catch (e) { return false; }
    });
  }

  ensureHumanScoresFile() {
    const dir = path.dirname(HUMAN_SCORES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(HUMAN_SCORES_PATH)) {
      fs.writeFileSync(HUMAN_SCORES_PATH, JSON.stringify({ rounds: {} }, null, 2));
    }
  }

  loadHistoryData() {
    const resultsPath = path.join(BENCHMARK_DIR, 'task-results.json');
    if (!fs.existsSync(resultsPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      for (const t of data.tasks || []) {
        if (t.workDir) this.taskWorkDirs.set(t.taskId, t.workDir);
        this.taskResults.set(t.taskId, {
          taskId: t.taskId, success: t.success, duration: t.duration,
          totalCost: t.totalCost, phases: t.phases
        });
      }
    } catch (e) {}
  }

  getRounds() {
    const roundsPath = path.join(BENCHMARK_DIR, 'rounds.json');
    if (!fs.existsSync(roundsPath)) return [];
    try { return JSON.parse(fs.readFileSync(roundsPath, 'utf8')); }
    catch (e) { return []; }
  }

  getRoundDir(roundId) {
    if (roundId === 'latest') {
      const rounds = this.getRounds();
      if (rounds.length === 0) return null;
      roundId = rounds[rounds.length - 1].roundId;
    }
    const dir = path.join(BENCHMARK_DIR, roundId);
    return fs.existsSync(dir) ? dir : null;
  }

  readHumanScores() {
    try { return JSON.parse(fs.readFileSync(HUMAN_SCORES_PATH, 'utf8')); }
    catch (e) { return { rounds: {} }; }
  }

  writeHumanScores(data) {
    fs.writeFileSync(HUMAN_SCORES_PATH, JSON.stringify(data, null, 2));
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    if (pathname.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid path' }));
    }

    if (pathname === '/') return this.serveHtml(res, 'dashboard.html');
    if (pathname === '/scoring') return this.serveHtml(res, 'scoring.html');
    if (pathname === '/events') return this.serveSSE(req, res);
    if (pathname === '/api/rounds') return this.serveRounds(res);
    if (pathname.startsWith('/api/rounds/')) return this.handleRoundApi(req, res, pathname, url.searchParams);
    if (pathname === '/api/history') return this.serveHistory(res);
    if (pathname === '/api/files') return this.serveLegacyFiles(url.searchParams.get('taskId'), res);
    if (pathname === '/api/file') return this.serveLegacyFile(url.searchParams.get('taskId'), url.searchParams.get('p'), res);
    if (pathname === '/api/scores') return this.serveLegacyScores(res);
    if (pathname.startsWith('/api/scores/')) return this.handleLegacyScores(req, res, pathname);
    if (pathname === '/api/scores/history') return this.serveScoresHistory(res);
    if (pathname.startsWith('/api/review-scores/')) {
      const taskId = pathname.replace('/api/review-scores/', '');
      if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid taskId' }));
      }
      const scoresPath = path.join(PIPE_DIR, taskId, 'review-scores.json');
      if (fs.existsSync(scoresPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(fs.readFileSync(scoresPath, 'utf8'));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No review scores' }));
      }
      return;
    }

    if (pathname.startsWith('/preview/')) {
      return this.servePreview(pathname, res);
    }

    if (pathname.startsWith('/api/snapshot/')) {
      const roundId = pathname.replace('/api/snapshot/', '');
      return this.serveSnapshot(roundId, res);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  handleRoundApi(req, res, pathname, searchParams) {
    const parts = pathname.replace('/api/rounds/', '').split('/');
    const roundId = parts[0];
    const roundDir = this.getRoundDir(roundId);
    if (!roundDir) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Round not found' })); }

    if (parts.length === 1) {
      const meta = JSON.parse(fs.readFileSync(path.join(roundDir, 'meta.json'), 'utf8'));
      const results = fs.existsSync(path.join(roundDir, 'results.json'))
        ? JSON.parse(fs.readFileSync(path.join(roundDir, 'results.json'), 'utf8')) : {};
      const taskHasHtml = this.getRoundTaskHasHtml(roundDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...meta, ...results, taskHasHtml }));
    }

    if (parts[1] === 'events') {
      return this.serveRoundEvents(roundDir, searchParams.get('after'), res);
    }

    if (parts[1] === 'tasks' && parts.length === 2) {
      return this.serveRoundTaskList(roundDir, res);
    }

    if (parts[1] === 'tasks' && parts[3] === 'files') {
      return this.serveRoundFiles(roundDir, parts[2], res);
    }

    if (parts[1] === 'tasks' && parts[3] === 'file') {
      return this.serveRoundFile(roundDir, parts[2], searchParams.get('p'), res);
    }

    if (parts[1] === 'scores') {
      if (req.method === 'POST' && parts.length >= 3) {
        return this.saveRoundScore(roundDir, parts[2], req, res);
      }
      return this.serveRoundScores(roundDir, res);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  serveRounds(res) {
    const rounds = this.getRounds();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rounds));
  }

  getRoundTaskHasHtml(roundDir) {
    const taskHasHtml = {};
    const tasksDir = path.join(roundDir, 'tasks');
    if (!fs.existsSync(tasksDir)) return taskHasHtml;
    const taskIds = fs.readdirSync(tasksDir);
    for (const taskId of taskIds) {
      const resultPath = path.join(tasksDir, taskId, 'task-result.json');
      if (fs.existsSync(resultPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
          taskHasHtml[taskId] = !!data.hasHtml;
        } catch (e) {}
      }
    }
    return taskHasHtml;
  }

  serveRoundTaskList(roundDir, res) {
    const tasksDir = path.join(roundDir, 'tasks');
    const tasks = [];
    if (fs.existsSync(tasksDir)) {
      const taskIds = fs.readdirSync(tasksDir);
      for (const taskId of taskIds) {
        const taskDir = path.join(tasksDir, taskId);
        if (!fs.statSync(taskDir).isDirectory()) continue;
        const resultPath = path.join(taskDir, 'task-result.json');
        let status = 'unknown';
        let hasOutput = false;
        if (fs.existsSync(resultPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            status = data.success ? 'success' : 'failed';
            hasOutput = !!data.hasHtml;
          } catch (e) {}
        }
        tasks.push({ taskId, status, hasOutput });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tasks));
  }

  serveRoundEvents(roundDir, after, res) {
    const eventsPath = path.join(roundDir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }
    const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
    const startIdx = after ? parseInt(after, 10) : 0;
    const events = lines.slice(startIdx, startIdx + 5000).map((line, i) => {
      try { return { idx: startIdx + i, ...JSON.parse(line) }; }
      catch (e) { return null; }
    }).filter(Boolean);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(events));
  }

  serveRoundFiles(roundDir, taskId, res) {
    const outputDir = path.join(roundDir, 'tasks', taskId, 'output');
    if (!fs.existsSync(outputDir)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }
    const files = this.listFiles(outputDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
  }

  serveRoundFile(roundDir, taskId, filePath, res) {
    const outputDir = path.join(roundDir, 'tasks', taskId, 'output');
    if (!fs.existsSync(outputDir)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    const resolved = path.resolve(outputDir, filePath || '');
    if (!resolved.startsWith(outputDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden' }));
    }
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!TEXT_EXTS.has(ext)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ binary: true, reason: '不可预览的二进制文件' }));
    }
    const content = fs.readFileSync(resolved, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content, path: filePath }));
  }

  serveRoundScores(roundDir, res) {
    const scoresPath = path.join(roundDir, 'scores.json');
    if (fs.existsSync(scoresPath)) {
      const data = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(data));
    }

    const resultsPath = path.join(roundDir, 'results.json');
    const taskResultsDir = path.join(roundDir, 'tasks');
    const scores = { roundId: path.basename(roundDir), autoScores: {}, humanScores: {} };

    if (fs.existsSync(taskResultsDir)) {
      const taskIds = fs.readdirSync(taskResultsDir);
      for (const taskId of taskIds) {
        const taskResultPath = path.join(taskResultsDir, taskId, 'task-result.json');
        if (!fs.existsSync(taskResultPath)) continue;
        const taskResult = JSON.parse(fs.readFileSync(taskResultPath, 'utf8'));
        const outputDir = path.join(taskResultsDir, taskId, 'output');
        const autoScore = this.qualityScorer.scan(outputDir, {
          taskId,
          testPassRate: null,
          securityIssues: 0,
          jsonRetries: 0,
          phases: taskResult.phases || 1,
          totalCost: taskResult.totalCost || 0
        });
        scores.autoScores[taskId] = autoScore;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scores));
  }

  saveRoundScore(roundDir, taskId, req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const scoresPath = path.join(roundDir, 'scores.json');
        let scores = { roundId: path.basename(roundDir), autoScores: {}, humanScores: {} };
        if (fs.existsSync(scoresPath)) {
          scores = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
        }
        if (!scores.humanScores) scores.humanScores = {};
        scores.humanScores[taskId] = {
          dimensions: data.dimensions || {},
          notes: data.notes || '',
          savedAt: Date.now()
        };
        fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  serveLegacyFiles(taskId, res) {
    const workDir = this.taskWorkDirs.get(taskId);
    if (!workDir) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Task not found' }));
    }
    const files = this.listFiles(workDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
  }

  serveLegacyFile(taskId, filePath, res) {
    const workDir = this.taskWorkDirs.get(taskId);
    if (!workDir) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Task not found' }));
    }
    const resolved = path.resolve(workDir, filePath || '');
    if (!resolved.startsWith(workDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden' }));
    }
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!TEXT_EXTS.has(ext)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ binary: true, reason: '不可预览的二进制文件' }));
    }
    const content = fs.readFileSync(resolved, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content, path: filePath }));
  }

  serveLegacyScores(res) {
    const latestRoundDir = this.getRoundDir('latest');
    if (latestRoundDir) {
      return this.serveRoundScores(latestRoundDir, res);
    }
    const scores = [];
    for (const [taskId, result] of this.taskResults) {
      const workDir = this.taskWorkDirs.get(taskId);
      if (!workDir) continue;
      const autoScore = this.qualityScorer.scan(workDir, {
        taskId, testPassRate: null, securityIssues: 0, jsonRetries: 0,
        phases: result.phases || 1, totalCost: result.totalCost || 0
      });
      const humanScores = this.readHumanScores();
      const human = humanScores.rounds.latest?.tasks?.[taskId] || null;
      scores.push({ taskId, autoScore, humanScore: human });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ round: 'legacy', scores }));
  }

  handleLegacyScores(req, res, pathname) {
    const taskId = pathname.replace('/api/scores/', '');
    if (req.method === 'POST') {
      return this.saveLegacyScore(taskId, req, res);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  saveLegacyScore(taskId, req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const humanScores = this.readHumanScores();
        const roundKey = 'legacy';
        if (!humanScores.rounds[roundKey]) {
          humanScores.rounds[roundKey] = { date: new Date().toISOString().split('T')[0], tasks: {} };
        }
        humanScores.rounds[roundKey].tasks[taskId] = {
          dimensions: data.dimensions || {},
          notes: data.notes || '',
          savedAt: Date.now()
        };
        this.writeHumanScores(humanScores);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  serveScoresHistory(res) {
    const rounds = this.getRounds();
    const history = [];
    for (const round of rounds) {
      const scoresPath = path.join(BENCHMARK_DIR, round.roundId, 'scores.json');
      let avgScore = '-';
      if (fs.existsSync(scoresPath)) {
        const scores = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
        const humanScores = Object.values(scores.humanScores || {});
        if (humanScores.length > 0) {
          const total = humanScores.reduce((sum, h) => {
            const d = h.dimensions || {};
            return sum + (d.completeness || 0) + (d.codeQuality || 0) + (d.runnability || 0) + (d.security || 0) + (d.satisfaction || 0);
          }, 0);
          avgScore = (total / humanScores.length).toFixed(1);
        }
      }
      history.push({
        round: round.roundId,
        date: round.date || '-',
        avgScore,
        taskCount: round.taskCount || 0
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history.slice(-3)));
  }

  serveHtml(res, filename) {
    const htmlPath = path.join(__dirname, 'public', filename);
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `${filename} not found` }));
    }
  }

  serveSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    this.clients.push(res);
    req.on('close', () => {
      this.clients = this.clients.filter(c => c !== res);
    });
  }

  serveHistory(res) {
    const benchmarkDir = path.join(ROOT, 'var', 'benchmark');
    const reports = [];
    if (fs.existsSync(benchmarkDir)) {
      const files = fs.readdirSync(benchmarkDir)
        .filter(f => f.startsWith('report-') && f.endsWith('.md'))
        .sort().reverse().slice(0, 3);
      for (const file of files) {
        const content = fs.readFileSync(path.join(benchmarkDir, file), 'utf8');
        const summary = this.parseReportSummary(content, file);
        if (summary) reports.push(summary);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reports));
  }

  parseReportSummary(content, filename) {
    const lines = content.split('\n');
    const summary = { filename, label: '', tasks: '-', successRate: '-', cost: '-', date: '' };
    for (const line of lines) {
      if (line.includes('任务总数')) summary.tasks = line.match(/\d+/)?.[0] || '-';
      if (line.includes('成功率')) summary.successRate = line.match(/[\d.]+%/)?.[0] || '-';
      if (line.includes('总成本')) summary.cost = line.match(/¥[\d.]+/)?.[0] || '-';
      if (line.includes('生成时间')) summary.date = line.replace(/.*生成时间[:\s]*/, '').trim();
    }
    summary.label = filename.includes('business') ? '业务题' : '通用题';
    return summary;
  }

  servePreview(pathname, res) {
    const parts = pathname.replace('/preview/', '').split('/');
    if (parts.length < 2) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid preview path' }));
    }
    let roundId = parts[0];
    const taskId = parts[1];
    let filePath = parts.slice(2).join('/') || '';

    if (roundId === 'latest') {
      const rounds = this.getRounds();
      if (rounds.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No rounds available' }));
      }
      roundId = rounds[rounds.length - 1].roundId;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(roundId) || !/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid roundId or taskId' }));
    }

    const baseDir = path.join(BENCHMARK_DIR, roundId, 'tasks', taskId, 'output');
    const resolved = path.normalize(path.join(baseDir, filePath));
    if (!resolved.startsWith(baseDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden' }));
    }

    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      const indexPath = path.join(resolved, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(indexPath, 'utf8'));
      }
      return this.serveDirectoryListing(resolved, pathname, res);
    }

    if (!fs.existsSync(resolved)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }

    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(resolved));
  }

  serveDirectoryListing(dir, pathname, res) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.filter(e => !e.isDirectory()).map(e => ({
      name: e.name,
      size: fs.statSync(path.join(dir, e.name)).size
    }));
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const currentPath = pathname.endsWith('/') ? pathname : pathname + '/';

    const parts = currentPath.replace('/preview/', '').split('/').filter(Boolean);
    let breadcrumbs = '<a href="/preview/">preview</a>';
    let bcPath = '/preview/';
    for (let i = 0; i < parts.length; i++) {
      bcPath += parts[i] + '/';
      breadcrumbs += ' / ' + (i === parts.length - 1 ? parts[i] : `<a href="${bcPath}">${parts[i]}</a>`);
    }

    let html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>文件列表</title>
<style>
body{font-family:'SFMono-Regular','Cascadia Code','Consolas',monospace;background:#0d1117;color:#c9d1d9;padding:24px;max-width:800px;margin:0 auto}
h1{font-size:18px;border-bottom:1px solid #30363d;padding-bottom:12px}
.breadcrumbs{color:#8b949e;font-size:13px;margin-bottom:16px}
.breadcrumbs a{color:#58a6ff;text-decoration:none}
.item{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)}
.item:hover{background:rgba(255,255,255,0.03)}
a{color:#58a6ff;text-decoration:none}
a:hover{text-decoration:underline}
.size{color:#8b949e;font-size:12px}
.dir{font-weight:700}
.back{color:#8b949e}
</style></head><body>
<div class="breadcrumbs">${breadcrumbs}</div>
<h1>📁 ${parts[parts.length - 1] || 'preview'}</h1>`;

    if (currentPath !== '/preview/') {
      const parent = currentPath.split('/').slice(0, -2).join('/') + '/';
      html += `<div class="item back"><a href="${parent}">← 上级目录</a></div>`;
    }

    for (const d of dirs) {
      html += `<div class="item"><a href="${currentPath}${d}/" class="dir">📂 ${d}/</a></div>`;
    }

    for (const f of files) {
      const size = f.size < 1024 ? f.size + ' B' : (f.size / 1024).toFixed(1) + ' KB';
      html += `<div class="item"><a href="${currentPath}${f.name}">📄 ${f.name}</a><span class="size">${size}</span></div>`;
    }

    if (dirs.length === 0 && files.length === 0) {
      html += '<div style="color:#8b949e;padding:24px 0;">空目录</div>';
    }

    html += '</body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  serveSnapshot(roundId, res) {
    if (roundId === 'latest') {
      const rounds = this.getRounds();
      if (rounds.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No rounds available' }));
      }
      roundId = rounds[rounds.length - 1].roundId;
    }
    const roundDir = this.getRoundDir(roundId);
    if (!roundDir) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Round not found' }));
    }
    const snapshotPath = path.join(roundDir, 'snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Snapshot not found' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fs.readFileSync(snapshotPath, 'utf8'));
  }

  listFiles(workDir) {
    const files = [];
    if (!fs.existsSync(workDir)) return files;
    const walk = (dir, prefix = '') => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { return; }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else {
          try {
            const stat = fs.statSync(fullPath);
            files.push({ name: entry.name, path: relPath, size: stat.size, ext: path.extname(entry.name) });
          } catch (e) {}
        }
      }
    };
    walk(workDir);
    return files;
  }

  start() {
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    server.listen(PORT, () => {
      console.log(`面板已启动: http://localhost:${PORT}`);
      console.log(`  实时监控: http://localhost:${PORT}`);
      console.log(`  质量评分: http://localhost:${PORT}/scoring`);
      if (this.taskResults.size === 0) {
        console.log('  (无实时压测数据，页面显示历史数据或空状态)');
      }
    });
    return server;
  }
}

module.exports = { LiveServer };

if (require.main === module) {
  const liveServer = new LiveServer();
  liveServer.start();
}

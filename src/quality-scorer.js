const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class QualityScorer {
  scan(workDir, benchmarkResult = {}) {
    const files = this.listFiles(workDir);
    const testPassRate = benchmarkResult.testPassRate || benchmarkResult.testingPassed || null;
    const securityIssues = benchmarkResult.securityIssues || 0;
    const jsonRetries = benchmarkResult.jsonRetries || benchmarkResult.retries || 0;
    const phases = benchmarkResult.phases || 1;
    const totalCost = benchmarkResult.totalCost || 0;

    const completeness = this.scoreCompleteness(testPassRate);
    const security = this.scoreSecurity(securityIssues);
    const stability = this.scoreStability(jsonRetries);
    const codeQuality = this.scoreCodeQuality(workDir, files);
    const efficiency = this.scoreEfficiency(totalCost, phases);

    const totalScore = Math.round(
      completeness * 0.35 +
      security * 0.25 +
      stability * 0.20 +
      codeQuality * 0.10 +
      efficiency * 0.10
    );

    return {
      taskId: benchmarkResult.taskId || 'unknown',
      totalScore,
      dimensions: {
        completeness: { score: completeness, weight: 0.35 },
        security: { score: security, weight: 0.25 },
        stability: { score: stability, weight: 0.20 },
        codeQuality: { score: codeQuality, weight: 0.10 },
        efficiency: { score: efficiency, weight: 0.10 }
      },
      details: {
        testPassRate: testPassRate !== null ? `${testPassRate}/${testPassRate}` : 'N/A',
        securityIssues,
        jsonRetries,
        phases,
        totalCost,
        files: files.map(f => f.name).slice(0, 20)
      }
    };
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
            files.push({
              name: entry.name,
              path: relPath,
              size: stat.size,
              ext: path.extname(entry.name)
            });
          } catch (e) {}
        }
      }
    };
    walk(workDir);
    return files;
  }

  scoreCompleteness(testPassRate) {
    if (testPassRate === null || testPassRate === undefined) return 50;
    if (typeof testPassRate === 'number') {
      return Math.min(100, Math.max(0, testPassRate * 100));
    }
    return 50;
  }

  scoreSecurity(issues) {
    if (issues === 0) return 100;
    if (issues === 1) return 70;
    if (issues === 2) return 40;
    return 20;
  }

  scoreStability(retries) {
    if (retries === 0) return 100;
    if (retries === 1) return 80;
    if (retries === 2) return 60;
    return 30;
  }

  scoreCodeQuality(workDir, files) {
    const hasEslint = files.some(f => f.name.startsWith('.eslintrc'));
    if (!hasEslint) return 70;
    try {
      const result = execSync('npx eslint --format json .', {
        cwd: workDir,
        encoding: 'utf8',
        timeout: 10000
      });
      const eslintOutput = JSON.parse(result);
      const errorCount = eslintOutput.reduce((sum, f) => sum + f.errorCount, 0);
      if (errorCount === 0) return 100;
      if (errorCount <= 3) return 85;
      if (errorCount <= 10) return 70;
      if (errorCount <= 20) return 50;
      return 30;
    } catch (e) {
      return 70;
    }
  }

  scoreEfficiency(totalCost, phases) {
    const ratio = phases > 0 ? totalCost / phases : totalCost;
    if (ratio <= 0.003) return 100;
    if (ratio <= 0.006) return 70;
    if (ratio <= 0.01) return 50;
    return 30;
  }
}

module.exports = { QualityScorer };

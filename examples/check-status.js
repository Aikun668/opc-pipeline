#!/usr/bin/env node
/**
 * OPC Pipeline 状态检查工具
 * 查看任务状态和 Actor 健康
 */

const fs = require('fs');
const path = require('path');
const { PipeManager } = require('../pipe/pipe-manager');

const PIPELINE_DIR = '/home/jadekun/.openclaw/workspace/opc-pipeline';
const VAR_DIR = path.join(PIPELINE_DIR, 'var');
const PID_DIR = path.join(VAR_DIR, 'pids');

function checkActorStatus(name) {
    const pidFile = path.join(PID_DIR, `${name}.pid`);
    
    if (!fs.existsSync(pidFile)) {
        return { running: false, pid: null };
    }
    
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
    
    try {
        process.kill(pid, 0);
        return { running: true, pid };
    } catch (e) {
        return { running: false, pid, stale: true };
    }
}

function listTasks() {
    const pipeManager = new PipeManager();
    return pipeManager.listTaskPipes();
}

function getTaskStatus(taskId) {
    const pipeManager = new PipeManager();
    const pipeDir = pipeManager.getTaskPipe(taskId);
    
    const status = {
        taskId,
        exists: fs.existsSync(pipeDir),
        states: []
    };
    
    if (!status.exists) return status;
    
    // 检查各种状态文件
    const files = [
        { name: 'input.json.tmp', state: 'writing' },
        { name: 'input.json.ready', state: 'ready' },
        { name: 'input.json.processing', state: 'processing' },
        { name: 'input.json.done', state: 'done' },
        { name: 'output.json', state: 'output' }
    ];
    
    for (const { name, state } of files) {
        if (fs.existsSync(path.join(pipeDir, name))) {
            status.states.push(state);
        }
    }
    
    // 检查心跳
    const heartbeat = pipeManager.getHeartbeat(taskId);
    if (heartbeat) {
        const age = Date.now() - heartbeat;
        status.heartbeat = {
            last: new Date(heartbeat).toISOString(),
            ageSeconds: Math.floor(age / 1000),
            expired: age > 300000 // 5分钟
        };
    }
    
    // 读取输出（如果有）
    if (status.states.includes('output')) {
        const output = pipeManager.readOutput(taskId, false);
        if (output.success) {
            status.output = output.data;
        }
    }
    
    return status;
}

function main() {
    console.log('================================');
    console.log('OPC Pipeline 状态检查');
    console.log('================================\n');
    
    // 1. Actor 状态
    console.log('[Actor 状态]');
    const actors = ['coder-actor', 'reviewer-actor', 'tester-actor'];
    let runningCount = 0;
    
    for (const actor of actors) {
        const status = checkActorStatus(actor);
        if (status.running) {
            console.log(`  ✅ ${actor}: 运行中 (PID: ${status.pid})`);
            runningCount++;
        } else if (status.stale) {
            console.log(`  ⚠️  ${actor}: PID 文件过期 (${status.pid})`);
        } else {
            console.log(`  ❌ ${actor}: 未运行`);
        }
    }
    
    console.log(`\n  总计: ${runningCount}/${actors.length} 运行中`);
    console.log('');
    
    // 2. 任务状态
    console.log('[任务状态]');
    const tasks = listTasks();
    
    if (tasks.length === 0) {
        console.log('  暂无任务');
    } else {
        console.log(`  共 ${tasks.length} 个任务:\n`);
        
        for (const taskId of tasks.slice(-5)) { // 只显示最近5个
            const status = getTaskStatus(taskId);
            
            console.log(`  任务: ${taskId}`);
            console.log(`    状态: ${status.states.join(' → ') || 'new'}`);
            
            if (status.heartbeat) {
                const icon = status.heartbeat.expired ? '⚠️' : '✅';
                console.log(`    心跳: ${icon} ${status.heartbeat.ageSeconds}s 前`);
            }
            
            if (status.output) {
                console.log(`    输出: ${status.output.status}`);
                console.log(`    摘要: ${status.output.summary}`);
                console.log(`    下一步: ${status.output.nextAction}`);
            }
            
            console.log('');
        }
        
        if (tasks.length > 5) {
            console.log(`  ... 还有 ${tasks.length - 5} 个任务`);
        }
    }
    
    console.log('================================');
    console.log('提示:');
    console.log('  启动: ./start.sh start');
    console.log('  停止: ./start.sh stop');
    console.log('  清理: ./start.sh cleanup');
}

main();

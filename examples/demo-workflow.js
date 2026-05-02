#!/usr/bin/env node
/**
 * OPC Pipeline 完整运行示例
 * 演示从创建任务到完成的完整工作流
 */

const fs = require('fs');
const path = require('path');
const { Orchestrator } = require('../orchestrator');
const { PipeManager } = require('../pipe/pipe-manager');

const PROJECT_ROOT = '/home/jadekun/.openclaw/workspace';

async function main() {
    console.log('================================');
    console.log('OPC Pipeline 完整运行示例');
    console.log('================================\n');
    
    // 1. 初始化主控
    console.log('[1/5] 初始化主控...');
    const orchestrator = new Orchestrator();
    const pipeManager = new PipeManager();
    
    // 2. 创建示例项目文件（模拟真实项目）
    console.log('[2/5] 准备示例项目文件...');
    const exampleProjectDir = path.join(PROJECT_ROOT, 'example-project');
    fs.mkdirSync(exampleProjectDir, { recursive: true });
    fs.mkdirSync(path.join(exampleProjectDir, 'src', 'auth'), { recursive: true });
    
    // 创建 types.ts
    fs.writeFileSync(
        path.join(exampleProjectDir, 'src', 'auth', 'types.ts'),
        `export interface User {
  id: string;
  email: string;
  passwordHash: string;
}

export interface AuthToken {
  token: string;
  expiresAt: Date;
}
`
    );
    
    // 创建 package.json
    fs.writeFileSync(
        path.join(exampleProjectDir, 'package.json'),
        JSON.stringify({
            name: 'example-project',
            version: '1.0.0',
            scripts: { test: 'echo "Tests passed" && exit 0' }
        }, null, 2)
    );
    
    console.log('  ✓ 示例项目创建: ' + exampleProjectDir);
    
    // 3. 创建任务
    console.log('[3/5] 创建任务...');
    const taskId = `TASK-${Date.now()}`;
    
    orchestrator.createTask(taskId, 'feature', '实现用户登录API，包含JWT签发和密码验证', {
        projectRoot: exampleProjectDir,
        contextFiles: [
            'src/auth/types.ts'
        ],
        constraints: [
            '使用 bcrypt 进行密码哈希',
            'JWT 有效期 24 小时',
            '单元测试覆盖率 >= 80%'
        ]
    });
    
    console.log(`  ✓ 任务创建: ${taskId}`);
    console.log('');
    
    // 4. 显示任务详情
    console.log('[4/5] 任务详情:');
    const pipeDir = pipeManager.getTaskPipe(taskId);
    const input = pipeManager.readInputBeacon(taskId);
    
    console.log(`  任务ID: ${taskId}`);
    console.log(`  类型: ${input.type}`);
    console.log(`  描述: ${input.description}`);
    console.log(`  项目根目录: ${input._meta.projectRoot}`);
    console.log(`  上下文文件:`);
    input._meta.contextFiles.forEach(f => console.log(`    - ${f}`));
    console.log('');
    
    // 5. 模拟工作流执行（实际应由 Actor 处理）
    console.log('[5/5] 模拟工作流执行...');
    console.log('');
    
    // 模拟 Coder 执行
    console.log('  → Coder Actor 接收任务');
    console.log('    - 读取 input.json (ready → processing)');
    console.log('    - 加载记忆: memory/roles/coder-profile.md');
    console.log('    - 执行编码...');
    
    // 模拟 Coder 输出
    const coderOutput = {
        version: '1.0',
        status: 'success',
        summary: '登录API实现完成，包含bcrypt加密和JWT签发',
        artifacts: {
            codePatch: `${pipeDir}/code.patch`
        },
        nextAction: 'request_review'
    };
    
    // 写入 code.patch (模拟)
    fs.writeFileSync(
        path.join(pipeDir, 'code.patch'),
        `+ export async function login(email: string, password: string) {
+   const user = await findUserByEmail(email);
+   if (!user) throw new Error('User not found');
+   
+   const valid = await bcrypt.compare(password, user.passwordHash);
+   if (!valid) throw new Error('Invalid password');
+   
+   const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
+   return { token, user };
+ }`
    );
    
    pipeManager.writeOutput(taskId, coderOutput);
    pipeManager.completeInputBeacon(taskId);
    
    console.log('    - 写入 output.json (硬截断验证通过)');
    console.log('    - 写入 code.patch (大文件)');
    console.log('    - nextAction: request_review');
    console.log('    - 标记完成 (processing → done)');
    console.log('');
    
    // 模拟 Reviewer 执行
    console.log('  → Reviewer Actor 接收任务');
    console.log('    - 读取 code.patch');
    console.log('    - 基于 Git Diff 审查...');
    
    const reviewerOutput = {
        version: '1.0',
        status: 'success',
        summary: '审查通过，代码结构良好，无安全问题',
        artifacts: {
            reviewReport: `${pipeDir}/review-report.md`
        },
        nextAction: 'request_test'
    };
    
    fs.writeFileSync(
        path.join(pipeDir, 'input.json.ready'),
        JSON.stringify({ type: 'review', taskId, _meta: input._meta }, null, 2)
    );
    
    const reviewInput = pipeManager.readInputBeacon(taskId);
    pipeManager.writeOutput(taskId, reviewerOutput);
    pipeManager.completeInputBeacon(taskId);
    
    console.log('    - 写入 review-report.md');
    console.log('    - nextAction: request_test');
    console.log('');
    
    // 模拟 Tester 执行
    console.log('  → Tester Actor 接收任务');
    console.log('    - 执行 npm test');
    console.log('    - EXIT_CODE: 0 (硬检查)');
    console.log('    - 提取覆盖率: 85% (>= 80%)');
    
    const testReport = {
        exitCode: 0,
        coverage: 85,
        testsPassed: 12,
        testsFailed: 0
    };
    
    fs.writeFileSync(
        path.join(pipeDir, 'test-report.json'),
        JSON.stringify(testReport, null, 2)
    );
    
    const testerOutput = {
        version: '1.0',
        status: 'success',
        summary: '测试通过，覆盖率 85%',
        artifacts: {
            testReport: `${pipeDir}/test-report.json`
        },
        metrics: {
            testExitCode: 0,
            coverage: 85
        },
        nextAction: 'complete'
    };
    
    fs.writeFileSync(
        path.join(pipeDir, 'input.json.ready'),
        JSON.stringify({ type: 'test', taskId, _meta: input._meta }, null, 2)
    );
    
    const testInput = pipeManager.readInputBeacon(taskId);
    pipeManager.writeOutput(taskId, testerOutput);
    pipeManager.completeInputBeacon(taskId);
    
    console.log('    - 写入 test-report.json');
    console.log('    - nextAction: complete');
    console.log('');
    
    // 6. 显示最终结果
    console.log('================================');
    console.log('工作流完成！');
    console.log('================================');
    console.log('');
    console.log('任务状态:');
    console.log(`  任务ID: ${taskId}`);
    console.log(`  最终状态: ✅ 成功`);
    console.log(`  管道目录: ${pipeDir}`);
    console.log('');
    console.log('生成的文件:');
    const files = fs.readdirSync(pipeDir);
    files.forEach(f => {
        const stats = fs.statSync(path.join(pipeDir, f));
        console.log(`  - ${f} (${stats.size} bytes)`);
    });
    console.log('');
    console.log('输出内容:');
    const finalOutput = pipeManager.readOutput(taskId);
    if (finalOutput.success) {
        console.log(JSON.stringify(finalOutput.data, null, 2));
    }
    
    // 7. 清理（可选）
    console.log('');
    console.log('提示:');
    console.log('  - 使用 ./start.sh 启动真实 Actor');
    console.log('  - 使用 ./start.sh cleanup 清理管道');
    console.log('  - 查看日志: tail -f var/logs/*.log');
}

main().catch(err => {
    console.error('错误:', err);
    process.exit(1);
});

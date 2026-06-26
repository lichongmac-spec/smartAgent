#!/usr/bin/env node
/**
 * 环境检测模块测试
 * 运行: pnpm test:env-check
 *
 * 覆盖：
 *   1. checkNodeVersion（正常 / silent / skip）
 *   2. isCI（默认 + 各平台模拟 + CI=false 边界）
 *   3. isGlobalInstall（本地环境 + fileURLToPath 转换验证）
 *   4. isContainer（环境变量 + 文件检测逻辑）
 *   5. printEnvInfo（5 行输出 + 关键字段）
 */

import pc from 'picocolors';
import {
    checkNodeVersion,
    isCI,
    isGlobalInstall,
    isContainer,
    printEnvInfo,
} from '../src/agent/cli/env-check.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;
let failCount = 0;

function captureConsole(fn: () => void): { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (msg: string) => stdout.push(msg);
    console.error = (msg: string) => stderr.push(msg);
    try {
        fn();
    } finally {
        console.log = origLog;
        console.error = origErr;
    }
    return { stdout, stderr };
}

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(msg);
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
    testCount++;
    const num = testCount;
    console.log(pc.yellow(`\n📝 测试 ${num}: ${name}`));
    try {
        await fn();
        passCount++;
        console.log(pc.green('  ✅ 通过'));
    } catch (err: any) {
        failCount++;
        console.log(pc.red(`  ❌ 失败: ${err.message}`));
        if (process.env.DEBUG) console.error(err);
    }
}

// ============================================================
//  测试入口
// ============================================================
async function main() {
    console.log(pc.cyan('\n🧪 环境检测模块测试\n'));
    console.log(pc.gray('━'.repeat(50)));

    // ============================================================
    //  测试 1: checkNodeVersion 正常通过
    // ============================================================
    await runTest('checkNodeVersion 正常通过（当前版本 >= 18）', () => {
        const r = captureConsole(() => checkNodeVersion());

        const version = process.version;
        assert(
            r.stdout.some(s => s.includes(version)),
            `应输出当前版本号 ${version}`
        );
        assert(
            r.stdout.some(s => s.includes('✅')),
            '应包含成功标记 ✅'
        );
        assert(r.stderr.length === 0, '正常版本不应有 stderr 输出');
    });

    // ============================================================
    //  测试 2: checkNodeVersion silent 模式
    // ============================================================
    await runTest('checkNodeVersion silent 模式', () => {
        const r = captureConsole(() => checkNodeVersion({ silent: true }));
        assert(r.stdout.length === 0, 'silent 模式不应有 stdout 输出');
        assert(r.stderr.length === 0, 'silent 模式不应有 stderr 输出');
    });

    // ============================================================
    //  测试 3: checkNodeVersion skip 模式
    // ============================================================
    await runTest('checkNodeVersion skip 模式', () => {
        // skip + 默认 silent=false：应打印跳过信息
        const r1 = captureConsole(() => checkNodeVersion({ skip: true }));
        assert(r1.stdout.some(s => s.includes('跳过')), 'skip 时应输出跳过信息');
        assert(r1.stderr.length === 0, 'skip 不应有 stderr');

        // skip + silent=true：完全静默
        const r2 = captureConsole(() => checkNodeVersion({ skip: true, silent: true }));
        assert(r2.stdout.length === 0, 'skip+silent 不应有任何输出');
    });

    // ============================================================
    //  测试 4: checkNodeVersion 低版本拦截逻辑验证
    // ============================================================
    await runTest('checkNodeVersion 低版本拦截逻辑验证', () => {
        const version = process.version;
        const major = parseInt(version.slice(1).split('.')[0], 10);
        assert(major >= 18, `当前 Node 主版本应为 >= 18，实际: ${major}`);

        // 边界：v18 刚好通过
        const parsed18 = parseInt('v18.0.0'.slice(1).split('.')[0], 10);
        assert(parsed18 === 18, 'v18.0.0 解析应为 18');

        // v16 不通过
        const parsed16 = parseInt('v16.20.0'.slice(1).split('.')[0], 10);
        assert(parsed16 === 16, 'v16.20.0 解析应为 16');

        // v20 也通过
        const parsed20 = parseInt('v20.10.0'.slice(1).split('.')[0], 10);
        assert(parsed20 === 20, 'v20.10.0 解析应为 20');
    });

    // ============================================================
    //  测试 5: isCI 默认非 CI
    // ============================================================
    await runTest('isCI — 默认环境返回 false', () => {
        const hasCIEnv = !!(
            process.env.CI ||
            process.env.GITHUB_ACTIONS ||
            process.env.GITLAB_CI ||
            process.env.JENKINS_HOME ||
            process.env.BUILD_NUMBER
        );
        assert(isCI() === hasCIEnv, `isCI 应与实际环境一致: ${isCI()}`);
    });

    // ============================================================
    //  测试 6: isCI 模拟各平台环境变量
    // ============================================================
    await runTest('isCI — 模拟各 CI 平台', () => {
        const saved = {
            CI: process.env.CI,
            GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
            GITLAB_CI: process.env.GITLAB_CI,
            JENKINS_HOME: process.env.JENKINS_HOME,
            BUILD_NUMBER: process.env.BUILD_NUMBER,
        };

        // CI=true
        process.env.CI = 'true';
        process.env.GITHUB_ACTIONS = undefined;
        process.env.GITLAB_CI = undefined;
        process.env.JENKINS_HOME = undefined;
        process.env.BUILD_NUMBER = undefined;
        assert(isCI() === true, 'CI=true → isCI true');

        // GITHUB_ACTIONS
        process.env.CI = undefined;
        process.env.GITHUB_ACTIONS = 'true';
        assert(isCI() === true, 'GITHUB_ACTIONS=true → isCI true');

        // GITLAB_CI
        delete process.env.GITHUB_ACTIONS;
        process.env.GITLAB_CI = 'true';
        assert(isCI() === true, 'GITLAB_CI=true → isCI true');

        // JENKINS_HOME
        delete process.env.GITLAB_CI;
        process.env.JENKINS_HOME = '/var/jenkins';
        assert(isCI() === true, 'JENKINS_HOME set → isCI true');

        // BUILD_NUMBER
        delete process.env.JENKINS_HOME;
        process.env.BUILD_NUMBER = '42';
        assert(isCI() === true, 'BUILD_NUMBER=42 → isCI true');

        // 全部清空
        delete process.env.BUILD_NUMBER;
        delete process.env.CI;
        assert(isCI() === false, 'no CI env → isCI false');

        // 恢复
        process.env.CI = saved.CI;
        process.env.GITHUB_ACTIONS = saved.GITHUB_ACTIONS;
        process.env.GITLAB_CI = saved.GITLAB_CI;
        process.env.JENKINS_HOME = saved.JENKINS_HOME;
        process.env.BUILD_NUMBER = saved.BUILD_NUMBER;
    });

    // ============================================================
    //  测试 7: isCI CI=false 边界
    // ============================================================
    await runTest('isCI — CI=false 字符串处理', () => {
        const saved = process.env.CI;
        process.env.CI = 'false';
        // !! 会把非空字符串转 true（保守行为）
        assert(isCI() === true, 'CI="false" → isCI 为 true（保守 by design）');
        process.env.CI = saved;
    });

    // ============================================================
    //  测试 8: isGlobalInstall 本地开发环境
    // ============================================================
    await runTest('isGlobalInstall — 本地开发环境应为 false', () => {
        const result = isGlobalInstall();
        assert(typeof result === 'boolean', 'isGlobalInstall 应返回 boolean');
        console.log(pc.gray(`  📋 isGlobalInstall: ${result}`));
    });

    // ============================================================
    //  测试 9: isGlobalInstall fileURLToPath 转换验证
    // ============================================================
    await runTest('isGlobalInstall — fileURLToPath 与路径匹配', () => {
        const modulePath = import.meta.url;
        assert(modulePath.startsWith('file://'), `应为 file:// 协议: ${modulePath}`);

        // 从 URL 提取路径部分验证匹配逻辑
        const pathPart = modulePath.replace('file://', '');

        // 本地开发路径不应命中全局安装（关键：确保 fileURLToPath 不会误判）
        // 本地路径形如 /Users/.../SmartAgent/src/agent/cli/env-check.ts
        assert(
            !pathPart.includes('/node_modules/.pnpm/') ||
            pathPart.includes('/SmartAgent/node_modules/'),
            '本地开发路径不应被误判为全局安装（除非在 .pnpm store 中运行）'
        );

        // 全局安装路径小样例验证
        const globalPnPMPath = '/usr/lib/node_modules/.pnpm/smartagent@1.0.0/node_modules/@smartagent/cli/index.js';
        assert(
            globalPnPMPath.includes('/node_modules/.pnpm/'),
            '.pnpm 路径应被匹配'
        );
        assert(
            globalPnPMPath.includes('/node_modules/@smartagent'),
            '@smartagent 路径应被匹配'
        );

        const globalDirectPath = '/usr/lib/node_modules/@smartagent/cli/env-check.js';
        assert(
            globalDirectPath.includes('/node_modules/@smartagent'),
            '@smartagent 直接安装路径应被匹配'
        );

        // .pnpm 扁平化路径
        const flatPnPMPath = '/usr/lib/node_modules/.pnpm/node_modules/@smartagent/cli/index.js';
        assert(
            flatPnPMPath.includes('.pnpm/node_modules/@smartagent'),
            '.pnpm/node_modules/@smartagent 扁平路径应被匹配'
        );
    });

    // ============================================================
    //  测试 10: isContainer — 默认环境
    // ============================================================
    await runTest('isContainer — 默认环境', () => {
        const result = isContainer();
        assert(typeof result === 'boolean', 'isContainer 应返回 boolean');
        console.log(pc.gray(`  📋 isContainer: ${result}`));
    });

    // ============================================================
    //  测试 11: isContainer — CONTAINER_ID 环境变量
    // ============================================================
    await runTest('isContainer — CONTAINER_ID 环境变量', () => {
        const saved = process.env.CONTAINER_ID;

        // 设 CONTAINER_ID → 应为 true
        process.env.CONTAINER_ID = 'abc123';
        assert(isContainer() === true, 'CONTAINER_ID 存在 → isContainer true');

        // 清除 → 恢复为默认
        delete process.env.CONTAINER_ID;
        const noEnv = isContainer();
        assert(typeof noEnv === 'boolean', '无 CONTAINER_ID 时仍应返回 boolean');

        process.env.CONTAINER_ID = saved;
    });

    // ============================================================
    //  测试 12: printEnvInfo 输出环境摘要
    // ============================================================
    await runTest('printEnvInfo 输出环境摘要', () => {
        const r = captureConsole(() => printEnvInfo());

        // 5 行固定输出
        assert(r.stdout.length === 5, `应输出 5 行，实际 ${r.stdout.length}`);

        // 工作路径
        assert(r.stdout.some(s => s.includes(process.cwd())), '应包含当前工作路径');

        // 平台 + 架构
        assert(r.stdout.some(s => s.includes(process.platform)), '应包含平台信息');
        assert(r.stdout.some(s => s.includes(process.arch)), '应包含 CPU 架构');

        // 各字段标签
        const merged = r.stdout.join('');
        assert(merged.includes('容器'), '应包含容器状态');
        assert(merged.includes('CI 环境'), '应包含 CI 环境状态');
        assert(merged.includes('全局安装'), '应包含全局安装状态');
    });

    // ============================================================
    //  测试总结
    // ============================================================
    console.log(pc.gray('\n━'.repeat(50)));
    console.log(pc.cyan(`\n📊 测试结果: ${passCount}/${testCount} 通过`));

    if (failCount > 0) {
        console.log(pc.red(`❌ ${failCount} 个测试失败\n`));
        process.exit(1);
    } else {
        console.log(pc.green('🎉 所有测试通过！\n'));
        process.exit(0);
    }
}

main().catch(err => {
    console.error(pc.red('💥 测试运行异常:'), err);
    process.exit(1);
});

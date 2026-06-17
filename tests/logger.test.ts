#!/usr/bin/env node
/**
 * 日志与终端交互模块测试
 * 运行: pnpm test:logger
 *
 * 覆盖：
 *   1. 分级日志（info / success / warn / error / debug）
 *   2. configureLogger / getLoggerConfig
 *   3. withSpinner（正常 / 异常 / CI 降级）
 *   4. createProgressBar（正常 / 边界 / fail）
 *   5. progressTick + clearProgressLine
 *
 * 未覆盖（需要 TTY 环境，手工测试）：
 *   - Select / MultiSelect / Confirm / Input
 *   - step / intro / outro
 */

import pc from 'picocolors';

import {
    configureLogger,
    getLoggerConfig,
    logger,
    withSpinner,
    createProgressBar,
    progressTick,
    clearProgressLine,
} from '../src/cli/logger.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;
let failCount = 0;

/**
 * 捕获 console.log / console.error 输出用于断言
 */
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
    console.log(pc.cyan('\n🧪 日志与终端交互模块测试\n'));
    console.log(pc.gray('━'.repeat(50)));

    // ============================================================
    //  测试 1: 分级日志输出
    // ============================================================
    await runTest('分级日志 info / success / warn / error / debug', () => {
        configureLogger({ verbose: false, isCI: false, noColor: false });

        const r1 = captureConsole(() => logger.info('Hello info'));
        assert(r1.stdout.some(s => s.includes('Hello info')), 'info 应输出到 stdout');

        const r2 = captureConsole(() => logger.success('Done'));
        assert(r2.stdout.some(s => s.includes('Done')), 'success 应输出到 stdout');

        const r3 = captureConsole(() => logger.warn('Careful'));
        assert(r3.stdout.some(s => s.includes('Careful')), 'warn 应输出到 stdout');

        const r4 = captureConsole(() => logger.error('Boom'));
        assert(r4.stderr.some(s => s.includes('Boom')), 'error 应输出到 stderr');

        const r5 = captureConsole(() => logger.debug('secret'));
        assert(r5.stdout.length === 0, 'verbose=false 时 debug 不应输出');

        const r6 = captureConsole(() => logger.debug('visible', true));
        assert(r6.stdout.some(s => s.includes('visible')), 'debug(_, true) 应显式输出');
    });

    // ============================================================
    //  测试 2: configureLogger / getLoggerConfig
    // ============================================================
    await runTest('configureLogger 与 getLoggerConfig', () => {
        configureLogger({ isCI: true, verbose: true, noColor: false });
        const cfg1 = getLoggerConfig();
        assert(cfg1.isCI === true, 'isCI 应为 true');
        assert(cfg1.verbose === true, 'verbose 应为 true');
        assert(cfg1.noColor === false, 'noColor 不应被 CI 自动开启');

        configureLogger({ isCI: false, verbose: false, noColor: false });
        const cfg2 = getLoggerConfig();
        assert(cfg2.verbose === false, '恢复后 verbose 应为 false');
    });

    // ============================================================
    //  测试 3: logger.blank / write
    // ============================================================
    await runTest('logger.blank / write', () => {
        // blank() 不应抛异常
        const r1 = captureConsole(() => logger.blank());
        assert(r1.stdout.length >= 0, 'blank 不应抛异常');

        const origWrite = process.stdout.write;
        let captured = '';
        process.stdout.write = ((chunk: string | Uint8Array, ..._args: any[]) => {
            captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            return true;
        }) as typeof process.stdout.write;

        logger.write('hello');
        process.stdout.write = origWrite;
        assert(captured === 'hello', `write 应输出 'hello'，实际: '${captured}'`);
    });

    // ============================================================
    //  测试 4: withSpinner（正常流程）
    // ============================================================
    await runTest('withSpinner 正常流程', async () => {
        configureLogger({ isCI: false, verbose: false, noColor: false });

        let fnCalled = false;
        const result = await withSpinner('加载中...', async (spinner) => {
            fnCalled = true;
            assert(typeof spinner.text === 'string', 'spinner 应有 text 属性');
            return 42;
        });

        assert(fnCalled, '异步函数应被调用');
        assert(result === 42, `返回值应为 42，实际: ${result}`);
    });

    // ============================================================
    //  测试 5: withSpinner（异常传播）
    // ============================================================
    await runTest('withSpinner 异常传播', async () => {
        configureLogger({ isCI: false, verbose: false, noColor: false });

        let caught = false;
        try {
            await withSpinner('会失败', async () => {
                throw new Error('inner error');
            });
        } catch (error: any) {
            caught = true;
            assert(error.message === 'inner error', `错误消息应为 inner error，实际: ${error.message}`);
        }
        assert(caught, '异常应被传播到调用方');
    });

    // ============================================================
    //  测试 6: withSpinner CI 降级
    // ============================================================
    await runTest('withSpinner CI 降级', async () => {
        configureLogger({ isCI: true, verbose: false, noColor: false });

        let called = false;
        const result = await withSpinner('CI 任务', async () => {
            called = true;
            return 'ok';
        });
        assert(called, 'CI 模式下异步函数应被调用');
        assert(result === 'ok', 'CI 模式下应正确返回值');

        configureLogger({ isCI: false });
    });

    // ============================================================
    //  测试 7: createProgressBar 正常进度
    // ============================================================
    await runTest('createProgressBar 正常进度', () => {
        const bar = createProgressBar(10, { label: '下载中', width: 20 });
        bar.update(0);
        bar.update(5);
        bar.update(10);
        bar.done();
    });

    // ============================================================
    //  测试 8: createProgressBar 边界条件
    // ============================================================
    await runTest('createProgressBar 边界条件', () => {
        // total=0 → 自动修正为 1
        const bar1 = createProgressBar(0);
        bar1.update(0);
        bar1.done();

        // current > total → clamp
        const bar2 = createProgressBar(10);
        bar2.update(20);
        bar2.done();

        // current < 0 → clamp
        const bar3 = createProgressBar(10);
        bar3.update(-5);
        bar3.done();

        // 自定义字符
        const bar4 = createProgressBar(5, {
            label: '处理',
            filledChar: '#',
            emptyChar: '-',
            extra: '{percent}%',
        });
        bar4.update(3);
        bar4.done();
    });

    // ============================================================
    //  测试 9: createProgressBar fail
    // ============================================================
    await runTest('createProgressBar fail', () => {
        const bar = createProgressBar(10);
        bar.update(5);
        bar.fail('下载失败');
    });

    // ============================================================
    //  测试 10: progressTick + clearProgressLine
    // ============================================================
    await runTest('progressTick + clearProgressLine', () => {
        progressTick(0, 5, '扫描');
        progressTick(3, 5, '扫描');
        progressTick(5, 5, '扫描');
        clearProgressLine();

        progressTick(0, 0, '空任务');
        clearProgressLine();
    });

    // ============================================================
    //  测试 11: debug 自动读取 verbose
    // ============================================================
    await runTest('debug 自动读取全局 verbose 配置', () => {
        configureLogger({ verbose: false, isCI: false, noColor: false });
        const r1 = captureConsole(() => logger.debug('auto off'));
        assert(r1.stdout.length === 0, 'verbose=false 时 debug 不应输出');

        configureLogger({ verbose: true, isCI: false, noColor: false });
        const r2 = captureConsole(() => logger.debug('auto on'));
        assert(r2.stdout.some(s => s.includes('auto on')), 'verbose=true 时 debug 应自动输出');

        configureLogger({ verbose: false });
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

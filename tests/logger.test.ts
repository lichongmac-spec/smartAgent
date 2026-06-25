#!/usr/bin/env node
/**
 * 日志与终端交互模块测试
 * 运行: pnpm test:logger
 *
 * 覆盖：
 *   1. 分级日志（info / success / warn / error / debug）
 *   2. configureLogger / getLoggerConfig（含 noColor 影响）
 *   3. logger.timer / logJSON / logErrorJSON / writeError
 *   4. debug 多类型输入（string / Error / object）
 *   5. withSpinner（正常 / 异常 / CI 降级）
 *   6. createProgressBar（正常 / 边界 / fail）
 *   7. progressTick + clearProgressLine
 *
 * 未覆盖（需要 TTY 环境，手工测试）：
 *   - Select / MultiSelect / Confirm / Input / Password
 *   - step / intro / outro
 */

import pc from 'picocolors';

import {
    activeSpinner,
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
        assert(cfg1.noColor === false, 'noColor=explicit false 不应被 CI 覆盖');

        configureLogger({ isCI: false, verbose: false, noColor: false });
        const cfg2 = getLoggerConfig();
        assert(cfg2.verbose === false, '恢复后 verbose 应为 false');
    });

    // ============================================================
    //  测试 3: noColor 模式下的输出（不含颜色/emoji）
    // ============================================================
    await runTest('noColor 模式输出（无 emoji 无颜色）', () => {
        configureLogger({ verbose: true, isCI: false, noColor: true });

        const r1 = captureConsole(() => logger.info('test'));
        assert(!r1.stdout[0].includes('ℹ'), 'noColor 下 info 不应含 ℹ');
        assert(r1.stdout[0].includes('test'), 'noColor 下 info 应保留消息文本');

        const r2 = captureConsole(() => logger.success('ok'));
        assert(!r2.stdout[0].includes('✅'), 'noColor 下 success 不应含 ✅');

        const r3 = captureConsole(() => logger.error('fail'));
        assert(!r3.stderr[0].includes('❌'), 'noColor 下 error 不应含 ❌');

        const r4 = captureConsole(() => logger.debug('dbg'));
        assert(!r4.stdout[0].includes('🔍'), 'noColor 下 debug 不应含 🔍');

        configureLogger({ noColor: false });
    });

    // ============================================================
    //  测试 4: debug 多类型输入
    // ============================================================
    await runTest('debug 支持 Error 和 object 类型', () => {
        configureLogger({ verbose: true, isCI: false, noColor: false });

        // Error 对象
        const r1 = captureConsole(() =>
            logger.debug(new Error('test error'))
        );
        assert(r1.stdout.some(s => s.includes('test error')), 'debug(Error) 应包含消息');
        assert(r1.stdout.some(s => s.includes('Error: test error')), 'debug(Error) 应包含堆栈');

        // 普通对象
        const r2 = captureConsole(() =>
            logger.debug({ key: 'val', num: 42 })
        );
        assert(r2.stdout.some(s => s.includes('"key"')), 'debug(object) 应输出 JSON 格式');
        assert(r2.stdout.some(s => s.includes('42')), 'debug(object) 应包含数值');

        // 空对象
        const r3 = captureConsole(() => logger.debug({}));
        assert(r3.stdout.length > 0, 'debug({}) 应输出');

        configureLogger({ verbose: false });
    });

    // ============================================================
    //  测试 5: logger.timer 性能计时器
    // ============================================================
    await runTest('logger.timer 性能计时器', () => {
        // 颜色模式下：输出了含 ANSI 码的带色文本
        configureLogger({ isCI: false, noColor: false });
        const r = captureConsole(() => {
            const timer = logger.timer('测试任务');
            timer.end();
        });
        assert(r.stdout.some(s => s.includes('测试任务')), 'timer 输出应包含标签');

        // 去 ANSI 码后应能匹配到秒数（如 0.00s）
        const stripped = r.stdout.join('').replace(/\x1b\[[0-9;]*m/g, '');
        assert(/[\d.]+s/.test(stripped), `timer 输出应包含秒数，实际: "${stripped}"`);

        // noColor 模式：纯文本输出
        configureLogger({ noColor: true });
        const r2 = captureConsole(() => {
            const timer = logger.timer('noColor task');
            timer.end();
        });
        assert(r2.stdout.some(s => s.includes('[Timer] noColor task')), 'noColor 下 timer 仍应工作');
        assert(/[\d.]+s/.test(r2.stdout.join('')), 'noColor 下秒数应可匹配');

        configureLogger({ noColor: false });
    });

    // ============================================================
    //  测试 6: logger.logJSON / logErrorJSON
    // ============================================================
    await runTest('结构化日志 logJSON / logErrorJSON', () => {
        // logJSON → stdout
        const r1 = captureConsole(() =>
            logger.logJSON('task_complete', { duration: 123, count: 5 })
        );
        assert(r1.stdout.length === 1, 'logJSON 应输出恰好 1 行');
        const parsed = JSON.parse(r1.stdout[0]);
        assert(parsed.level === 'info', 'level 应为 info');
        assert(parsed.event === 'task_complete', 'event 应为 task_complete');
        assert(parsed.duration === 123, 'duration 应透传');
        assert(parsed.count === 5, 'count 应透传');
        assert(typeof parsed.timestamp === 'string', 'timestamp 存在');

        // logErrorJSON → stderr
        const r2 = captureConsole(() =>
            logger.logErrorJSON('fetch_failed', new Error('timeout'), { url: '/api/data' })
        );
        assert(r2.stderr.length === 1, 'logErrorJSON 应输出到 stderr');
        const parsed2 = JSON.parse(r2.stderr[0]);
        assert(parsed2.level === 'error', 'level 应为 error');
        assert(parsed2.event === 'fetch_failed', 'event 应为 fetch_failed');
        assert(parsed2.error.message === 'timeout', 'error.message 正确');
        assert(parsed2.error.name === 'Error', 'error.name 正确');
        assert(parsed2.url === '/api/data', '额外 data 字段应透传');

        // 无额外 data
        const r3 = captureConsole(() =>
            logger.logJSON('ping')
        );
        const parsed3 = JSON.parse(r3.stdout[0]);
        assert(parsed3.event === 'ping', '无 data 时也能正常工作');
    });

    // ============================================================
    //  测试 7: logger.write / writeError / blank
    // ============================================================
    await runTest('logger.write / writeError / blank', () => {
        // write → stdout
        const origWrite = process.stdout.write;
        let captured = '';
        process.stdout.write = ((chunk: string | Uint8Array, ..._args: any[]) => {
            captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            return true;
        }) as typeof process.stdout.write;

        logger.write('hello');
        process.stdout.write = origWrite;
        assert(captured === 'hello', `write 应输出 'hello'，实际: '${captured}'`);

        // writeError → stderr
        const origErrWrite = process.stderr.write;
        let capturedErr = '';
        process.stderr.write = ((chunk: string | Uint8Array, ..._args: any[]) => {
            capturedErr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            return true;
        }) as typeof process.stderr.write;

        logger.writeError('stderr out');
        process.stderr.write = origErrWrite;
        assert(capturedErr === 'stderr out', `writeError 应输出到 stderr`);

        // blank 不抛异常
        const r = captureConsole(() => logger.blank());
        assert(Array.isArray(r.stdout), 'blank 不应抛异常');
    });

    // ============================================================
    //  测试 8: withSpinner（正常流程）
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
    //  测试 9: withSpinner（异常传播）
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
    //  测试 10: withSpinner CI 降级
    // ============================================================
    await runTest('withSpinner CI 降级', async () => {
        configureLogger({ isCI: true, verbose: false, noColor: false });

        let called = false;
        let spinnerText = '';
        const result = await withSpinner('CI 任务', async (spinner) => {
            called = true;
            spinnerText = spinner.text;
            spinner.text = '更新文案';
            assert(spinner.text === '更新文案', 'mock spinner 应支持 text 读写');
            return 'ok';
        });
        assert(called, 'CI 模式下异步函数应被调用');
        assert(result === 'ok', 'CI 模式下应正确返回值');
        assert(spinnerText === 'CI 任务', 'mock spinner 初始 text 应正确');

        // noColor 模式也应走降级路径
        configureLogger({ isCI: false, noColor: true });
        let called2 = false;
        await withSpinner('noColor 任务', async () => { called2 = true; });
        assert(called2, 'noColor 模式也应正常执行');

        configureLogger({ isCI: false, noColor: false });
    });

    // activeSpinner getter
    await runTest('activeSpinner getter', () => {
        // 无活跃 spinner 时返回 null
        const sp = activeSpinner();
        assert(sp === null, '无活跃 spinner 时应返回 null');
    });

    // ============================================================
    //  测试 11: createProgressBar 正常进度
    // ============================================================
    await runTest('createProgressBar 正常进度', () => {
        const bar = createProgressBar(10, { label: '下载中', width: 20 });
        bar.update(0);
        bar.update(5);
        bar.update(10);
        bar.done();
    });

    // ============================================================
    //  测试 12: createProgressBar 边界条件
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

        // 自定义字符与 extra 模板
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
    //  测试 13: createProgressBar fail
    // ============================================================
    await runTest('createProgressBar fail', () => {
        const bar = createProgressBar(10);
        bar.update(5);

        // fail 带消息
        const r = captureConsole(() => bar.fail('下载失败'));
        assert(r.stdout.some(s => s.includes('下载失败')), 'fail 应输出错误消息');

        // fail 不带消息（仅换行）
        const bar2 = createProgressBar(5);
        bar2.fail();
    });

    // ============================================================
    //  测试 14: progressTick + clearProgressLine
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
    //  测试 15: debug 自动读取全局 verbose 配置
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

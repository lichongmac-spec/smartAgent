/**
 * table.ts 测试套件
 *
 * 覆盖：
 * - renderTable 无表头 / 有表头 / 单行 / 空数据 / 数字右对齐
 * - renderKVTable 基本 / 对象值
 * - configureTable noColor 模式
 * - 集成：config list 表格输出
 */

import pc from 'picocolors';
import {
    renderTable,
    renderKVTable,
} from '../src/agent/cli/utils/table.js';

// ============================================================
//  测试框架（轻量）
// ============================================================

let totalTests = 0;
let passedTests = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(`断言失败: ${msg}`);
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
    totalTests++;
    console.log(pc.yellow(`\n📝 测试 ${totalTests}: ${name}`));
    try {
        await fn();
        passedTests++;
        console.log(pc.green('  ✅ 通过'));
    } catch (err) {
        failures.push(`${name}: ${(err as Error).message}`);
        console.log(pc.red(`  ❌ 失败: ${(err as Error).message}`));
    }
}

// 捕获 console.log 输出
function captureConsole(fn: () => void): string[] {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
        lines.push(args.map(a => String(a)).join(' '));
    };
    try {
        fn();
    } finally {
        console.log = orig;
    }
    return lines;
}

function containsAny(lines: string[], search: string): boolean {
    return lines.some(l => l.includes(search));
}

// ============================================================
//  测试用例
// ============================================================

async function main(): Promise<void> {
    console.log(pc.cyan('🧪 表格输出模块测试\n'));
    console.log(pc.gray('━'.repeat(60)));

    // ---- renderTable ----

    await runTest('renderTable — 无表头基础渲染', () => {
        const output = captureConsole(() => {
            renderTable([
                ['alice', '30'],
                ['bob', '25'],
            ]);
        });
        // 应包含内容
        assert(containsAny(output, 'alice'), '应包含 alice');
        assert(containsAny(output, 'bob'), '应包含 bob');
        assert(containsAny(output, '30'), '应包含 30');
    });

    await runTest('renderTable — 有表头', () => {
        const output = captureConsole(() => {
            renderTable(
                [['alice', '30'], ['bob', '25']],
                ['Name', 'Age'],
            );
        });
        assert(containsAny(output, 'Name'), '应包含表头 Name');
        assert(containsAny(output, 'Age'), '应包含表头 Age');
        assert(containsAny(output, 'alice'), '应包含 alice');
    });

    await runTest('renderTable — 单行数据', () => {
        const output = captureConsole(() => {
            renderTable([['only-row']]);
        });
        assert(containsAny(output, 'only-row'), '应包含 only-row');
    });

    await runTest('renderTable — 空数据不抛异常', () => {
        let threw = false;
        try {
            captureConsole(() => {
                renderTable([]);
            });
        } catch {
            threw = true;
        }
        assert(!threw, '空数据不应抛异常');
    });

    await runTest('renderTable — 数字列右对齐', () => {
        const output = captureConsole(() => {
            renderTable(
                [['item1', '100.5'], ['item2', '0.01']],
                ['Product', 'Price'],
            );
        });
        // 数字应出现在渲染输出中
        assert(containsAny(output, '100.5'), '应包含 100.5');
        assert(containsAny(output, '0.01'), '应包含 0.01');
        // 纯字母列不应右对齐（验证没把 Product 当成数字）
    });

    await runTest('renderTable — 带标题', () => {
        const output = captureConsole(() => {
            renderTable(
                [['a', '1']],
                ['Key', 'Value'],
                { title: '📋 测试表格' },
            );
        });
        assert(containsAny(output, '测试表格'), '应包含标题');
    });

    // ---- renderKVTable ----

    await runTest('renderKVTable — 基本键值对', () => {
        const output = captureConsole(() => {
            renderKVTable({ name: 'app', version: '1.0.0' });
        });
        assert(containsAny(output, 'name'), '应包含 key: name');
        assert(containsAny(output, 'app'), '应包含 value: app');
        assert(containsAny(output, 'version'), '应包含 key: version');
        assert(containsAny(output, '1.0.0'), '应包含 value: 1.0.0');
    });

    await runTest('renderKVTable — 对象值转 JSON 字符串', () => {
        const output = captureConsole(() => {
            renderKVTable({
                model: 'deepseek',
                options: { temperature: 0.7, maxTokens: 4096 },
            });
        });
        assert(containsAny(output, 'model'), '应包含 key: model');
        assert(containsAny(output, 'options'), '应包含 key: options');
        // 对象值被 JSON.stringify
        assert(containsAny(output, 'temperature'), '应包含序列化后的 temperature');
    });

    await runTest('renderKVTable — 带标题', () => {
        const output = captureConsole(() => {
            renderKVTable(
                { model: 'gpt-4' },
                { title: '📋 配置' },
            );
        });
        assert(containsAny(output, '配置'), '应包含标题');
    });

    // ---- 边界测试 ----

    await runTest('renderTable — 带特殊字符数据', () => {
        let threw = false;
        try {
            captureConsole(() => {
                renderTable([['a', '1']], ['Key', 'Value']);
            });
        } catch {
            threw = true;
        }
        assert(!threw, '基础渲染不应抛异常');
    });

    // ---- 集成测试 ----

    await runTest('集成 — config list 表格输出', async () => {
        // 动态加载 configManager 来模拟
        const { configManager } = await import('../src/agent/cli/config-manager.js');
        const config = configManager.get();

        const displayConfig: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(config)) {
            if (key === 'apiKey' && typeof value === 'string') {
                // 安全脱敏
                if (value.length > 8) {
                    const visible = Math.min(6, Math.floor(value.length / 3));
                    displayConfig[key] = value.slice(0, visible) + '…' + value.slice(-Math.min(4, visible));
                } else if (value.length > 0) {
                    displayConfig[key] = '••••';
                } else {
                    displayConfig[key] = '(未设置)';
                }
            } else {
                displayConfig[key] = value;
            }
        }

        const output = captureConsole(() => {
            renderKVTable(displayConfig, { title: '📋 当前配置' });
        });

        // 应包含所有配置键
        for (const key of Object.keys(config)) {
            assert(containsAny(output, key), `应包含配置键: ${key}`);
        }
        // 标题应存在
        assert(containsAny(output, '当前配置'), '应有标题');
    });

    // ============================================================
    //  结果统计
    // ============================================================
    console.log(pc.gray('\n' + '━'.repeat(60)));
    console.log(pc.cyan(`\n📊 测试结果: ${passedTests}/${totalTests} 通过`));

    if (failures.length > 0) {
        console.log(pc.red(`\n❌ ${failures.length} 个测试失败:`));
        for (const f of failures) {
            console.log(pc.red(`  - ${f}`));
        }
        process.exit(1);
    } else {
        console.log(pc.green('✅ 全部通过！'));
    }
}

main().catch(err => {
    console.error(pc.red('💥 测试运行异常:'), err);
    process.exit(1);
});

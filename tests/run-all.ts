/**
 * 运行所有测试套件并汇总结果
 *
 * 用法：
 *   pnpm test:all
 *   npm run test:all
 *
 * 输出格式：
 *   === error-handler ===
 *     ✅ 10/10 通过
 *   === secrets ===
 *     ❌ 1 失败：xxx
 *   ─────────────────────
 *   总计：✅ 246  ❌ 0  用时：1.23s
 */
import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import { resolve, basename } from 'path';

const testDir = resolve('tests');
const files = readdirSync(testDir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();

const tsx = resolve('node_modules/.bin/tsx');

interface Result {
    name: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    duration: number;
}

const results: Result[] = [];
const startAll = Date.now();

for (const file of files) {
    const name = basename(file, '.test.ts');
    const filePath = resolve(testDir, file);
    const start = Date.now();

    const proc = spawnSync(
        `${process.execPath}`,
        [`--import`, `tsx`, filePath],
        {
            cwd: resolve(),
            encoding: 'utf-8',
            timeout: 120_000,
            // 不继承 stdin，避免 readline 测试卡住
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );

    const duration = Date.now() - start;
    const stdout = (proc.stdout || '').trim();
    const stderr = (proc.stderr || '').trim();

    results.push({
        name,
        exitCode: proc.status,
        stdout,
        stderr,
        duration,
    });

    // 实时输出
    const status = proc.status === 0 ? '✅' : '❌';
    const summary = parseSummary(stdout);
    console.log(`=== ${name} ===`);
    if (summary) {
        console.log(`  ${status} ${summary}  (${duration}ms)`);
    } else {
        console.log(`  ${status} exit=${proc.status}  (${duration}ms)`);
        if (stdout) console.log(`  stdout: ${stdout.slice(0, 200)}`);
        if (stderr) console.log(`  stderr: ${stderr.slice(0, 200)}`);
    }
}

const totalDuration = Date.now() - startAll;
const totalPassed = results.reduce((s, r) => s + (parseCount(r.stdout, true) || 0), 0);
const totalFailed = results.reduce((s, r) => s + (parseCount(r.stdout, false) || 0), 0);
const allPassed = results.every((r) => r.exitCode === 0);

console.log('\n' + '━'.repeat(48));
console.log(`  总计：✅ ${totalPassed}  ❌ ${totalFailed}  (${totalDuration}ms)`);
if (!allPassed) {
    console.log('\n失败套件：');
    for (const r of results) {
        if (r.exitCode !== 0) {
            console.log(`  - ${r.name}: exit=${r.exitCode}`);
            if (r.stderr) console.log(`    ${r.stderr.split('\n').slice(-3).join('\n    ')}`);
        }
    }
}
process.exit(allPassed ? 0 : 1);

// ────────────────────────────────────────────────

function parseSummary(stdout: string): string | null {
    // 尝试从输出中提取 "📊 测试结果: 10/10 通过" 或 "✅ 通过: 10  ❌ 失败: 0"
    const m1 = stdout.match(/📊 测试结果:\s*(\d+)\/(\d+)/);
    if (m1) return `${m1[1]}/${m1[2]} 通过`;

    const m2 = stdout.match(/✅ 通过:\s*(\d+)\s+❌ 失败:\s*(\d+)/);
    if (m2) return `✅ ${m2[1]}  ❌ ${m2[2]}`;

    const m3 = stdout.match(/(\d+)\/(\d+) 通过/);
    if (m3) return `${m3[1]}/${m3[2]} 通过`;

    return null;
}

function parseCount(stdout: string, passed: boolean): number | null {
    if (passed) {
        const m = stdout.match(/📊 测试结果:\s*(\d+)\/(\d+)/)
            || stdout.match(/✅ 通过:\s*(\d+)/)
            || stdout.match(/(\d+)\/(\d+) 通过/);
        if (m) return parseInt(m[1], 10);
    } else {
        const m = stdout.match(/❌ 失败:\s*(\d+)/);
        if (m) return parseInt(m[1], 10);
    }
    return null;
}

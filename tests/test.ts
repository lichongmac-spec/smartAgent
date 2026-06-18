/**
 * 一键测试脚本 — 发现并运行所有测试套件
 *
 * 用法：
 *   pnpm test              ← 一键运行全部测试
 *   pnpm test -- --quiet   ← 安静模式（仅显示摘要）
 *   pnpm test -- --only unit  ← 仅运行单元测试
 *
 * 覆盖范围：
 *   tests/*.test.ts            ← 单元测试（22 套件）
 *   tests/integration/*.ts     ← 集成测试（3 套件）
 *   tests/e2e/*.ts             ← 端到端测试（1 套件）
 *
 * 输出格式：
 *   📦 单元测试 (21)
 *     ✅ alias                       123ms
 *     ✅ autocomplete                456ms
 *     ❌ config-manager              789ms
 *       Error: ...
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   套件: ✅ 25 通过  ❌ 1 失败
 *   总计: 12345ms
 */

import { spawnSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { resolve, relative, basename, sep } from 'path';

// ─── 颜色 ───
const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};

// ─── 配置 ───
const ROOT = resolve('tests');
const QUIET = process.argv.includes('--quiet');
const ONLY = (() => {
    const idx = process.argv.indexOf('--only');
    return idx >= 0 ? process.argv[idx + 1] : null;
})();

// ─── 递归搜索所有 .test.ts 文件 ───
function findTestFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            if (entry === 'fixtures' || entry === 'node_modules') continue;
            const full = resolve(dir, entry);
            const stat = statSync(full);
            if (stat.isDirectory()) {
                files.push(...findTestFiles(full));
            } else if (stat.isFile() && entry.endsWith('.test.ts')) {
                files.push(full);
            }
        }
    } catch {
        // 目录不存在，忽略
    }
    return files;
}

// ─── 运行单个测试文件 ───
interface Result {
    name: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
    file: string;
}

function runTest(file: string): Result {
    const start = Date.now();
    const proc = spawnSync(
        process.execPath,
        ['--import', 'tsx', file],
        {
            cwd: resolve('.'),
            encoding: 'utf-8',
            timeout: 120_000,
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    return {
        name: relative(ROOT, file).replace(/\.test\.ts$/, ''),
        exitCode: proc.status ?? -1,
        stdout: (proc.stdout || '').trim(),
        stderr: (proc.stderr || '').trim(),
        duration: Date.now() - start,
        file,
    };
}

// ─── 按目录分组 ───
function classify(file: string): string {
    const rel = relative(ROOT, file);
    if (rel.startsWith('integration' + sep)) return 'integration';
    if (rel.startsWith('e2e' + sep)) return 'e2e';
    return 'unit';
}

// ─── 启动 ───
console.log(`\n${C.bold}${C.cyan}🚀 SmartAgent 一键测试${C.reset}`);
console.log(`${C.dim}  发现 ${findTestFiles(ROOT).length} 个测试套件${C.reset}\n`);

const allFiles = findTestFiles(ROOT);

// 过滤
const toRun = ONLY
    ? allFiles.filter((f) => classify(f) === ONLY)
    : allFiles;

let suitePass = 0;
let suiteFail = 0;
const failures: Result[] = [];
const startAll = Date.now();

// ─── 分组输出 ───
const groups: Record<string, string[]> = {};
for (const f of toRun) {
    const g = classify(f);
    (groups[g] ??= []).push(f);
}

const groupOrder = ['unit', 'integration', 'e2e'];
const groupLabels: Record<string, string> = {
    unit: '📦 单元测试',
    integration: '🔗 集成测试',
    e2e: '🌐 E2E 测试',
};
const groupIcons: Record<string, string> = {
    unit: '  ',
    integration: '',
    e2e: '',
};

for (const key of groupOrder) {
    const files = groups[key];
    if (!files || files.length === 0) continue;

    console.log(`${C.bold}${groupLabels[key]} (${files.length})${C.reset}`);

    for (const file of files) {
        const result = runTest(file);
        const name = result.name.padEnd(40);
        const time = `${result.duration}ms`.padStart(7);

        if (result.exitCode === 0) {
            suitePass++;
            if (!QUIET) {
                const info = extractInfo(result.stdout);
                console.log(`  ${C.green}✅${C.reset} ${name} ${C.dim}${info}${C.reset}`.slice(0, 100));
            }
        } else {
            suiteFail++;
            console.log(`  ${C.red}❌${C.reset} ${name} ${C.dim}${time}${C.reset}`);
            if (!QUIET) {
                const errLine = result.stderr.split('\n').slice(0, 2).join('  ') || result.stdout.slice(-100);
                if (errLine) console.log(`     ${C.red}${errLine.slice(0, 110)}${C.reset}`);
            }
            failures.push(result);
        }
    }
    if (!QUIET) console.log();
}

const elapsed = Date.now() - startAll;

// ─── 汇总 ───
const total = suitePass + suiteFail;
console.log(`${'━'.repeat(56)}`);
if (suiteFail === 0) {
    console.log(`  ${C.green}${C.bold}✅ 全部通过${C.reset}  ${C.dim}${suitePass}/${total} 套件  ·  ${elapsed}ms${C.reset}`);
} else {
    console.log(`  ${C.bold}套件:${C.reset}  ${C.green}✅ ${suitePass}${C.reset}  ${C.red}❌ ${suiteFail}${C.reset}  ${C.dim}·  ${elapsed}ms${C.reset}`);
}

// ─── 详细失败信息 ───
if (failures.length > 0 && QUIET) {
    console.log(`\n${C.bold}${C.red}失败详情:${C.reset}`);
    for (const f of failures) {
        console.log(`  ${C.yellow}▶ ${f.name}${C.reset}`);
        const err = f.stderr || f.stdout;
        for (const line of err.split('\n').slice(-8)) {
            console.log(`    ${C.dim}${line.slice(0, 120)}${C.reset}`);
        }
    }
}

// ─── 知识库链接（如有） ───
if (suiteFail > 0) {
    console.log(`\n${C.dim}小贴士: 单独运行失败套件 → pnpm test:${failures[0]?.name.replace(/^.*\//, '')}${C.reset}\n`);
    process.exit(1);
} else {
    console.log(`\n${C.green}${C.bold}🎉 一切正常！代码质量优秀${C.reset}\n`);
}

// ─── 辅助 ───
function extractInfo(stdout: string): string {
    // 尝试提取测试计数
    const m = stdout.match(/📊 测试结果:\s*(\d+)\/(\d+)/);
    if (m) return `${m[1]}/${m[2]} 通过`;
    const m2 = stdout.match(/✅ 通过:\s*(\d+)\s+❌ 失败:\s*(\d+)/);
    if (m2) return `✅${m2[1]}`;
    // 返回最后一行非空输出
    const lines = stdout.split('\n').filter(Boolean);
    const last = lines[lines.length - 1] || '';
    return last.length > 60 ? last.slice(0, 57) + '...' : last;
}

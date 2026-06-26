#!/usr/bin/env node
/**
 * 错误处理模块测试
 * 运行: pnpm tsx tests/error-handler.test.ts
 */

import pc from 'picocolors';

console.log(pc.cyan('\n🧪 错误处理模块测试\n'));
console.log(pc.gray('━'.repeat(50)));

// ============================================================
//  导入被测试模块
// ============================================================
import {
    AgentError,
    configError,
    errorHandler,
    ExitCode,
    fromError,
    handleError,
    networkError,
    setErrorReporter,
    systemError,
    userError
} from '../src/agent/cli/error-handler.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;

function test(name: string, fn: () => void | Promise<void>) {
    testCount++;
    console.log(pc.yellow(`\n📝 测试 ${testCount}: ${name}`));
    try {
        fn();
        passCount++;
        console.log(pc.green('  ✅ 通过'));
    } catch (error) {
        console.log(pc.red('  ❌ 失败:'), error);
    }
}


// ============================================================
//  测试用例
// ============================================================

// 测试 1: 创建用户错误
test('创建用户错误', () => {
    const error = userError('API Key 无效，请检查');
    if (error.type === 'USER' && error.message === 'API Key 无效，请检查') {
        // 测试通过
    } else {
        throw new Error('用户错误创建失败');
    }
});

// 测试 2: 创建网络错误
test('创建网络错误', () => {
    const error = networkError('连接超时');
    if (error.type === 'NETWORK') {
        // 测试通过
    } else {
        throw new Error('网络错误创建失败');
    }
});

// 测试 3: 创建系统错误（带原因）
test('创建系统错误（带原因）', () => {
    const cause = new Error('原始错误: 文件不存在');
    const error = systemError('读取配置文件失败', { cause });
    if (error.cause === cause && error.type === 'SYSTEM') {
        // 测试通过
    } else {
        throw new Error('系统错误创建失败');
    }
});

// 测试 4: 创建配置错误
test('创建配置错误', () => {
    const error = configError('缺少 apiKey 配置');
    if (error.type === 'CONFIG' && error.code === ExitCode.CONFIG_ERROR) {
        // 测试通过
    } else {
        throw new Error('配置错误创建失败');
    }
});

// 测试 5: 从原生错误转换
test('从原生错误转换', () => {
    const nativeError = new Error('ECONNREFUSED');
    const error = fromError(nativeError, 'NETWORK');
    if (error.type === 'NETWORK' && error.cause === nativeError) {
        // 测试通过
    } else {
        throw new Error('错误转换失败');
    }
});

// 测试 6: 错误链消息
test('错误链消息', () => {
    const cause = new Error('连接被拒绝');
    const error = new AgentError('API 调用失败', { type: 'NETWORK', cause });
    const fullMsg = error.getFullMessage();
    if (fullMsg.includes('API 调用失败') && fullMsg.includes('连接被拒绝')) {
        // 测试通过
    } else {
        throw new Error('错误链消息拼接失败');
    }
});

// ============================================================
//  测试 handleError 输出（捕获输出）
// ============================================================

test('handleError 输出格式（用户错误）', () => {
    const error = userError('API Key 无效');
    let output = '';
    const originalConsoleLog = console.log;
    const originalExit = process.exit;

    // mock console.log 捕获输出
    console.log = ((...args: unknown[]) => {
        output += args.join(' ') + '\n';
    }) as typeof console.log;

    // mock process.exit 防止杀死测试进程
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.exit = ((_code?: number) => {
        throw new Error('EXIT_MOCK');
    }) as any;

    try {
        handleError(error);
    } catch (err: unknown) {
        // handleError 会调用 process.exit，mock 抛出 'EXIT_MOCK'
        if (!(err instanceof Error && err.message === 'EXIT_MOCK')) {
            throw err;
        }
    } finally {
        console.log = originalConsoleLog;
        process.exit = originalExit;
    }

    if (output.includes('API Key 无效')) {
        // 测试通过
    } else {
        throw new Error('handleError 输出格式错误');
    }
});

// 测试 8: AgentError.isType()
test('AgentError.isType() 类型判断', () => {
    const ue = userError('测试');
    const ne = networkError('测试');
    const se = systemError('测试');
    const ce = configError('测试');

    if (!ue.isType('USER')) throw new Error('isType(USER) 应返回 true');
    if (!ne.isType('NETWORK')) throw new Error('isType(NETWORK) 应返回 true');
    if (!se.isType('SYSTEM')) throw new Error('isType(SYSTEM) 应返回 true');
    if (!ce.isType('CONFIG')) throw new Error('isType(CONFIG) 应返回 true');
    if (ue.isType('NETWORK')) throw new Error('cross-type 不应返回 true');
});

// 测试 9: errorHandler 单例便捷入口
test('errorHandler 单例便捷入口', () => {
    if (typeof errorHandler.handle !== 'function') throw new Error('errorHandler.handle 应为函数');
    if (typeof errorHandler.setup !== 'function') throw new Error('errorHandler.setup 应为函数');
    if (typeof errorHandler.setReporter !== 'function') throw new Error('errorHandler.setReporter 应为函数');

    const ue = errorHandler.create.user('测试');
    if (ue.type !== 'USER') throw new Error('errorHandler.create.user 应创建 USER 错误');

    const ce = errorHandler.create.config('测试');
    if (ce.type !== 'CONFIG') throw new Error('errorHandler.create.config 应创建 CONFIG 错误');
});

// 测试 10: setErrorReporter + reportError 预留接口
test('setErrorReporter 预留接口', () => {
    // 验证不抛异常
    try {
        setErrorReporter((err: AgentError) => {
            // 测试用 reporter（不执行实际逻辑）
            void err;
        });
        // 通过：无异常抛出
    } catch {
        throw new Error('setErrorReporter 不应抛异常');
    }
});

// ============================================================
//  测试总结
// ============================================================

console.log(pc.gray('\n━'.repeat(50)));
console.log(pc.cyan(`\n📊 测试结果: ${passCount}/${testCount} 通过`));

if (passCount === testCount) {
    console.log(pc.green('🎉 所有测试通过！\n'));
    process.exit(0);
} else {
    console.log(pc.red(`❌ ${testCount - passCount} 个测试失败\n`));
    process.exit(1);
}
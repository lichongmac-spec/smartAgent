/**
 * tests/skills.test.ts — Skills 系统单元测试
 *
 * 覆盖：
 *  - Skill 类型接口验证
 *  - 从文件夹加载 Skill
 *  - 通过 register() 注册 Skill
 *  - 工具收集（含命名空间前缀）
 *  - 钩子收集
 *  - 依赖检查（缺依赖不加载）
 *  - 重复注册检测
 *  - 工具执行
 *  - 销毁/清理
 *  - integrateSkills 集成流程
 */

import { SkillLoader } from '../src/skills/loader.js';
import { integrateSkills } from '../src/skills/integration.js';
import { emailSkill, weatherSkill } from '../src/skills/index.js';
import type { ISkill } from '../src/skills/types.js';
import type { ToolDefinition } from '../src/llm/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ============================================================
//  测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ ${name}: ${(e as Error).message}`);
  }
}

// ============================================================
//  测试入口
// ============================================================

async function main(): Promise<void> {
  console.log('\n=== Skills 系统测试 ===\n');

  // ── 1. ISkill 接口验证 ──

  await test('emailSkill 实现 ISkill 接口', async () => {
    assert(typeof emailSkill.name === 'string', 'name 应为字符串');
    assert(typeof emailSkill.version === 'string', 'version 应为字符串');
    assert(typeof emailSkill.description === 'string', 'description 应为字符串');
    assert(emailSkill.name === 'email', '名称应为 email');
    assert(emailSkill.version === '1.0.0', '版本应为 1.0.0');
  });

  await test('emailSkill 提供工具', async () => {
    const tools = emailSkill.getTools!();
    assert(tools.length === 1, '应提供 1 个工具');
    assert(tools[0].definition.function.name === 'send_email', '工具名应为 send_email');
  });

  await test('emailSkill 提供钩子', async () => {
    const hooks = emailSkill.getHooks!();
    assert(hooks.length === 1, '应提供 1 个钩子');
    assert(hooks[0].name === 'email-before-chat', '钩子名应为 email-before-chat');
  });

  await test('weatherSkill 实现 ISkill 接口', async () => {
    assert(weatherSkill.name === 'weather', '名称应为 weather');
    assert(weatherSkill.version === '1.0.0', '版本应为 1.0.0');
  });

  // ── 2. SkillLoader.register() 注册 ──

  await test('通过 register() 注册 Skill', async () => {
    const loader = new SkillLoader();
    loader.verbose = false;
    loader.register(emailSkill);
    assert(loader.size === 1, '应注册 1 个 Skill');
    assert(loader.has('email'), '应包含 email');
    assert(loader.get('email') === emailSkill, 'get 应返回正确 Skill');
  });

  await test('重复注册应抛错', async () => {
    const loader = new SkillLoader();
    loader.verbose = false;
    loader.register(emailSkill);
    let threw = false;
    try {
      loader.register(emailSkill);
    } catch {
      threw = true;
    }
    assert(threw, '重复注册应抛错');
  });

  // ── 3. 工具收集（含命名空间） ──

  await test('collectTools 收集 Skill 工具', async () => {
    const loader = new SkillLoader();
    loader.verbose = false;
    loader.register(emailSkill);
    loader.register(weatherSkill);

    const tools = loader.collectTools();
    assert(tools.length === 2, '应收集 2 个工具');
  });

  await test('工具命名空间前缀正确', async () => {
    const loader = new SkillLoader();
    loader.verbose = false;
    loader.register(emailSkill);

    const tools = loader.collectTools();
    const names = tools.map((t) => t.definition.function.name);
    assert(names.includes('email_send_email'), '工具名应有 email_ 前缀');
  });

  // ── 4. 钩子收集 ──

  await test('collectHooks 收集 Skill 钩子', async () => {
    const loader = new SkillLoader();
    loader.verbose = false;
    loader.register(emailSkill);

    const hooks = loader.collectHooks();
    assert(hooks.length === 1, '应收集 1 个钩子');
  });

  // ── 5. 依赖检查 ──

  await test('缺失依赖时 register 应抛错', async () => {
    const skillWithDep: ISkill = {
      name: 'dep-skill',
      version: '1.0.0',
      dependencies: ['nonexistent-skill'],
      getTools: () => [],
    };

    const loader = new SkillLoader();
    loader.verbose = false;
    let threw = false;
    try {
      loader.register(skillWithDep);
    } catch {
      threw = true;
    }
    assert(threw, '缺少依赖应抛错');
    assert(!loader.has('dep-skill'), '依赖缺失的 Skill 不应加载');
  });

  // ── 6. 工具执行 ──

  await test('执行 Skill 工具函数', async () => {
    const tools = emailSkill.getTools!();
    const result = (await tools[0].executor({
      to: 'test@example.com',
      subject: 'Hello',
      body: 'Test email body',
    })) as any;
    assert(result.success === true, '工具应返回成功');
    assert(result.to === 'test@example.com', '收件人应正确');
    assert(typeof result.messageId === 'string', '应有 messageId');
  });

  // ── 7. getAll / 列表 ──

  await test('getAll 返回所有已加载 Skill', async () => {
    const loader = new SkillLoader();
    loader.verbose = false;
    loader.register(emailSkill);
    loader.register(weatherSkill);

    const all = loader.getAll();
    assert(all.length === 2, '应返回 2 个 Skill');
    const names = all.map((s) => s.name).sort();
    assert(names[0] === 'email', '第一个应为 email');
    assert(names[1] === 'weather', '第二个应为 weather');
  });

  // ── 8. 从文件夹加载 ──

  await test('从文件夹加载 Skill', async () => {
    // 创建临时 Skill 目录
    const skillDir = join(tmpdir(), 'skills-test-' + Date.now());
    const testSkillDir = join(skillDir, 'folder-skill');
    mkdirSync(testSkillDir, { recursive: true });

    // 写入 Skill 入口文件
    writeFileSync(
      join(testSkillDir, 'index.js'),
      `
    export default {
      name: 'folder-skill',
      version: '2.0.0',
      description: 'From folder',
      getTools() {
        return [{
          definition: {
            type: 'function',
            function: {
              name: 'folder_tool',
              description: 'A folder-loaded tool',
              parameters: { type: 'object', properties: {} }
            }
          },
          executor: async () => ({ loaded: true })
        }];
      }
    };
    `,
    );

    const loader = new SkillLoader();
    loader.verbose = false;
    await loader.loadFromDirectory(skillDir);

    assert(loader.has('folder-skill'), '应加载 folder-skill');
    const skill = loader.get('folder-skill')!;
    assert(skill.version === '2.0.0', '版本应为 2.0.0');

    // 清理
    rmSync(skillDir, { recursive: true, force: true });
  });

  // ── 9. 目录不存在不报错 ──

  await test('目录不存在时不报错', async () => {
    const loader = new SkillLoader();
    loader.verbose = false;
    await loader.loadFromDirectory('/nonexistent/skills/path');
    assert(loader.size === 0, '不应加载任何 Skill');
  });

  // ── 10. 销毁 ──

  await test('destroyAll 调用 Skill 的 destroy', async () => {
    let destroyed = false;
    const testSkill: ISkill = {
      name: 'destroy-test',
      version: '1.0.0',
      destroy: async () => {
        destroyed = true;
      },
    };

    const loader = new SkillLoader();
    loader.verbose = false;
    loader.register(testSkill);
    await loader.destroyAll();

    assert(destroyed, 'destroy 应被调用');
    assert(loader.size === 0, '销毁后应为空');
  });

  // ── 11. integrateSkills 集成 ──

  await test('integrateSkills 将 Skill 工具注册到 ToolRegistry', async () => {
    const registry = new ToolRegistry();
    registry.verbose = false;

    const loader = await integrateSkills(registry, {
      skills: [emailSkill, weatherSkill],
      verbose: false,
    });

    // 验证工具已注册
    assert(registry.has('email_send_email'), 'email_send_email 应已注册');
    assert(registry.has('weather_get_weather'), 'weather_get_weather 应已注册');

    // 验证 loader 返回
    assert(loader.has('email'), 'loader 应包含 email');
    assert(loader.has('weather'), 'loader 应包含 weather');
  });

  await test('integrateSkills 不覆盖已有同名工具', async () => {
    const registry = new ToolRegistry();
    registry.verbose = false;

    // 先注册一个同名工具
    const existingDef: ToolDefinition = {
      type: 'function' as const,
      function: {
        name: 'email_send_email',
        description: '已有工具',
        parameters: { type: 'object', properties: {} },
      },
    };
    registry.register({ definition: existingDef, executor: async () => 'original' });

    // 然后集成 Skill（应跳过同名工具）
    await integrateSkills(registry, {
      skills: [emailSkill],
      verbose: false,
    });

    // 应仍为原始工具
    const entry = registry.get('email_send_email');
    assert(entry !== undefined, '工具应仍在注册表中');
    assert(entry!.definition.function.description === '已有工具', '应保留原始工具');
  });

  // ── 12. Skill 钩子 beforeChat ──

  await test('beforeChat 钩子正常调用', async () => {
    const hooks = emailSkill.getHooks!();
    const hook = hooks[0];
    assert(typeof hook.beforeChat === 'function', 'beforeChat 应为函数');

    const ctx = { input: 'hello', userId: 'test-user' };
    const result = await hook.beforeChat!(ctx);
    assert(result.input === 'hello', '上下文应保持不变');
    assert(result.userId === 'test-user', 'userId 应保留');
  });

  // ── 结果统计 ──

  console.log('\n' + '━'.repeat(60));
  console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`);
  if (failCount === 0) {
    console.log('🎉 所有测试通过！\n');
  } else {
    console.log('❌ 存在失败测试\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('💥 测试运行异常:', err);
  process.exit(1);
});

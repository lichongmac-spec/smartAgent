/**
 * skills/integration.ts — Skills 与 Agent 集成
 *
 * 理解：这是"胶水代码"——把 SkillLoader 和 Agent 引擎连接起来。
 *
 * 流程：
 * 1. 加载 Skill 目录
 * 2. 收集 Skill 工具 → 注册到 ToolRegistry
 * 3. 收集 Skill 钩子 → 绑定到 LoopEngine 生命周期
 */

import { SkillLoader } from './loader.js';
import type { ISkill } from './types.js';
import type { ToolRegistry } from '../tools/registry.js';

// ============================================================
//  集成配置
// ============================================================

export interface SkillIntegrationConfig {
  /** Skill 目录路径（放 .js 文件的文件夹） */
  skillDir?: string;
  /** 直接传入的 Skill 实例列表（不走文件夹加载） */
  skills?: ISkill[];
  /** 是否打印日志 */
  verbose?: boolean;
}

// ============================================================
//  集成函数
// ============================================================

/**
 * 将 Skills 系统与 Agent 集成
 *
 * @param registry - ToolRegistry 实例
 * @param config - 集成配置
 * @returns SkillLoader 实例（调用方可使用 hooks）
 *
 * @example
 *   const registry = createDefaultToolRegistry();
 *   const loader = await integrateSkills(registry, {
 *     skillDir: './skills',
 *     skills: [emailSkill, weatherSkill],
 *   });
 *   // 现在 Agent 可以使用 Skill 提供的工具了
 */
export async function integrateSkills(
  registry: ToolRegistry,
  config: SkillIntegrationConfig = {},
): Promise<SkillLoader> {
  const loader = new SkillLoader();
  loader.verbose = config.verbose ?? true;

  // 1. 从文件夹加载 Skill（非阻塞）
  if (config.skillDir) {
    await loader.loadFromDirectory(config.skillDir);
  }

  // 2. 注册代码内传入的 Skill
  if (config.skills) {
    for (const skill of config.skills) {
      try {
        loader.register(skill);
      } catch (err) {
        console.error(
          `❌ 注册 Skill "${skill.name}" 失败:`,
          (err as Error).message,
        );
      }
    }
  }

  // 3. 将 Skill 工具注册到 ToolRegistry
  const skillTools = loader.collectTools();
  for (const { definition, executor } of skillTools) {
    try {
      registry.register({ definition, executor });
    } catch (err) {
      // 工具名冲突时跳过（不覆盖已有同名工具）
      console.warn(
        `⚠️  跳过 Skill 工具 "${definition.function.name}": ${(err as Error).message}`,
      );
    }
  }

  return loader;
}

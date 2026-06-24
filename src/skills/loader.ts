/**
 * skills/loader.ts — 技能加载器
 *
 * 理解：就像手机从"应用商店"安装 App，这里从文件夹加载 Skill。
 *
 * 工作原理：
 * 1. 扫描指定目录下的所有子文件夹
 * 2. 每个子文件夹是一个 Skill（入口 index.js / index.ts）
 * 3. 动态 import 模块，校验接口，检查依赖
 * 4. 初始化成功后注册到内部 Map
 *
 * 使用方式：
 *   const loader = new SkillLoader();
 *   await loader.loadFromDirectory('./skills');
 *   const tools = loader.collectTools();   // 收集所有 Skill 的工具
 *   const hooks = loader.collectHooks();   // 收集所有 Skill 的钩子
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { ISkill, IHook, SkillToolEntry } from './types.js';

// ============================================================
//  技能加载器
// ============================================================

export class SkillLoader {
  /** 已加载的 Skill（按名称索引） */
  private skills: Map<string, ISkill> = new Map();

  /** 是否打印加载日志（默认 true） */
  verbose: boolean = true;

  // ── 加载 ──

  /**
   * 从目录加载所有 Skill
   *
   * 约定：
   * - 每个 Skill 是一个子文件夹
   * - 入口文件为 index.js（编译后）或 index.ts
   * - 默认导出（export default）一个符合 ISkill 接口的对象
   *
   * 加载顺序：SkillLoader 不保证加载顺序。依赖管理通过
   * `dependencies` 字段在加载时校验。
   *
   * @param dir - Skill 根目录路径
   */
  async loadFromDirectory(dir: string): Promise<void> {
    const absoluteDir = resolve(dir);

    // 目录不存在则跳过（不报错，方便初次使用）
    if (!this.dirExists(absoluteDir)) {
      if (this.verbose) {
        console.warn(`⚠️  Skill 目录不存在: ${absoluteDir}，跳过加载`);
      }
      return;
    }

    const entries = readdirSync(absoluteDir);

    for (const entry of entries) {
      const fullPath = join(absoluteDir, entry);
      // 跳过非目录文件和无 index 文件的情况
      if (!this.dirExists(fullPath)) continue;
      if (!this.hasEntryFile(fullPath)) {
        if (this.verbose) {
          console.warn(`⚠️  跳过非 Skill 目录（缺少 index.js/ts）: ${fullPath}`);
        }
        continue;
      }
      await this.loadSkillFromFolder(fullPath);
    }

    if (this.verbose) {
      console.log(`📦 共加载 ${this.skills.size} 个 Skill`);
    }
  }

  /**
   * 直接注册一个 Skill 实例（不通过文件夹）
   * 用于代码内直接创建的场景
   */
  register(skill: ISkill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" 已注册，不能重复注册`);
    }

    // 检查依赖
    if (skill.dependencies) {
      for (const dep of skill.dependencies) {
        if (!this.skills.has(dep)) {
          throw new Error(
            `Skill "${skill.name}" 依赖 "${dep}"，但该依赖未被加载。`,
          );
        }
      }
    }

    this.skills.set(skill.name, skill);
    if (this.verbose) {
      console.log(`✅ 注册 Skill: ${skill.name} v${skill.version}`);
    }
  }

  // ── 查询 ──

  /** 获取所有已加载的 Skill */
  getAll(): ISkill[] {
    return Array.from(this.skills.values());
  }

  /** 按名称获取单个 Skill */
  get(name: string): ISkill | undefined {
    return this.skills.get(name);
  }

  /** 检查 Skill 是否已加载 */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** 获取已加载 Skill 的数量 */
  get size(): number {
    return this.skills.size;
  }

  // ── 工具收集 ──

  /**
   * 收集所有 Skill 提供的工具
   *
   * 返回的数组可直接逐个注册到 ToolRegistry：
   *   for (const { definition, executor } of loader.collectTools()) {
   *     registry.register({ definition, executor });
   *   }
   */
  collectTools(): SkillToolEntry[] {
    const tools: SkillToolEntry[] = [];
    for (const skill of this.skills.values()) {
      if (skill.getTools) {
        const skillTools = skill.getTools();
        for (const tool of skillTools) {
          // 用 Skill 名作为名前缀避免冲突
          const originalName = tool.definition.function.name;
          const namespaced = {
            ...tool,
            definition: {
              ...tool.definition,
              function: {
                ...tool.definition.function,
                name: `${skill.name}_${originalName}`,
              },
            },
          };
          tools.push(namespaced);
        }
      }
    }
    return tools;
  }

  // ── 钩子收集 ──

  /**
   * 收集所有 Skill 提供的钩子
   */
  collectHooks(): IHook[] {
    const hooks: IHook[] = [];
    for (const skill of this.skills.values()) {
      if (skill.getHooks) {
        hooks.push(...skill.getHooks());
      }
    }
    return hooks;
  }

  // ── 生命周期 ──

  /**
   * 销毁所有 Skill（释放资源）
   *
   * 销毁顺序与加载顺序相反（后加载先销毁）
   */
  async destroyAll(): Promise<void> {
    const names = Array.from(this.skills.keys()).reverse();
    for (const name of names) {
      const skill = this.skills.get(name);
      if (skill?.destroy) {
        try {
          await skill.destroy();
          if (this.verbose) {
            console.log(`🗑️  销毁 Skill: ${name}`);
          }
        } catch (err) {
          console.error(`❌ 销毁 Skill "${name}" 失败:`, err);
        }
      }
    }
    this.skills.clear();
  }

  // ── 内部方法 ──

  /**
   * 加载单个 Skill 文件夹
   */
  private async loadSkillFromFolder(folderPath: string): Promise<void> {
    try {
      // 尝试加载 index.js / index.ts
      let module: any;
      let loaded = false;

      for (const entryFile of ['index.js', 'index.mjs']) {
        try {
          module = await import(folderPath + '/' + entryFile);
          loaded = true;
          break;
        } catch {
          continue;
        }
      }

      if (!loaded) {
        console.warn(`⚠️  无法加载 Skill 入口: ${folderPath}`);
        return;
      }

      const skill: ISkill = module.default || module;

      // 验证 Skill 接口
      if (!skill || typeof skill.name !== 'string') {
        console.warn(`⚠️  无效的 Skill（缺少 name 属性）: ${folderPath}`);
        return;
      }
      if (typeof skill.version !== 'string') {
        console.warn(`⚠️  Skill "${skill.name}" 缺少 version 属性: ${folderPath}`);
        return;
      }

      // 不允许重复
      if (this.skills.has(skill.name)) {
        console.warn(`⚠️  Skill "${skill.name}" 已加载，跳过: ${folderPath}`);
        return;
      }

      // 注册（会检查依赖）
      this.register(skill);

      // 执行初始化
      if (skill.init) {
        await skill.init();
      }
    } catch (err) {
      console.error(`❌ 加载 Skill 失败 ${folderPath}:`, err);
    }
  }

  /** 检查目录是否存在 */
  private dirExists(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  /** 检查目录中是否有 Skill 入口文件 */
  private hasEntryFile(folderPath: string): boolean {
    return (
      existsSync(join(folderPath, 'index.js')) ||
      existsSync(join(folderPath, 'index.ts')) ||
      existsSync(join(folderPath, 'index.mjs'))
    );
  }
}

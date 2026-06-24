/**
 * skills/index.ts — Skills 系统统一导出
 */

// 类型
export type { ISkill, IHook, SkillContext, SkillToolEntry } from './types.js';

// 加载器
export { SkillLoader } from './loader.js';

// 示例 Skill（方便快速上手）
export { default as emailSkill } from './examples/email-skill.js';
export { default as weatherSkill } from './examples/weather-skill.js';

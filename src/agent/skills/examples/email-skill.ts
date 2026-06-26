/**
 * skills/examples/email-skill.ts — 邮件发送 Skill 示例
 *
 * 理解：这是一个"发邮件"技能包，AI Agent 加载后就可以帮用户发邮件。
 * 真实项目可替换 sendEmail 内部实现为 nodemailer 或 SendGrid API。
 *
 * 使用：
 *   import emailSkill from './email-skill.js';
 *   loader.register(emailSkill);
 */

import type { ToolDefinition } from '../../llm/types.js';
import type { ToolExecutor } from '../../tools/registry.js';
import type { ISkill, SkillContext } from '../types.js';

// ============================================================
//  工具实现
// ============================================================

/** 发送邮件（模拟 SMTP） */
const sendEmail: ToolExecutor = async (args) => {
  const { to, subject, body } = args as { to: string; subject: string; body: string };

  // 真实项目中可接入 nodemailer 等 SMTP 库实现邮件发送
  console.log(`📧 [Email Skill] 发送邮件到 ${to}`);
  console.log(`   主题: ${subject}`);
  console.log(`   正文: ${body.slice(0, 80)}...`);

  return {
    success: true,
    messageId: `msg_${Date.now()}`,
    to,
    subject,
    sentAt: new Date().toISOString(),
  };
};

// ============================================================
//  工具定义（JSON Schema / OpenAI Function Calling 格式）
// ============================================================

const sendEmailDefinition: ToolDefinition = {
  type: 'function' as const,
  function: {
    name: 'send_email',
    description: '发送邮件给指定收件人',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '收件人邮箱地址，如 user@example.com' },
        subject: { type: 'string', description: '邮件主题' },
        body: { type: 'string', description: '邮件正文内容' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
};

// ============================================================
//  Skill 导出
// ============================================================

const emailSkill: ISkill = {
  name: 'email',
  version: '1.0.0',
  description: '邮件发送技能（SMTP 模拟）',

  getTools() {
    return [{ definition: sendEmailDefinition, executor: sendEmail }];
  },

  getHooks() {
    return [
      {
        name: 'email-before-chat',
        beforeChat: async (ctx: SkillContext) => {
          console.log(
            `[Email Skill] 对话开始，用户: ${ctx.userId || '匿名'}`,
          );
          return ctx;
        },
      },
    ];
  },
};

export default emailSkill;

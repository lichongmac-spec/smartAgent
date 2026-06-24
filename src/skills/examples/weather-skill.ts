/**
 * skills/examples/weather-skill.ts — 天气查询 Skill 示例
 *
 * 理解：这是一个"查天气"技能包，AI Agent 加载后就可以帮用户查天气。
 * 真实项目可调用 wttr.in 或 OpenWeatherMap API。
 *
 * 使用：
 *   import weatherSkill from './weather-skill.js';
 *   loader.register(weatherSkill);
 */

import type { ISkill } from '../types.js';
import type { ToolExecutor } from '../../tools/registry.js';
import type { ToolDefinition } from '../../llm/types.js';

// ============================================================
//  工具实现
// ============================================================

/** 天气条件池（模拟） */
const CONDITIONS = ['晴 ☀️', '多云 ⛅', '小雨 🌧️', '阴天 ☁️', '阵雨 🌦️'] as const;

/** 查询城市天气（模拟公开 API） */
const getWeather: ToolExecutor = async (args) => {
  const { city } = args as { city: string };

  // 真实项目可调用：
  // const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
  // const data = await res.json();
  const temperature = Math.round(Math.random() * 20 + 10); // 10-30°C
  const condition = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)];

  return {
    success: true,
    city,
    temperature,
    condition,
    humidity: Math.round(Math.random() * 40 + 40), // 40-80%
    message: `${city} 今日${condition}，气温 ${temperature}°C，湿度 ${Math.round(Math.random() * 40 + 40)}%`,
    updatedAt: new Date().toISOString(),
  };
};

// ============================================================
//  工具定义
// ============================================================

const getWeatherDefinition: ToolDefinition = {
  type: 'function' as const,
  function: {
    name: 'get_weather',
    description: '查询指定城市的实时天气信息，包括温度、天气状况和湿度',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称，如 "北京"、"上海"、"Tokyo"',
        },
      },
      required: ['city'],
    },
  },
};

// ============================================================
//  Skill 导出
// ============================================================

const weatherSkill: ISkill = {
  name: 'weather',
  version: '1.0.0',
  description: '天气查询技能（模拟公开 API）',

  getTools() {
    return [{ definition: getWeatherDefinition, executor: getWeather }];
  },
};

export default weatherSkill;

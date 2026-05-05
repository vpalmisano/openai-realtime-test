import type { FunctionTool } from "@openai/agents/realtime";

export const getWeatherTool: FunctionTool = {
  type: 'function',
  name: 'get_weather',
  description: 'Get the current weather for a given location.',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'The city and country, e.g. "Rome, Italy"',
      },
    },
    required: ['location'],
    additionalProperties: false,
  },
  invoke: async (_ctx, input) => {
    const { location } = JSON.parse(input);
    const conditions = ['sunny', 'cloudy', 'rainy', 'snowy', 'windy', 'partly cloudy'];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temperature = Math.floor(Math.random() * 35) + 5;
    const humidity = Math.floor(Math.random() * 60) + 30;
    console.log('get_weather', location, temperature, condition, humidity);
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log('get_weather done', location, temperature, condition, humidity);
    return JSON.stringify({
      location,
      temperature_c: temperature,
      condition,
      humidity_percent: humidity,
    });
  },
  isEnabled: async () => true,
  needsApproval: async () => false,
  strict: false,
};

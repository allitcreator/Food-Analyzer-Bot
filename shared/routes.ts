import { z } from 'zod';
import { insertFoodLogSchema, foodLogs, users } from './schema';

export const api = {
  stats: {
    get: {
      method: 'GET' as const,
      path: '/api/stats' as const,
      responses: {
        200: z.object({
          dailyCalories: z.number(),
          dailyProtein: z.number(),
          dailyFat: z.number(),
          dailyCarbs: z.number(),
          weeklyCalories: z.array(z.object({
            date: z.string(),
            calories: z.number()
          }))
        })
      }
    }
  },
  logs: {
    list: {
      method: 'GET' as const,
      path: '/api/logs' as const,
      responses: {
        200: z.array(z.custom<typeof foodLogs.$inferSelect>())
      }
    },
    create: {
      method: 'POST' as const,
      path: '/api/logs' as const,
      input: insertFoodLogSchema,
      responses: {
        201: z.custom<typeof foodLogs.$inferSelect>(),
        400: z.object({ message: z.string() })
      }
    }
  }
};

import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";

export type StatsResponse = {
  dailyCalories: number;
  dailyProtein: number;
  dailyFat: number;
  dailyCarbs: number;
  weeklyCalories: {
    date: string;
    calories: number;
  }[];
};

export function useStats() {
  return useQuery<StatsResponse>({
    queryKey: [api.stats.get.path],
    queryFn: async () => {
      const res = await fetch(api.stats.get.path);
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      return api.stats.get.responses[200].parse(data);
    },
  });
}

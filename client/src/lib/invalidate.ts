import type { QueryClient } from "@tanstack/react-query";

/**
 * После записи/удаления еды и воды устаревают и день, и недельная статистика
 * (столбики на «Сегодня», в «Истории» и «Трендах»). refetchType:"all" — экраны
 * под шторкой или на другой вкладке неактивны, иначе останутся stale.
 */
export function invalidateDiary(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["day"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["stats"], refetchType: "all" });
}

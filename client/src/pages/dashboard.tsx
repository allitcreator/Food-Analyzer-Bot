import { useStats } from "@/hooks/use-stats";
import { useFoodLogs } from "@/hooks/use-logs";
import { MacroCard } from "@/components/macro-card";
import { AddFoodDialog } from "@/components/add-food-dialog";
import { Flame, Beef, Droplet, Wheat, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format } from "date-fns";
import { motion } from "framer-motion";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: logs, isLoading: logsLoading } = useFoodLogs();

  if (statsLoading || logsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground font-medium animate-pulse">Loading nutrition data...</p>
        </div>
      </div>
    );
  }

  // Fallback data if null
  const safeStats = stats || {
    dailyCalories: 0,
    dailyProtein: 0,
    dailyFat: 0,
    dailyCarbs: 0,
    weeklyCalories: [],
  };

  const chartData = safeStats.weeklyCalories.map(item => ({
    ...item,
    formattedDate: format(new Date(item.date), "EEE"),
  }));

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header Section */}
      <header className="sticky top-0 z-10 glass-panel border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Activity className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-xl font-bold font-display bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
              NutriTrack
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-block text-sm text-muted-foreground">
              Hello, User
            </span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-purple-400" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Title & Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold font-display text-foreground">Overview</h2>
            <p className="text-muted-foreground mt-1">Track your daily nutrition goals.</p>
          </div>
          <AddFoodDialog />
        </div>

        {/* Macro Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MacroCard
            title="Calories"
            amount={safeStats.dailyCalories}
            unit="kcal"
            icon={Flame}
            colorClass="text-orange-500"
            total={2500} // Daily Goal Example
          />
          <MacroCard
            title="Protein"
            amount={safeStats.dailyProtein}
            unit="g"
            icon={Beef}
            colorClass="text-red-500"
            total={180}
          />
          <MacroCard
            title="Fats"
            amount={safeStats.dailyFat}
            unit="g"
            icon={Droplet}
            colorClass="text-yellow-500"
            total={70}
          />
          <MacroCard
            title="Carbs"
            amount={safeStats.dailyCarbs}
            unit="g"
            icon={Wheat}
            colorClass="text-blue-500"
            total={300}
          />
        </div>

        {/* Charts & Recent Logs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Weekly Chart */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-2 bg-card rounded-3xl p-6 shadow-lg border border-border/50"
          >
            <h3 className="text-xl font-bold font-display mb-6">Weekly Activity</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis 
                    dataKey="formattedDate" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <Tooltip 
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: 'none', 
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                      backgroundColor: 'hsl(var(--card))'
                    }}
                  />
                  <Bar dataKey="calories" radius={[6, 6, 0, 0]} barSize={40}>
                    {chartData.map((_, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={index === chartData.length - 1 ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.3)'} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Recent Logs List */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-card rounded-3xl p-6 shadow-lg border border-border/50 flex flex-col h-[400px]"
          >
            <h3 className="text-xl font-bold font-display mb-4">Recent Meals</h3>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {logs?.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                  <p>No meals logged yet.</p>
                  <p className="text-sm">Start by adding your first meal!</p>
                </div>
              ) : (
                logs?.map((log) => (
                  <div 
                    key={log.id} 
                    className="p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors group"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                          {log.foodName}
                        </h4>
                        <p className="text-xs text-muted-foreground capitalize">
                          {log.mealType} • {log.weight}g
                        </p>
                      </div>
                      <span className="font-bold text-sm text-primary bg-primary/10 px-2 py-1 rounded-md">
                        {log.calories} kcal
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

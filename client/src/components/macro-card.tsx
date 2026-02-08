import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface MacroCardProps {
  title: string;
  amount: number;
  unit: string;
  icon: LucideIcon;
  colorClass: string;
  total?: number;
}

export function MacroCard({ title, amount, unit, icon: Icon, colorClass, total }: MacroCardProps) {
  const percentage = total ? Math.min((amount / total) * 100, 100) : 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-2xl p-6 shadow-sm border border-border/50 hover:shadow-md transition-all duration-300"
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-xl bg-opacity-10 ${colorClass} bg-current`}>
          <Icon className={`w-6 h-6 ${colorClass} text-current`} />
        </div>
        <span className="text-2xl font-bold font-display">{amount}</span>
      </div>
      
      <div className="space-y-1">
        <div className="flex justify-between text-sm text-muted-foreground font-medium">
          <span>{title}</span>
          <span>{unit}</span>
        </div>
        
        {total && (
          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className={`h-full ${colorClass} bg-current rounded-full`} 
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

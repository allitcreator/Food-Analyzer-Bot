import PDFDocument from "pdfkit";
import path from "path";
import type { User, FoodLog, WeightLog } from "@shared/schema";

const FONT_REGULAR = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf", "DejaVuSans-Bold.ttf");

interface WeekStat {
  weekLabel: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  days: number;
}

interface DayStat {
  dayLabel: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

interface MealDist { meal: string; calories: number }
interface DowAvg { day: string; calories: number; protein: number; fat: number; carbs: number }
interface WorkoutStats { totalBurned: number; types: { type: string; count: number; burned: number }[]; avgPerDay: number }

export function generateMonthlyPDF(
  user: User,
  weeklyStats: WeekStat[],
  dailyStats: DayStat[],
  weightLogs: WeightLog[],
  topFoods: { name: string; count: number }[],
  mealDistribution?: MealDist[],
  dayOfWeekAverages?: DowAvg[],
  stabilityCV?: number,
  workoutStats?: WorkoutStats
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Register fonts
    doc.registerFont("Regular", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    // ── Colors ────────────────────────────────────────────────────
    const PRIMARY = "#2D6A4F";
    const ACCENT = "#52B788";
    const LIGHT = "#D8F3DC";
    const GRAY = "#6B7280";
    const DARK = "#1B1B1B";
    const BG = "#F9FAFB";
    const W = 595 - 100;

    // ── Header ────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 160).fill(PRIMARY);
    doc.fillColor("white").font("Bold").fontSize(24)
      .text("Отчёт о питании", 50, 52, { align: "center", width: W });

    const monthName = new Date().toLocaleString("ru-RU", { month: "long", year: "numeric" });
    doc.fontSize(13).font("Regular")
      .text(monthName.charAt(0).toUpperCase() + monthName.slice(1), 50, 88, { align: "center", width: W });
    if (user.username) {
      doc.fontSize(11).text(`@${user.username}`, 50, 114, { align: "center", width: W });
    }

    // ── Summary boxes ─────────────────────────────────────────────
    const totalActiveDays = weeklyStats.reduce((s, w) => s + w.days, 0);
    const activeWeeks = weeklyStats.filter(w => w.days > 0);
    const avgCal = activeWeeks.length > 0
      ? Math.round(activeWeeks.reduce((s, w) => s + w.calories, 0) / activeWeeks.length)
      : 0;

    const boxes = [
      { label: "Дней\nзалогировано", value: String(totalActiveDays) },
      { label: "Ср. калорий\nв день", value: avgCal > 0 ? String(avgCal) : "—" },
      { label: "Цель\n(ккал)", value: user.caloriesGoal ? String(user.caloriesGoal) : "—" },
      { label: "Замеров\nвеса", value: String(weightLogs.length) },
    ];

    const boxW = (W - 30) / 4;
    boxes.forEach((b, i) => {
      const x = 50 + i * (boxW + 10);
      doc.rect(x, 175, boxW, 70).fillAndStroke(LIGHT, ACCENT);
      doc.fillColor(PRIMARY).font("Bold").fontSize(19)
        .text(b.value, x, 189, { width: boxW, align: "center" });
      doc.fillColor(GRAY).font("Regular").fontSize(8)
        .text(b.label, x, 211, { width: boxW, align: "center" });
    });

    let y = 265;

    // ── Helpers ───────────────────────────────────────────────────
    const ensureSpace = (needed: number) => {
      if (y + needed > 745) { doc.addPage(); y = 50; }
    };

    const sectionTitle = (title: string) => {
      ensureSpace(40);
      doc.rect(50, y, W, 26).fill(PRIMARY);
      doc.fillColor("white").font("Bold").fontSize(12)
        .text(title, 58, y + 7, { width: W - 10 });
      y += 34;
    };

    const drawBarChart = (
      data: { label: string; value: number }[],
      maxVal: number,
      barColor: string,
      chartH = 100
    ) => {
      ensureSpace(chartH + 40);
      const n = data.length;
      const barW = Math.min(40, (W - 20) / n - 6);
      const gap = (W - n * barW) / (n + 1);

      data.forEach((item, i) => {
        const bx = 50 + gap * (i + 1) + i * barW;
        const ratio = maxVal > 0 ? item.value / maxVal : 0;
        const bh = Math.max(ratio * chartH, item.value > 0 ? 2 : 0);
        const by = y + chartH - bh;

        doc.rect(bx, by, barW, bh).fill(barColor);

        if (item.value > 0) {
          doc.fillColor(DARK).font("Regular").fontSize(7)
            .text(String(item.value), bx - 2, by - 11, { width: barW + 4, align: "center" });
        }
        doc.fillColor(GRAY).font("Regular").fontSize(7)
          .text(item.label, bx - 4, y + chartH + 4, { width: barW + 8, align: "center" });
      });

      doc.moveTo(50, y).lineTo(50 + W, y).strokeColor(LIGHT).lineWidth(0.5).stroke();
      y += chartH + 28;
    };

    // ── Weekly calorie chart ──────────────────────────────────────
    sectionTitle("Калории по неделям (среднее в день)");
    const maxWeekCal = Math.max(...weeklyStats.map(w => w.calories), user.caloriesGoal || 0, 1);
    drawBarChart(
      weeklyStats.map(w => ({ label: w.weekLabel, value: w.calories })),
      maxWeekCal, ACCENT, 110
    );
    if (user.caloriesGoal) {
      doc.fillColor(GRAY).font("Regular").fontSize(9)
        .text(`Цель: ${user.caloriesGoal} ккал/день`, 50, y - 18, { align: "right", width: W });
    }

    // ── КБЖУ table ────────────────────────────────────────────────
    sectionTitle("КБЖУ по неделям (среднее в день)");
    const cols = [
      { label: "Неделя", w: 130 }, { label: "Дней", w: 45 }, { label: "Ккал", w: 60 },
      { label: "Белки г", w: 60 }, { label: "Жиры г", w: 60 }, { label: "Углев г", w: 60 },
    ];
    ensureSpace(20 + weeklyStats.length * 18 + 10);
    let tx = 50;
    doc.rect(50, y, W, 20).fill(PRIMARY);
    cols.forEach(c => {
      doc.fillColor("white").font("Bold").fontSize(8)
        .text(c.label, tx + 4, y + 6, { width: c.w - 4 });
      tx += c.w;
    });
    y += 20;

    weeklyStats.forEach((wk, idx) => {
      ensureSpace(18);
      doc.rect(50, y, W, 18).fill(idx % 2 === 0 ? BG : "white");
      const row = [wk.weekLabel, String(wk.days), String(wk.calories), String(wk.protein), String(wk.fat), String(wk.carbs)];
      let rx = 50;
      row.forEach((cell, ci) => {
        doc.fillColor(DARK).font("Regular").fontSize(8)
          .text(cell, rx + 4, y + 5, { width: cols[ci].w - 4 });
        rx += cols[ci].w;
      });
      y += 18;
    });
    y += 10;

    // ── Daily chart (last 7 days) ─────────────────────────────────
    if (dailyStats.length > 0) {
      sectionTitle("Калории по дням (последние 7 дней)");
      const maxDayCal = Math.max(...dailyStats.map(d => d.calories), user.caloriesGoal || 0, 1);
      drawBarChart(
        dailyStats.map(d => ({ label: d.dayLabel, value: d.calories })),
        maxDayCal, "#95D5B2", 100
      );
    }

    // ── Weight dynamics ───────────────────────────────────────────
    if (weightLogs.length >= 2) {
      sectionTitle("Динамика веса");
      const sorted = [...weightLogs].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
      const minW = Math.min(...sorted.map(l => l.weight)) - 1;
      const maxW = Math.max(...sorted.map(l => l.weight)) + 1;
      const chartH = 100;

      ensureSpace(chartH + 50);

      for (let g = 0; g <= 4; g++) {
        const gy = y + chartH - (g / 4) * chartH;
        const gv = minW + (g / 4) * (maxW - minW);
        doc.moveTo(50, gy).lineTo(50 + W, gy).strokeColor(LIGHT).lineWidth(0.5).stroke();
        doc.fillColor(GRAY).font("Regular").fontSize(7)
          .text(gv.toFixed(1), 16, gy - 4, { width: 30, align: "right" });
      }

      const points = sorted.map((l, i) => ({
        x: 50 + (i / Math.max(sorted.length - 1, 1)) * W,
        yp: y + chartH - ((l.weight - minW) / Math.max(maxW - minW, 0.1)) * chartH,
      }));

      doc.strokeColor(PRIMARY).lineWidth(2);
      points.forEach((p, i) => { if (i === 0) doc.moveTo(p.x, p.yp); else doc.lineTo(p.x, p.yp); });
      doc.stroke();

      points.forEach((p, i) => {
        doc.circle(p.x, p.yp, 3).fill(ACCENT);
        const d = new Date(sorted[i].date!);
        const dl = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
        doc.fillColor(GRAY).font("Regular").fontSize(7)
          .text(dl, p.x - 13, y + chartH + 5, { width: 28, align: "center" });
        doc.fillColor(DARK).fontSize(7)
          .text(sorted[i].weight.toFixed(1), p.x - 13, p.yp - 14, { width: 28, align: "center" });
      });

      const delta = sorted[sorted.length - 1].weight - sorted[0].weight;
      const deltaStr = (delta > 0 ? "+" : "") + delta.toFixed(1) + " кг";
      const deltaColor = delta > 0 ? "#EF4444" : "#22C55E";
      doc.fillColor(deltaColor).font("Bold").fontSize(12)
        .text(`Изменение за период: ${deltaStr}`, 50, y + chartH + 22, { align: "center", width: W });
      y += chartH + 42;
    }

    // ── Nutrition ↔ Weight correlation ───────────────────────────
    if (user.caloriesGoal && weeklyStats.some(w => w.days > 0) && weightLogs.length >= 1) {
      sectionTitle("Питание и динамика веса");

      // Recompute week date ranges (same algorithm as storage.getMonthlyStats)
      const today2 = new Date();
      const weekRanges: { start: Date; end: Date }[] = [];
      for (let w = 3; w >= 0; w--) {
        const weekEnd = new Date(today2);
        weekEnd.setDate(today2.getDate() - w * 7);
        weekEnd.setHours(23, 59, 59, 999);
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekEnd.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);
        weekRanges.push({ start: weekStart, end: weekEnd });
      }

      const sortedWL = [...weightLogs].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

      // Find nearest weight on or before a given date
      const weightBefore = (date: Date): number | null => {
        const ts = date.getTime();
        const cands = sortedWL.filter(l => new Date(l.date!).getTime() <= ts);
        return cands.length > 0 ? cands[cands.length - 1].weight : null;
      };
      // Find nearest weight on or after a given date
      const weightAfter = (date: Date): number | null => {
        const ts = date.getTime();
        const cands = sortedWL.filter(l => new Date(l.date!).getTime() >= ts);
        return cands.length > 0 ? cands[0].weight : null;
      };

      // Per-week: avg cal, deficit, weight start/end
      interface WeekCorr {
        label: string;
        avgCal: number;
        balance: number; // negative = deficit (goal - avgCal), positive = surplus
        wStart: number | null;
        wEnd: number | null;
        wDelta: number | null;
        hasFood: boolean;
      }
      const corr: WeekCorr[] = weekRanges.map((r, i) => {
        const wk = weeklyStats[i];
        const balance = wk.days > 0 ? wk.calories - (user.caloriesGoal ?? 0) : 0;
        const wStart = weightBefore(r.start) ?? weightAfter(r.start);
        const wEnd = weightBefore(r.end);
        const wDelta = wStart != null && wEnd != null ? wEnd - wStart : null;
        return {
          label: wk.weekLabel,
          avgCal: wk.calories,
          balance,
          wStart,
          wEnd,
          wDelta,
          hasFood: wk.days > 0,
        };
      });

      // ── Caloric balance bar chart ─────────────────────────────
      const hasBalance = corr.some(c => c.hasFood && c.balance !== 0);
      if (hasBalance) {
        const maxAbs = Math.max(...corr.filter(c => c.hasFood).map(c => Math.abs(c.balance)), 1);
        const chartH2 = 80;
        const halfH = chartH2 / 2;
        ensureSpace(chartH2 + 60);

        // Baseline (zero = goal)
        const baseY = y + halfH;
        doc.moveTo(50, baseY).lineTo(50 + W, baseY).strokeColor(LIGHT).lineWidth(0.8).stroke();
        doc.fillColor(GRAY).font("Regular").fontSize(7).text("Цель", 16, baseY - 4, { width: 30, align: "right" });

        const n2 = corr.length;
        const barW2 = Math.min(50, (W - 20) / n2 - 10);
        const gap2 = (W - n2 * barW2) / (n2 + 1);

        corr.forEach((c, i) => {
          const bx = 50 + gap2 * (i + 1) + i * barW2;
          if (!c.hasFood) {
            doc.fillColor(LIGHT).font("Regular").fontSize(7).text("—", bx, baseY - 4, { width: barW2, align: "center" });
          } else {
            const ratio = c.balance / maxAbs;
            const bh = Math.abs(ratio) * halfH;
            const isSurplus = c.balance > 0;
            const barColor = isSurplus ? "#F87171" : "#4ADE80"; // red=surplus, green=deficit
            const barY = isSurplus ? baseY : baseY - bh;
            doc.rect(bx, barY, barW2, bh).fill(barColor);
            const labelVal = (c.balance > 0 ? "+" : "") + c.balance;
            doc.fillColor(DARK).font("Regular").fontSize(7)
              .text(labelVal, bx - 2, isSurplus ? baseY + bh + 2 : baseY - bh - 11, { width: barW2 + 4, align: "center" });
          }
          doc.fillColor(GRAY).font("Regular").fontSize(7)
            .text(c.label, bx - 4, y + chartH2 + 12, { width: barW2 + 8, align: "center" });
        });

        doc.fillColor(GRAY).font("Regular").fontSize(8)
          .text("Зелёный = дефицит ккал (меньше цели)  •  Красный = профицит (больше цели)", 50, y + chartH2 + 24, { align: "center", width: W });
        y += chartH2 + 40;
      }

      // ── Correlation table ─────────────────────────────────────
      const tCols = [
        { label: "Неделя",     w: 105 },
        { label: "Ср. ккал",   w: 65  },
        { label: "Баланс",     w: 65  },
        { label: "Вес нач.",   w: 65  },
        { label: "Вес кон.",   w: 65  },
        { label: "Δ вес",      w: 55  },
        { label: "Итог",       w: 75  },
      ];
      ensureSpace(20 + corr.length * 20 + 20);
      let ttx = 50;
      doc.rect(50, y, W, 20).fill(PRIMARY);
      tCols.forEach(c => {
        doc.fillColor("white").font("Bold").fontSize(8).text(c.label, ttx + 4, y + 6, { width: c.w - 4 });
        ttx += c.w;
      });
      y += 20;

      corr.forEach((c, idx) => {
        ensureSpace(20);
        doc.rect(50, y, W, 20).fill(idx % 2 === 0 ? BG : "white");

        const balStr = !c.hasFood ? "—" : (c.balance > 0 ? "+" : "") + c.balance + " ккал";
        const wStartStr = c.wStart != null ? c.wStart.toFixed(1) + " кг" : "—";
        const wEndStr   = c.wEnd   != null ? c.wEnd.toFixed(1)   + " кг" : "—";
        let deltaStr = "—";
        let verdict = "—";
        let verdictColor = GRAY;
        if (c.wDelta != null) {
          deltaStr = (c.wDelta > 0 ? "+" : "") + c.wDelta.toFixed(1) + " кг";
          if (c.wDelta < -0.1) { verdict = "Снижение"; verdictColor = "#22C55E"; }
          else if (c.wDelta > 0.1) { verdict = "Рост"; verdictColor = "#EF4444"; }
          else { verdict = "Стабильно"; verdictColor = GRAY; }
        }

        const row = [c.label, c.hasFood ? String(c.avgCal) : "—", balStr, wStartStr, wEndStr, deltaStr];
        let rx = 50;
        row.forEach((cell, ci) => {
          const isBalance = ci === 2;
          let color = DARK;
          if (isBalance && c.hasFood) color = c.balance > 0 ? "#EF4444" : c.balance < 0 ? "#16A34A" : DARK;
          doc.fillColor(color).font("Regular").fontSize(8).text(cell, rx + 4, y + 6, { width: tCols[ci].w - 4 });
          rx += tCols[ci].w;
        });
        // Verdict column
        doc.fillColor(verdictColor).font("Bold").fontSize(8).text(verdict, rx + 4, y + 6, { width: tCols[6].w - 4 });
        y += 20;
      });

      // ── Insight text ──────────────────────────────────────────
      const deficitWeeks = corr.filter(c => c.hasFood && c.balance < -50 && c.wDelta != null);
      const surplusWeeks = corr.filter(c => c.hasFood && c.balance > 50  && c.wDelta != null);
      const insights: string[] = [];
      if (deficitWeeks.length > 0) {
        const avgDelta = deficitWeeks.reduce((s, c) => s + (c.wDelta ?? 0), 0) / deficitWeeks.length;
        insights.push(`В неделях с дефицитом калорий вес менялся в среднем на ${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(1)} кг.`);
      }
      if (surplusWeeks.length > 0) {
        const avgDelta = surplusWeeks.reduce((s, c) => s + (c.wDelta ?? 0), 0) / surplusWeeks.length;
        insights.push(`В неделях с профицитом вес менялся на ${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(1)} кг.`);
      }
      if (insights.length > 0) {
        ensureSpace(30);
        y += 8;
        doc.rect(50, y, W, insights.length * 16 + 12).fillAndStroke(LIGHT, ACCENT);
        doc.fillColor(PRIMARY).font("Bold").fontSize(9);
        insights.forEach((ins, i) => {
          doc.text(ins, 60, y + 8 + i * 16, { width: W - 20 });
        });
        y += insights.length * 16 + 20;
      } else {
        y += 10;
      }
    }

    // ── Meal distribution pie chart ──────────────────────────────
    if (mealDistribution && mealDistribution.length > 0) {
      const totalMealCal = mealDistribution.reduce((s, m) => s + m.calories, 0);
      if (totalMealCal > 0) {
        sectionTitle("Распределение калорий по приёмам пищи");
        const mealColors: Record<string, string> = {
          breakfast: '#FFA726', lunch: '#66BB6A', dinner: '#42A5F5', snack: '#AB47BC',
        };
        const mealNames: Record<string, string> = {
          breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус',
        };

        const cx = 50 + W / 3;
        const cy = y + 75;
        const radius = 60;
        const segments = 60;
        ensureSpace(170);

        let startAngle = -Math.PI / 2;
        for (const item of mealDistribution) {
          const sliceAngle = (item.calories / totalMealCal) * Math.PI * 2;
          if (sliceAngle < 0.01) { startAngle += sliceAngle; continue; }
          const endAngle = startAngle + sliceAngle;

          // Draw pie segment as polygon
          doc.save();
          const path = doc.moveTo(cx, cy);
          const steps = Math.max(Math.ceil(segments * (sliceAngle / (Math.PI * 2))), 2);
          for (let s = 0; s <= steps; s++) {
            const angle = startAngle + (sliceAngle * s / steps);
            path.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
          }
          path.lineTo(cx, cy);
          doc.fill(mealColors[item.meal] || GRAY);
          doc.restore();
          startAngle = endAngle;
        }

        // Legend on the right
        const legendX = cx + radius + 40;
        let legendY = cy - (mealDistribution.length * 18) / 2;
        for (const item of mealDistribution) {
          const pct = Math.round(item.calories / totalMealCal * 100);
          doc.rect(legendX, legendY + 2, 10, 10).fill(mealColors[item.meal] || GRAY);
          doc.fillColor(DARK).font("Regular").fontSize(9)
            .text(`${mealNames[item.meal] || item.meal}: ${item.calories} ккал (${pct}%)`, legendX + 15, legendY, { width: 180 });
          legendY += 18;
        }

        y = cy + radius + 20;
      }
    }

    // ── Day-of-week КБЖУ averages ─────────────────────────────────
    if (dayOfWeekAverages && dayOfWeekAverages.some(d => d.calories > 0)) {
      sectionTitle("Средние КБЖУ по дням недели");
      const dowCols = [
        { label: "День", w: 80 }, { label: "Ккал", w: 80 },
        { label: "Белки г", w: 80 }, { label: "Жиры г", w: 80 }, { label: "Углев г", w: 80 },
      ];
      const dowW = dowCols.reduce((s, c) => s + c.w, 0);
      ensureSpace(20 + dayOfWeekAverages.length * 18 + 10);
      let dtx = 50;
      doc.rect(50, y, dowW, 20).fill(PRIMARY);
      dowCols.forEach(c => {
        doc.fillColor("white").font("Bold").fontSize(8).text(c.label, dtx + 4, y + 6, { width: c.w - 4 });
        dtx += c.w;
      });
      y += 20;

      dayOfWeekAverages.forEach((d, idx) => {
        ensureSpace(18);
        doc.rect(50, y, dowW, 18).fill(idx % 2 === 0 ? BG : "white");
        const row = [d.day, String(d.calories), String(d.protein), String(d.fat), String(d.carbs)];
        let rx = 50;
        row.forEach((cell, ci) => {
          doc.fillColor(DARK).font("Regular").fontSize(8).text(cell, rx + 4, y + 5, { width: dowCols[ci].w - 4 });
          rx += dowCols[ci].w;
        });
        y += 18;
      });
      y += 10;
    }

    // ── Calorie stability ─────────────────────────────────────────
    if (stabilityCV != null && stabilityCV >= 0) {
      sectionTitle("Стабильность питания");
      ensureSpace(60);

      let statusColor: string;
      let statusText: string;
      if (stabilityCV < 15) {
        statusColor = "#22C55E"; statusText = "Отличная стабильность";
      } else if (stabilityCV <= 25) {
        statusColor = "#F59E0B"; statusText = "Нормальная стабильность";
      } else {
        statusColor = "#EF4444"; statusText = "Значительные колебания";
      }

      doc.rect(50, y, W, 50).fillAndStroke(LIGHT, ACCENT);
      doc.fillColor(statusColor).font("Bold").fontSize(22)
        .text(`${stabilityCV}%`, 50, y + 8, { width: 100, align: "center" });
      doc.fillColor(statusColor).font("Bold").fontSize(11)
        .text(statusText, 150, y + 10, { width: W - 110 });
      doc.fillColor(GRAY).font("Regular").fontSize(8)
        .text("Коэффициент вариации дневных калорий (CV). Чем ниже — тем стабильнее питание.", 150, y + 28, { width: W - 110 });
      y += 60;
    }

    // ── Workouts ──────────────────────────────────────────────────
    if (workoutStats && workoutStats.totalBurned > 0) {
      sectionTitle("Тренировки за месяц");
      ensureSpace(30);
      doc.fillColor(DARK).font("Regular").fontSize(10)
        .text(`Сожжено: ${workoutStats.totalBurned} ккал  •  Среднее в день: ${workoutStats.avgPerDay} ккал`, 50, y, { width: W });
      y += 20;

      if (workoutStats.types.length > 0) {
        const wtCols = [
          { label: "Тип", w: 180 }, { label: "Кол-во", w: 80 }, { label: "Ккал", w: 80 },
        ];
        const wtW = wtCols.reduce((s, c) => s + c.w, 0);
        ensureSpace(20 + workoutStats.types.length * 18 + 10);
        let wtx = 50;
        doc.rect(50, y, wtW, 20).fill(PRIMARY);
        wtCols.forEach(c => {
          doc.fillColor("white").font("Bold").fontSize(8).text(c.label, wtx + 4, y + 6, { width: c.w - 4 });
          wtx += c.w;
        });
        y += 20;

        workoutStats.types.forEach((t, idx) => {
          ensureSpace(18);
          doc.rect(50, y, wtW, 18).fill(idx % 2 === 0 ? BG : "white");
          const row = [t.type, String(t.count), String(t.burned)];
          let rx = 50;
          row.forEach((cell, ci) => {
            doc.fillColor(DARK).font("Regular").fontSize(8).text(cell, rx + 4, y + 5, { width: wtCols[ci].w - 4 });
            rx += wtCols[ci].w;
          });
          y += 18;
        });
        y += 10;
      }
    }

    // ── Top foods ─────────────────────────────────────────────────
    if (topFoods.length > 0) {
      sectionTitle("Часто употребляемые продукты");
      topFoods.slice(0, 8).forEach((f, i) => {
        ensureSpace(18);
        doc.rect(50, y, W, 18).fill(i % 2 === 0 ? BG : "white");
        doc.fillColor(ACCENT).font("Bold").fontSize(9).text(`${i + 1}.`, 50, y + 5, { width: 22 });
        doc.fillColor(DARK).font("Regular").fontSize(9).text(f.name, 72, y + 5, { width: W - 80 });
        doc.fillColor(GRAY).fontSize(8).text(`×${f.count}`, 50 + W - 30, y + 5, { width: 30, align: "right" });
        y += 18;
      });
      y += 10;
    }

    // ── Profile summary ───────────────────────────────────────────
    sectionTitle("Профиль");
    const GOAL_LABEL: Record<string, string> = { lose: "Похудение", maintain: "Поддержание", gain: "Набор массы" };
    const ACT_LABEL: Record<string, string> = {
      sedentary: "Сидячий", light: "Лёгкая активность", moderate: "Умеренная",
      active: "Активный", very_active: "Очень активный",
    };
    const profileLines = [
      user.age ? `Возраст: ${user.age} лет` : null,
      user.weight ? `Вес (профиль): ${user.weight} кг` : null,
      user.height ? `Рост: ${user.height} см` : null,
      user.activityLevel ? `Активность: ${ACT_LABEL[user.activityLevel] || user.activityLevel}` : null,
      user.goal ? `Цель: ${GOAL_LABEL[user.goal] || user.goal}` : null,
      user.caloriesGoal
        ? `Норма: ${user.caloriesGoal} ккал | Б:${user.proteinGoal}г Ж:${user.fatGoal}г У:${user.carbsGoal}г`
        : null,
    ].filter(Boolean) as string[];

    profileLines.forEach(line => {
      ensureSpace(16);
      doc.fillColor(DARK).font("Regular").fontSize(10).text(line, 50, y, { width: W });
      y += 16;
    });

    // ── Footer on all pages ───────────────────────────────────────
    // Footer must stay within maxY (page.height - margin = 842 - 50 = 792).
    // Drawing beyond maxY causes PDFKit to auto-insert blank pages.
    const FOOTER_LINE_Y = 758;
    const FOOTER_TEXT_Y = 763;
    const range = (doc as any).bufferedPageRange();
    const pageCount: number = range.count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.moveTo(50, FOOTER_LINE_Y).lineTo(50 + W, FOOTER_LINE_Y)
        .strokeColor(LIGHT).lineWidth(0.5).stroke();
      doc.fillColor(GRAY).font("Regular").fontSize(8)
        .text(
          `Calorie Tracker Bot  •  Страница ${i + 1} из ${pageCount}  •  ${new Date().toLocaleDateString("ru-RU")}`,
          50, FOOTER_TEXT_Y, { align: "center", width: W, lineBreak: false }
        );
    }

    doc.end();
  });
}

export function extractTopFoods(logs: FoodLog[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const log of logs) {
    const key = log.foodName.trim().toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), count }));
}

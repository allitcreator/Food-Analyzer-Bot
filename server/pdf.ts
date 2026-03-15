import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import type { User, FoodLog, WeightLog } from "@shared/schema";

const require = createRequire(import.meta.url);
const FONT_PKG = path.dirname(require.resolve("dejavu-fonts-ttf/package.json"));
const FONT_REGULAR = path.join(FONT_PKG, "ttf", "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_PKG, "ttf", "DejaVuSans-Bold.ttf");

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

export function generateMonthlyPDF(
  user: User,
  weeklyStats: WeekStat[],
  dailyStats: DayStat[],
  weightLogs: WeightLog[],
  topFoods: { name: string; count: number }[]
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
      if (y + needed > 750) { doc.addPage(); y = 50; }
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
    const range = (doc as any).bufferedPageRange();
    const pageCount: number = range.count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.rect(50, 806, W, 0.5).fill(LIGHT);
      doc.fillColor(GRAY).font("Regular").fontSize(8)
        .text(
          `Calorie Tracker Bot  •  Страница ${i + 1} из ${pageCount}  •  ${new Date().toLocaleDateString("ru-RU")}`,
          50, 810, { align: "center", width: W }
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

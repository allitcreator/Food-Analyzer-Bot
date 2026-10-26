import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  DayResponse,
  MeResponse,
  ProfilePatchBody,
  SettingsPatchBody,
} from "@/lib/types";
import { GOAL_LABELS, round } from "@/lib/format";
import { hapticNotification } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Card, SectionCaps } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Input, Field, Select } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { ErrorScreen } from "@/components/StateScreens";
import { toastError } from "@/components/ui/Toast";

const TIMEZONES = [
  "Europe/Kaliningrad",
  "Europe/Moscow",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
  "Europe/Kyiv",
];

const WEEKDAYS = [
  { v: "1", l: "Пн" },
  { v: "2", l: "Вт" },
  { v: "3", l: "Ср" },
  { v: "4", l: "Чт" },
  { v: "5", l: "Пт" },
  { v: "6", l: "Сб" },
  { v: "0", l: "Вс" },
];

export default function Profile() {
  const qc = useQueryClient();
  const me = useQuery<MeResponse>({ queryKey: ["me"], queryFn: api.me });

  const applyUser = (u: MeResponse) => {
    qc.setQueryData(["me"], u);
    qc.invalidateQueries({ queryKey: ["day"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  if (me.isError) return <ErrorScreen error={me.error} onRetry={() => me.refetch()} />;

  return (
    <div>
      <PageHeader title="Профиль" />
      <div className="px-4">
        {me.isLoading || !me.data ? (
          <div className="space-y-3.5">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : (
          <>
            <SummaryCard user={me.data} />
            <ProfileSection user={me.data} onSaved={applyUser} />
            {/* key: после «Пересчитать нормы» форма целей пересоздаётся с новыми
                числами, иначе «Сохранить цели» перезапишет их старыми. */}
            <GoalsSection key={goalsKey(me.data)} user={me.data} onSaved={applyUser} />
            <SettingsSection user={me.data} onSaved={applyUser} />
            <GlossarySection />
          </>
        )}
      </div>
    </div>
  );
}

function goalsKey(u: MeResponse): string {
  const g = u.goals;
  return [g.calories, g.protein, g.fat, g.carbs].join("/");
}

const yearsWord = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "год";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "года";
  return "лет";
};

// ─── Summary ──────────────────────────────────────────────────────────────

/** Сводка сверху: цель, вес · рост · возраст, норма ккал, BMR и TDEE. */
function SummaryCard({ user }: { user: MeResponse }) {
  // BMR/TDEE считает сервер в /day — тот же кэш, что у экрана «Сегодня».
  const day = useQuery<DayResponse>({ queryKey: ["day", "today"], queryFn: () => api.day() });
  const eb = day.data?.energyBalance;
  const body = [
    user.weight ? `${user.weight.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} кг` : null,
    user.height ? `${user.height} см` : null,
    user.age ? `${user.age} ${yearsWord(user.age)}` : null,
  ].filter(Boolean);

  return (
    <Card className="mb-1 bg-accent-soft p-[18px]">
      <div className="flex items-center gap-3.5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-card text-[28px]" aria-hidden>
          🎯
        </div>
        <div className="min-w-0">
          <b className="text-[19px]">{GOAL_LABELS[user.goal ?? ""] ?? "Цель не задана"}</b>
          {body.length > 0 && <div className="text-[13px] text-muted-foreground">{body.join(" · ")}</div>}
        </div>
      </div>
      <div className="mt-3.5 grid grid-cols-3 gap-2">
        <SummaryStat value={user.goals.calories} label="ккал в день" />
        <SummaryStat value={eb ? round(eb.bmr) : null} label="BMR" />
        <SummaryStat value={eb ? round(eb.tdee) : null} label="TDEE" />
      </div>
    </Card>
  );
}

function SummaryStat({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="rounded-[14px] bg-card p-2.5 text-center text-[11px] text-muted-foreground">
      <b className="mb-0.5 block text-[17px] text-foreground">{value ?? "—"}</b>
      {label}
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────

function ProfileSection({
  user,
  onSaved,
}: {
  user: MeResponse;
  onSaved: (u: MeResponse) => void;
}) {
  const [gender, setGender] = useState(user.gender ?? "male");
  const [age, setAge] = useState(String(user.age ?? ""));
  const [height, setHeight] = useState(String(user.height ?? ""));
  const [weight, setWeight] = useState(String(user.weight ?? ""));
  const [activity, setActivity] = useState(user.activityLevel ?? "moderate");
  const [goal, setGoal] = useState(user.goal ?? "maintain");

  const mutation = useMutation({
    mutationFn: (body: ProfilePatchBody) => api.updateProfile(body),
    onSuccess: (u) => {
      hapticNotification("success");
      onSaved(u);
    },
    onError: (err) => toastError(err, "Не удалось сохранить профиль"),
  });

  const fields = (): ProfilePatchBody => ({
    gender: gender as ProfilePatchBody["gender"],
    age: Number(age) || undefined,
    height: Number(height) || undefined,
    weight: Number(weight) || undefined,
    activityLevel: activity as ProfilePatchBody["activityLevel"],
    goal: goal as ProfilePatchBody["goal"],
  });

  return (
    <div>
      <SectionCaps>Данные тела</SectionCaps>
      <Card>
        <div className="space-y-2.5 p-[18px]">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Пол">
              <Select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="male">Мужской</option>
                <option value="female">Женский</option>
              </Select>
            </Field>
            <Field label="Возраст">
              <Input type="number" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} />
            </Field>
            <Field label="Рост, см">
              <Input type="number" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} />
            </Field>
            <Field label="Вес, кг">
              <Input type="number" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </Field>
          </div>
          <Field label="Активность">
            <Select value={activity} onChange={(e) => setActivity(e.target.value)}>
              <option value="sedentary">Сидячий образ жизни</option>
              <option value="light">Лёгкая активность</option>
              <option value="moderate">Умеренная</option>
              <option value="active">Активный</option>
              <option value="very_active">Очень активный</option>
            </Select>
          </Field>
          <div>
            <span className="mb-[5px] ml-1 block text-xs font-semibold text-muted-foreground">Цель</span>
            <Segmented
              value={goal}
              onChange={setGoal}
              options={[
                { value: "lose", label: "Похудение" },
                { value: "maintain", label: "Поддержание" },
                { value: "gain", label: "Набор" },
              ]}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(fields())}
            >
              Сохранить
            </Button>
            <Button
              className="flex-1"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ ...fields(), recalc: true })}
            >
              Пересчитать нормы
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Goals ────────────────────────────────────────────────────────────────

function GoalsSection({
  user,
  onSaved,
}: {
  user: MeResponse;
  onSaved: (u: MeResponse) => void;
}) {
  const [cal, setCal] = useState(String(user.goals.calories ?? ""));
  const [prot, setProt] = useState(String(user.goals.protein ?? ""));
  const [fat, setFat] = useState(String(user.goals.fat ?? ""));
  const [carbs, setCarbs] = useState(String(user.goals.carbs ?? ""));

  const mutation = useMutation({
    mutationFn: (body: ProfilePatchBody) => api.updateProfile(body),
    onSuccess: (u) => {
      hapticNotification("success");
      onSaved(u);
    },
    onError: (err) => toastError(err, "Не удалось сохранить цели"),
  });

  const save = () => {
    const body: ProfilePatchBody = {};
    if (cal) body.caloriesGoal = Number(cal);
    if (prot) body.proteinGoal = Number(prot);
    if (fat) body.fatGoal = Number(fat);
    if (carbs) body.carbsGoal = Number(carbs);
    if (Object.keys(body).length > 0) mutation.mutate(body);
  };

  return (
    <div>
      <SectionCaps>Цели КБЖУ</SectionCaps>
      <Card>
        <div className="space-y-3 p-[18px]">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Калории">
              <Input type="number" inputMode="numeric" value={cal} onChange={(e) => setCal(e.target.value)} />
            </Field>
            <Field label="Белки, г" labelClassName="text-prot-fg">
              <Input type="number" inputMode="numeric" value={prot} onChange={(e) => setProt(e.target.value)} />
            </Field>
            <Field label="Жиры, г" labelClassName="text-fat-fg">
              <Input type="number" inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} />
            </Field>
            <Field label="Углеводы, г" labelClassName="text-carb-fg">
              <Input type="number" inputMode="numeric" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
            </Field>
          </div>
          <Button className="w-full" disabled={mutation.isPending} onClick={save}>
            Сохранить цели
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────

function SettingsSection({
  user,
  onSaved,
}: {
  user: MeResponse;
  onSaved: (u: MeResponse) => void;
}) {
  const mutation = useMutation({
    mutationFn: (body: SettingsPatchBody) => api.updateSettings(body),
    onSuccess: (u) => onSaved(u),
    // Тумблеры и поля управляются из кэша ["me"], так что при ошибке они сами
    // остаются в прежнем положении — пользователю нужно только объяснить почему.
    onError: (err) => toastError(err, "Не удалось сохранить настройку"),
  });
  const patch = (body: SettingsPatchBody) => mutation.mutate(body);

  return (
    <div>
      <SectionCaps>Настройки</SectionCaps>
      <Card className="divide-y divide-border px-[18px] py-1.5">
        <Toggle
          icon="🧪"
          iconClassName="bg-prot-bg"
          label="Микронутриенты"
          hint="Показывать клетчатку, сахар, натрий и т.п. в разборе блюда, а не только КБЖУ."
          checked={!!user.showMicronutrients}
          onChange={(v) => patch({ showMicronutrients: v })}
        />
        <Toggle
          icon="✨"
          iconClassName="bg-carb-bg"
          label="AI-анализ недели"
          hint="ИИ пишет вывод по неделе: тренды и что подтянуть."
          checked={!!user.aiWeekAnalysis}
          onChange={(v) => patch({ aiWeekAnalysis: v })}
        />
        <Toggle
          icon="✨"
          iconClassName="bg-carb-bg"
          label="AI-анализ месяца"
          hint="ИИ разбирает месяц и даёт рекомендации."
          checked={!!user.aiMonthAnalysis}
          onChange={(v) => patch({ aiMonthAnalysis: v })}
        />
        <Toggle
          icon="🌙"
          iconClassName="bg-fat-bg"
          label="AI в вечернем отчёте"
          hint="Добавляет к вечернему отчёту короткий совет от ИИ по итогам дня."
          checked={!!user.aiEveningReport}
          onChange={(v) => patch({ aiEveningReport: v })}
        />
        <Toggle
          icon="📊"
          iconClassName="bg-water-soft"
          label="Умная группировка в Excel"
          hint="При выгрузке в Excel ИИ объединяет одинаковые блюда в строки — файл чище."
          checked={!!user.smartFoodGrouping}
          onChange={(v) => patch({ smartFoodGrouping: v })}
        />
        <Toggle
          icon="🔎"
          iconClassName="bg-fill"
          label="Распознавание штрихкодов"
          hint="Искать штрихкод на фото и подтягивать продукт из базы."
          checked={!!user.barcodeScanEnabled}
          onChange={(v) => patch({ barcodeScanEnabled: v })}
        />
        <Toggle
          icon="🔔"
          iconClassName="bg-accent-soft"
          label="Умные напоминания"
          hint="Обычное время приёмов бот выводит из истории и пингует, только если приём не записан к этому времени. Заменяют напоминания о еде по расписанию."
          checked={!!user.smartReminders}
          onChange={(v) => patch({ smartReminders: v })}
        />
      </Card>

      <SectionCaps>Время и напоминания</SectionCaps>
      <Card className="divide-y divide-border px-[18px] py-1.5">
        <TimeRow label="Вечерний отчёт" hint="Во сколько бот сам присылает отчёт за день." value={user.reportTime} onChange={(v) => patch({ reportTime: v })} />
        <TimeRow label="Напоминание: завтрак" hint="Напоминание записать завтрак." value={user.breakfastReminder} onChange={(v) => patch({ breakfastReminder: v })} />
        <TimeRow label="Напоминание: обед" hint="Напоминание записать обед." value={user.lunchReminder} onChange={(v) => patch({ lunchReminder: v })} />
        <TimeRow label="Напоминание: ужин" hint="Напоминание записать ужин." value={user.dinnerReminder} onChange={(v) => patch({ dinnerReminder: v })} />
        <TimeRow label="«Нет записей»" hint="Напоминание, если за день ничего не залогировано." value={user.noLogReminderTime} onChange={(v) => patch({ noLogReminderTime: v })} />
        <TimeRow label="Взвешивание" hint="Во сколько напоминать взвеситься (дни — ниже)." value={user.weightReminderTime} onChange={(v) => patch({ weightReminderTime: v })} />
        <WeekdayRow
          value={user.weightReminderDays ?? ""}
          onChange={(v) => patch({ weightReminderDays: v })}
        />
      </Card>

      <SectionCaps>Приёмы пищи и часовой пояс</SectionCaps>
      <Card className="divide-y divide-border px-[18px] py-1.5">
        <TimeRow
          label="Завтрак до"
          hint="Записи до этого времени бот относит к завтраку."
          value={user.mealBreakfastEnd ?? "12:30"}
          allowOff={false}
          onChange={(v) => patch({ mealBreakfastEnd: v })}
        />
        <TimeRow
          label="Обед до"
          hint="До этого времени — обед, позже — ужин."
          value={user.mealLunchEnd ?? "16:30"}
          allowOff={false}
          onChange={(v) => patch({ mealLunchEnd: v })}
        />
        <div className="flex items-center justify-between gap-3 py-[13px]">
          <div className="min-w-0 pr-2">
            <div className="text-[15px]">Часовой пояс</div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">По нему считаются «сегодня», время отчётов и напоминаний.</div>
          </div>
          <Select
            className="h-9 w-44 rounded-[10px] text-sm"
            value={user.timezone ?? "Europe/Moscow"}
            onChange={(e) => patch({ timezone: e.target.value })}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </div>
      </Card>
    </div>
  );
}

// ─── Glossary (расшифровка показателей) ─────────────────────────────────────

const GLOSSARY: { term: string; desc: string }[] = [
  { term: "Норма калорий", desc: "Ваша дневная цель по калориям. На «Сегодня» показывает, сколько съедено из нормы и сколько осталось." },
  { term: "БЖУ", desc: "Белки, жиры и углеводы за день относительно ваших целей — три цветные плашки на экране «Сегодня»." },
  { term: "BMR", desc: "Базовый обмен: сколько калорий тело тратит в полном покое, только на поддержание жизни." },
  { term: "TDEE", desc: "Полный расход за день: BMR, умноженный на коэффициент вашего уровня активности." },
  { term: "Энергобаланс", desc: "Разница «съедено минус расход». Дефицит — тратите больше, чем едите (для похудения); профицит — наоборот." },
  { term: "Серия дневника", desc: "Сколько дней подряд вы ведёте записи о еде. На экране «Тренды»." },
  { term: "Вода", desc: "Выпитая вода за день; ориентир — 8 стаканов по 250 мл." },
];

function GlossarySection() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <SectionCaps>Справка</SectionCaps>
      <Card className="px-[18px] py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 py-[13px] text-left"
          aria-expanded={open}
        >
          <SettingIcon emoji="❓" className="bg-fill" />
          <span className="flex-1 text-[15px]">Что означают показатели</span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-border pb-3 pt-3">
            {GLOSSARY.map((g) => (
              <div key={g.term}>
                <div className="text-sm font-semibold">{g.term}</div>
                <div className="text-[13px] leading-snug text-muted-foreground">{g.desc}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Цветная иконка-эмодзи строки настроек, как в настройках iOS. */
function SettingIcon({ emoji, className }: { emoji: string; className: string }) {
  return (
    <div
      className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[17px]", className)}
      aria-hidden
    >
      {emoji}
    </div>
  );
}

function Toggle({
  icon,
  iconClassName,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: string;
  iconClassName: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-[13px]">
      <SettingIcon emoji={icon} className={iconClassName} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** A time setting that can be turned off ("off") or set to an "HH:MM" value. */
function TimeRow({
  label,
  hint,
  value,
  onChange,
  allowOff = true,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (v: string) => void;
  allowOff?: boolean;
}) {
  const current = value ?? "off";
  const isOff = allowOff && (current === "off" || current === "");
  const timeValue = isOff ? "" : current;

  return (
    <div className="flex items-center justify-between gap-3 py-[13px]">
      <div className="min-w-0 pr-2">
        <div className="text-[15px]">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="time"
          value={timeValue || "09:00"}
          disabled={isOff}
          onChange={(e) => {
            // Очистка поля (крестик в iOS/Android) даёт "" — сервер такое не примет.
            if (e.target.value) onChange(e.target.value);
          }}
          aria-label={label}
          className={cn(
            "h-9 rounded-[10px] bg-fill px-2 text-[15px] outline-none disabled:opacity-40",
            !isOff && "font-semibold text-primary",
          )}
        />
        {allowOff && (
          <Switch
            checked={!isOff}
            onCheckedChange={(on) => onChange(on ? timeValue || "09:00" : "off")}
          />
        )}
      </div>
    </div>
  );
}

function WeekdayRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = value ? value.split(",").map((s) => s.trim()) : [];
  const toggle = (day: string) => {
    const set = new Set(selected);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    const ordered = WEEKDAYS.map((w) => w.v).filter((v) => set.has(v));
    onChange(ordered.join(","));
  };
  return (
    <div className="py-[13px]">
      <div className="text-[15px]">Дни взвешивания</div>
      <div className="mb-2 mt-0.5 text-xs text-muted-foreground">По каким дням недели напоминать взвеситься.</div>
      <div className="flex gap-1.5">
        {WEEKDAYS.map((w) => {
          const active = selected.includes(w.v);
          return (
            <button
              key={w.v}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(w.v)}
              className={cn(
                "h-9 flex-1 rounded-[10px] text-xs font-semibold",
                active ? "bg-accent-soft text-primary" : "bg-fill text-muted-foreground",
              )}
            >
              {w.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

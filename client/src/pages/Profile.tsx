import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  MeResponse,
  ProfilePatchBody,
  SettingsPatchBody,
} from "@/lib/types";
import { hapticNotification } from "@/lib/telegram";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Input, Field, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { ErrorScreen } from "@/components/StateScreens";

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
      <div className="space-y-4 px-4">
        {me.isLoading || !me.data ? (
          <>
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </>
        ) : (
          <>
            <ProfileSection user={me.data} onSaved={applyUser} />
            <GoalsSection user={me.data} onSaved={applyUser} />
            <SettingsSection user={me.data} onSaved={applyUser} />
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">{children}</h2>;
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
      <SectionTitle>Данные тела</SectionTitle>
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid grid-cols-2 gap-3">
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
          <Field label="Цель">
            <Select value={goal} onChange={(e) => setGoal(e.target.value)}>
              <option value="lose">Похудение</option>
              <option value="maintain">Поддержание</option>
              <option value="gain">Набор массы</option>
            </Select>
          </Field>
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
        </CardContent>
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
      <SectionTitle>Цели КБЖУ</SectionTitle>
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Калории">
              <Input type="number" inputMode="numeric" value={cal} onChange={(e) => setCal(e.target.value)} />
            </Field>
            <Field label="Белки, г">
              <Input type="number" inputMode="numeric" value={prot} onChange={(e) => setProt(e.target.value)} />
            </Field>
            <Field label="Жиры, г">
              <Input type="number" inputMode="numeric" value={fat} onChange={(e) => setFat(e.target.value)} />
            </Field>
            <Field label="Углеводы, г">
              <Input type="number" inputMode="numeric" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
            </Field>
          </div>
          <Button className="w-full" disabled={mutation.isPending} onClick={save}>
            Сохранить цели
          </Button>
        </CardContent>
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
  });
  const patch = (body: SettingsPatchBody) => mutation.mutate(body);

  return (
    <div>
      <SectionTitle>Настройки</SectionTitle>
      <Card>
        <CardContent className="divide-y divide-card-border pt-1">
          <Toggle
            label="Микронутриенты"
            hint="Клетчатка, сахар, натрий и т.д."
            checked={!!user.showMicronutrients}
            onChange={(v) => patch({ showMicronutrients: v })}
          />
          <Toggle
            label="AI-анализ недели"
            checked={!!user.aiWeekAnalysis}
            onChange={(v) => patch({ aiWeekAnalysis: v })}
          />
          <Toggle
            label="AI-анализ месяца"
            checked={!!user.aiMonthAnalysis}
            onChange={(v) => patch({ aiMonthAnalysis: v })}
          />
          <Toggle
            label="AI в вечернем отчёте"
            checked={!!user.aiEveningReport}
            onChange={(v) => patch({ aiEveningReport: v })}
          />
          <Toggle
            label="Умная группировка в Excel"
            checked={!!user.smartFoodGrouping}
            onChange={(v) => patch({ smartFoodGrouping: v })}
          />
          <Toggle
            label="Распознавание штрихкодов"
            hint="Искать штрихкод на фото"
            checked={!!user.barcodeScanEnabled}
            onChange={(v) => patch({ barcodeScanEnabled: v })}
          />
        </CardContent>
      </Card>

      <SectionTitle>Время и напоминания</SectionTitle>
      <Card>
        <CardContent className="divide-y divide-card-border pt-1">
          <TimeRow label="Вечерний отчёт" value={user.reportTime} onChange={(v) => patch({ reportTime: v })} />
          <TimeRow label="Напоминание: завтрак" value={user.breakfastReminder} onChange={(v) => patch({ breakfastReminder: v })} />
          <TimeRow label="Напоминание: обед" value={user.lunchReminder} onChange={(v) => patch({ lunchReminder: v })} />
          <TimeRow label="Напоминание: ужин" value={user.dinnerReminder} onChange={(v) => patch({ dinnerReminder: v })} />
          <TimeRow label="«Нет записей»" value={user.noLogReminderTime} onChange={(v) => patch({ noLogReminderTime: v })} />
          <TimeRow label="Взвешивание" value={user.weightReminderTime} onChange={(v) => patch({ weightReminderTime: v })} />
          <WeekdayRow
            value={user.weightReminderDays ?? ""}
            onChange={(v) => patch({ weightReminderDays: v })}
          />
        </CardContent>
      </Card>

      <SectionTitle>Приёмы пищи и часовой пояс</SectionTitle>
      <Card>
        <CardContent className="divide-y divide-card-border pt-1">
          <TimeRow
            label="Завтрак до"
            value={user.mealBreakfastEnd ?? "12:30"}
            allowOff={false}
            onChange={(v) => patch({ mealBreakfastEnd: v })}
          />
          <TimeRow
            label="Обед до"
            value={user.mealLunchEnd ?? "16:30"}
            allowOff={false}
            onChange={(v) => patch({ mealLunchEnd: v })}
          />
          <div className="flex items-center justify-between py-3">
            <span className="text-[15px]">Часовой пояс</span>
            <Select
              className="h-9 w-44"
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
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="pr-3">
        <div className="text-[15px]">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** A time setting that can be turned off ("off") or set to an "HH:MM" value. */
function TimeRow({
  label,
  value,
  onChange,
  allowOff = true,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  allowOff?: boolean;
}) {
  const current = value ?? "off";
  const isOff = allowOff && (current === "off" || current === "");
  const timeValue = isOff ? "" : current;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-[15px]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={timeValue || "09:00"}
          disabled={isOff}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none disabled:opacity-40"
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
    <div className="py-3">
      <div className="mb-2 text-[15px]">Дни взвешивания</div>
      <div className="flex gap-1.5">
        {WEEKDAYS.map((w) => {
          const active = selected.includes(w.v);
          return (
            <button
              key={w.v}
              onClick={() => toggle(w.v)}
              className={`h-9 flex-1 rounded-lg text-xs font-medium ${
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {w.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

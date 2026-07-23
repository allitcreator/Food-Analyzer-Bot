import type { ReactNode } from "react";
import { AlertCircle, Clock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api";

function Centered({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

/** Renders the right full-screen message for auth / fetch failures. */
export function ErrorScreen({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return (
        <Centered
          icon={<LogIn className="h-10 w-10" />}
          title="Откройте из Telegram"
          text="Это приложение работает внутри Telegram. Откройте его через кнопку меню бота."
        />
      );
    }
    if (error.status === 403) {
      const pending = error.reason === "not_approved" || error.reason === "not_registered";
      return (
        <Centered
          icon={<Clock className="h-10 w-10" />}
          title={pending ? "Заявка на рассмотрении" : "Доступ закрыт"}
          text={
            pending
              ? "Ваша заявка отправлена администратору. Дождитесь одобрения, чтобы пользоваться приложением."
              : "Ваш аккаунт заблокирован. Обратитесь к администратору."
          }
        />
      );
    }
  }

  return (
    <Centered
      icon={<AlertCircle className="h-10 w-10" />}
      title="Что-то пошло не так"
      text="Не удалось загрузить данные. Проверьте соединение и попробуйте снова."
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Повторить
          </Button>
        ) : undefined
      }
    />
  );
}

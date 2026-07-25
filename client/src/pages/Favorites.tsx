import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Star, Users, Share2, Trash2, Plus } from "lucide-react";
import { filterFavorites } from "@shared/favorites-filter";
import { api } from "@/lib/api";
import type { Favorite } from "@/lib/types";
import { round } from "@/lib/format";
import { hapticImpact, hapticNotification } from "@/lib/telegram";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorScreen } from "@/components/StateScreens";
import { toast } from "@/components/ui/Toast";

export default function Favorites() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Favorite | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["favorites"],
    queryFn: api.favorites,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["favorites"] });
    qc.invalidateQueries({ queryKey: ["day"] });
  };

  const logMutation = useMutation({
    mutationFn: (fav: Favorite) => api.logFavorite(fav.id),
    onSuccess: (_res, fav) => {
      hapticNotification("success");
      toast(`Записано: ${fav.title}`);
      qc.invalidateQueries({ queryKey: ["day"] });
    },
    onError: () => {
      hapticNotification("error");
      toast("Не удалось записать");
    },
  });

  const shareMutation = useMutation({
    mutationFn: ({ id, isShared }: { id: number; isShared: boolean }) =>
      api.setFavoriteShared(id, isShared),
    // Optimistic flip so the toggle reflects the new state instantly.
    onMutate: async ({ id, isShared }) => {
      await qc.cancelQueries({ queryKey: ["favorites"] });
      const prev = qc.getQueryData<{ favorites: Favorite[] }>(["favorites"]);
      qc.setQueryData<{ favorites: Favorite[] }>(["favorites"], (cur) =>
        cur
          ? { favorites: cur.favorites.map((f) => (f.id === id ? { ...f, isShared } : f)) }
          : cur,
      );
      hapticImpact("light");
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favorites"], ctx.prev);
      hapticNotification("error");
      toast("Не удалось изменить доступ");
    },
    onSuccess: (_res, { isShared }) => {
      toast(isShared ? "Теперь доступно всем" : "Доступ закрыт");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => api.deleteFavorite(id),
    onSuccess: () => {
      hapticNotification("success");
      setDeleting(null);
      invalidate();
    },
    onError: () => {
      hapticNotification("error");
      toast("Не удалось удалить");
    },
  });

  const favorites = data?.favorites ?? [];
  const filtered = useMemo(() => filterFavorites(favorites, query), [favorites, query]);
  const mine = filtered.filter((f) => f.isOwner);
  const shared = filtered.filter((f) => !f.isOwner);

  if (isError) return <ErrorScreen error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader title="Избранное" />
      <div className="space-y-4 px-4">
        {isLoading || !data ? (
          <>
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </>
        ) : favorites.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию или блюду"
                className="pl-9"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Ничего не найдено по запросу «{query.trim()}».
              </p>
            ) : (
              <>
                {mine.length > 0 && (
                  <Section icon={<Star className="h-4 w-4 text-chart-3" />} title="Мои">
                    {mine.map((fav) => (
                      <FavoriteCard
                        key={fav.id}
                        fav={fav}
                        onLog={() => logMutation.mutate(fav)}
                        logging={logMutation.isPending && logMutation.variables?.id === fav.id}
                        onToggleShare={(v) => shareMutation.mutate({ id: fav.id, isShared: v })}
                        onDelete={() => setDeleting(fav)}
                      />
                    ))}
                  </Section>
                )}
                {shared.length > 0 && (
                  <Section icon={<Users className="h-4 w-4 text-chart-1" />} title="Общие">
                    {shared.map((fav) => (
                      <FavoriteCard
                        key={fav.id}
                        fav={fav}
                        onLog={() => logMutation.mutate(fav)}
                        logging={logMutation.isPending && logMutation.variables?.id === fav.id}
                      />
                    ))}
                  </Section>
                )}
              </>
            )}
          </>
        )}
      </div>

      <Modal open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Удалить из избранного?">
        <p className="mb-5 text-sm text-muted-foreground">
          «{deleting?.title}» будет удалено безвозвратно.
          {deleting?.isShared && " Оно также пропадёт у других участников."}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleting(null)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={delMutation.isPending}
            onClick={() => deleting && delMutation.mutate(deleting.id)}
          >
            Удалить
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

/** Summary line: item count + total calories across a favorite's items. */
function summarize(fav: Favorite): string {
  const count = fav.items.length;
  const kcal = round(fav.items.reduce((s, it) => s + (it.calories ?? 0), 0));
  const noun = count % 10 === 1 && count % 100 !== 11 ? "позиция" : "позиций";
  return `${count} ${noun} · ~${kcal} ккал`;
}

function FavoriteCard({
  fav,
  onLog,
  logging,
  onToggleShare,
  onDelete,
}: {
  fav: Favorite;
  onLog: () => void;
  logging: boolean;
  onToggleShare?: (v: boolean) => void;
  onDelete?: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{fav.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{summarize(fav)}</div>
            {!fav.isOwner && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                от {fav.ownerName ? `@${fav.ownerName}` : "участника"}
              </div>
            )}
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label={`Удалить ${fav.title}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" className="flex-1" disabled={logging} onClick={onLog}>
            <Plus className="h-4 w-4" /> Записать
          </Button>
          {onToggleShare && (
            <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
              <Share2 className="h-4 w-4" />
              <Switch checked={fav.isShared} onCheckedChange={onToggleShare} />
            </label>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-8 text-center">
      <Star className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">Пока пусто</h2>
      <p className="max-w-xs text-sm text-muted-foreground">
        Сохраняй частые блюда со звёздочкой — они появятся здесь и запишутся в один тап.
      </p>
    </div>
  );
}

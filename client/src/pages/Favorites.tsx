import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Search, Share2, Star, Trash2 } from "lucide-react";
import { filterFavorites } from "@shared/favorites-filter";
import { api } from "@/lib/api";
import type { Favorite } from "@/lib/types";
import { round } from "@/lib/format";
import { foodEmoji } from "@/lib/food-emoji";
import { invalidateDiary } from "@/lib/invalidate";
import { hapticImpact, hapticNotification, hapticSelection } from "@/lib/telegram";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Button, IconButton } from "@/components/ui/Button";
import { Modal, SheetAction } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorScreen } from "@/components/StateScreens";
import { favoriteCalories } from "@/components/FavoriteChips";
import { toast } from "@/components/ui/Toast";

type Tab = "mine" | "shared";

/** Цвет круга под эмодзи — по кругу из палитры макета. */
const PLATES = ["bg-fat-bg", "bg-prot-bg", "bg-carb-bg", "bg-accent-soft", "bg-bad-soft"];

export default function Favorites() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("mine");
  const [menuFor, setMenuFor] = useState<Favorite | null>(null);
  const [deleting, setDeleting] = useState<Favorite | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["favorites"],
    queryFn: api.favorites,
  });

  const logMutation = useMutation({
    mutationFn: (fav: Favorite) => api.logFavorite(fav.id),
    onSuccess: (_res, fav) => {
      hapticNotification("success");
      toast(`Записано: ${fav.title}`);
      invalidateDiary(qc);
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
      qc.invalidateQueries({ queryKey: ["favorites"] });
      invalidateDiary(qc);
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
  const visible = tab === "mine" ? mine : shared;
  // Шторка «···» читает актуальный isShared из кэша, а не из снимка при открытии.
  const menuFav = menuFor ? favorites.find((f) => f.id === menuFor.id) ?? menuFor : null;

  if (isError) return <ErrorScreen error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <PageHeader title="Избранное" subtitle={data ? dishesCount(favorites.length) : undefined} />
      <div className="px-4">
        {isLoading || !data ? (
          <div className="space-y-3.5">
            <Skeleton className="h-[46px] w-full rounded-[14px]" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : favorites.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию или блюду"
                className="pl-10"
              />
            </div>
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              className="mb-4"
              options={[
                { value: "mine", label: `Мои · ${mine.length}` },
                { value: "shared", label: `Общие · ${shared.length}` },
              ]}
            />

            {visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {query.trim()
                  ? `Ничего не найдено по запросу «${query.trim()}».`
                  : tab === "mine"
                    ? "Своих блюд пока нет."
                    : "Общих блюд пока нет."}
              </p>
            ) : (
              <div className="space-y-3.5">
                {visible.map((fav) => (
                  <FavoriteCard
                    key={fav.id}
                    fav={fav}
                    onLog={() => logMutation.mutate(fav)}
                    logging={logMutation.isPending && logMutation.variables?.id === fav.id}
                    onMenu={() => {
                      hapticSelection();
                      setMenuFor(fav);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={!!menuFav} onOpenChange={(o) => !o && setMenuFor(null)} title={menuFav?.title}>
        {menuFav && (
          <Card className="divide-y divide-border">
            {menuFav.isOwner ? (
              <>
                <label className="flex items-center gap-3 px-[18px] py-[13px] text-[15px] font-medium">
                  <Share2 className="h-4 w-4" />
                  <span className="flex-1">
                    Доступно всем
                    <span className="block text-xs font-normal text-muted-foreground">
                      Блюдо увидят другие участники в «Общих»
                    </span>
                  </span>
                  <Switch
                    checked={menuFav.isShared}
                    onCheckedChange={(v) => shareMutation.mutate({ id: menuFav.id, isShared: v })}
                  />
                </label>
                <SheetAction
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Удалить"
                  destructive
                  onClick={() => {
                    setDeleting(menuFav);
                    setMenuFor(null);
                  }}
                />
              </>
            ) : (
              <SheetAction
                icon={<Plus className="h-4 w-4" />}
                label="Записать"
                onClick={() => {
                  logMutation.mutate(menuFav);
                  setMenuFor(null);
                }}
              />
            )}
          </Card>
        )}
      </Modal>

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

/** «7 блюд» с русским склонением. */
function dishesCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const noun =
    mod10 === 1 && mod100 !== 11
      ? "блюдо"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "блюда"
        : "блюд";
  return `${n} ${noun}`;
}

/** Состав: «Овсянка на молоке 250 г, латте 300 г». */
function composition(fav: Favorite): string {
  return fav.items
    .map((it) => (it.weight ? `${it.foodName} ${round(it.weight)} г` : it.foodName))
    .join(", ");
}

function FavoriteCard({
  fav,
  onLog,
  logging,
  onMenu,
}: {
  fav: Favorite;
  onLog: () => void;
  logging: boolean;
  onMenu: () => void;
}) {
  return (
    <Card className="p-[18px]">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl ${PLATES[fav.id % PLATES.length]}`}
          aria-hidden
        >
          {foodEmoji(fav.title)}
        </div>
        <div className="min-w-0 flex-1">
          <b className="flex justify-between gap-2 text-base">
            <span className="min-w-0 truncate">{fav.title}</span>
            <span className="shrink-0 font-semibold text-primary">{favoriteCalories(fav)}</span>
          </b>
          <p className="mt-[3px] text-[13px] leading-snug text-muted-foreground">{composition(fav)}</p>
        </div>
        <IconButton onClick={onMenu} aria-label={`Ещё: ${fav.title}`}>
          <MoreHorizontal className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" className="flex-1" disabled={logging} onClick={onLog}>
          <Plus className="h-4 w-4" /> Записать
        </Button>
        {fav.isOwner && fav.isShared && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Share2 className="h-4 w-4" /> общее
          </span>
        )}
        {!fav.isOwner && (
          <span className="text-xs text-muted-foreground">
            от {fav.ownerName ? `@${fav.ownerName}` : "участника"}
          </span>
        )}
      </div>
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

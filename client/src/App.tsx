import { Route, Router, Switch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MeResponse } from "@/lib/types";
import { TabBar } from "@/components/TabBar";
import { FullscreenSpinner } from "@/components/ui/Spinner";
import { ErrorScreen } from "@/components/StateScreens";
import Today from "@/pages/Today";
import History from "@/pages/History";
import Trends from "@/pages/Trends";
import Profile from "@/pages/Profile";

export default function App() {
  // Gate the whole app on /me: this resolves the auth state once and lets us
  // show the right full-screen message for 401 / 403 before rendering tabs.
  const me = useQuery<MeResponse>({ queryKey: ["me"], queryFn: api.me });

  if (me.isLoading) return <FullscreenSpinner />;
  if (me.isError) return <ErrorScreen error={me.error} onRetry={() => me.refetch()} />;

  return (
    <Router base="/app">
      <div className="mx-auto min-h-full max-w-xl pb-20">
        <Switch>
          <Route path="/" component={Today} />
          <Route path="/history" component={History} />
          <Route path="/trends" component={Trends} />
          <Route path="/profile" component={Profile} />
          <Route>
            <div className="p-8 text-center text-muted-foreground">Страница не найдена</div>
          </Route>
        </Switch>
      </div>
      <TabBar />
    </Router>
  );
}

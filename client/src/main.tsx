import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { initTelegram } from "./lib/telegram";
import { applyTelegramTheme } from "./lib/theme";
import App from "./App";
import "./index.css";

/** Report to the DOM overlay installed by the inline script in index.html. */
function reportFatal(source: string, err: unknown) {
  const show = (window as unknown as {
    __showFatalOverlay?: (title: string, detail: string) => void;
  }).__showFatalOverlay;
  const e = err instanceof Error ? err : undefined;
  show?.(source, `${e?.message ?? String(err)}\n${e?.stack ?? ""}`);
}

/**
 * Render-crash boundary: shows a selectable/copyable card with the error
 * message and the top of the stack instead of a blank screen. Inline styles
 * on purpose — must stay visible even if the CSS theme itself is broken.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportFatal("react render", error);
  }

  render() {
    const { error } = this.state;
    if (error) {
      const stack = (error.stack ?? "").split("\n").slice(0, 8).join("\n");
      return (
        <div style={{ padding: 16 }}>
          <div
            style={{
              background: "#fff1f2",
              color: "#7f1d1d",
              border: "1px solid #fda4af",
              borderRadius: 12,
              padding: 16,
              fontFamily: "Menlo, Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Ошибка приложения</div>
            {error.message}
            {"\n\n"}
            {stack}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Pre-render init: neither call may take the whole app down.
try {
  initTelegram();
} catch (err) {
  reportFatal("initTelegram", err);
}
try {
  applyTelegramTheme();
} catch (err) {
  reportFatal("applyTelegramTheme", err);
}

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (err) {
  reportFatal("mount", err);
  throw err;
}

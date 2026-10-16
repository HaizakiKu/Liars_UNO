import { create } from "zustand";
import { CODE_RE } from "../../shared/protocol";

export type Route = { name: "home" } | { name: "room"; code: string };

function parse(path: string): Route {
  const m = /^\/r\/([A-Za-z0-9]+)\/?$/.exec(path);
  if (m && CODE_RE.test(m[1].toUpperCase())) return { name: "room", code: m[1].toUpperCase() };
  return { name: "home" };
}

export const useRoute = create<{ route: Route; go: (path: string, replace?: boolean) => void }>((set) => ({
  route: parse(location.pathname),
  go: (path, replace = false) => {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    set({ route: parse(path) });
  },
}));

window.addEventListener("popstate", () => useRoute.setState({ route: parse(location.pathname) }));

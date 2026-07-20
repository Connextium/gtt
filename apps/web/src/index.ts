import { internalRoutes, type InternalRouteDefinition, type InternalWorkflow } from "./internal/internal-routes.js";

export interface WebNavigationItem {
  label: string;
  route: string;
  workflow: InternalWorkflow;
}

export interface WebAppShell {
  app: "gtt-web";
  status: "contract_ready";
  navigation: WebNavigationItem[];
}

export const operationsNavigation: WebNavigationItem[] = internalRoutes.map((route: InternalRouteDefinition) => ({
  label: route.label,
  route: route.path,
  workflow: route.workflow
}));

export const appShell = (): WebAppShell => ({
  app: "gtt-web",
  status: "contract_ready",
  navigation: operationsNavigation
});

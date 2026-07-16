import { createSprint6Application, Sprint6Application } from "../sprint6/application.js";
import { Sprint7LiquidityReconciliationService } from "./liquidity-reconciliation.js";

export class Sprint7Application {
  readonly liquidityReconciliation: Sprint7LiquidityReconciliationService;

  constructor(readonly sprint6: Sprint6Application) {
    this.liquidityReconciliation = new Sprint7LiquidityReconciliationService(sprint6);
  }
}

export const createSprint7Application = (): { app: Sprint7Application; sprint6: Sprint6Application } => {
  const { app: sprint6 } = createSprint6Application();
  return { app: new Sprint7Application(sprint6), sprint6 };
};

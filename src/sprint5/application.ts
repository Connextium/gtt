import { createSprint4Application, Sprint4Application } from "../sprint4/application.js";
import { Sprint5SettlementService } from "./settlement.js";

export class Sprint5Application {
  readonly settlement: Sprint5SettlementService;

  constructor(readonly sprint4: Sprint4Application) {
    this.settlement = new Sprint5SettlementService(sprint4);
  }
}

export const createSprint5Application = (): { app: Sprint5Application; sprint4: Sprint4Application } => {
  const { app: sprint4 } = createSprint4Application();
  return {
    app: new Sprint5Application(sprint4),
    sprint4
  };
};

import { createSprint5Application, Sprint5Application } from "../sprint5/application.js";
import { Sprint6ExternalRedemptionService } from "./external-redemption.js";

export class Sprint6Application {
  readonly externalRedemption: Sprint6ExternalRedemptionService;

  constructor(readonly sprint5: Sprint5Application) {
    this.externalRedemption = new Sprint6ExternalRedemptionService(sprint5);
  }
}

export const createSprint6Application = (): { app: Sprint6Application; sprint5: Sprint5Application } => {
  const { app: sprint5 } = createSprint5Application();
  return { app: new Sprint6Application(sprint5), sprint5 };
};

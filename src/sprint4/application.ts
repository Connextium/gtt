import { createSprint3Application, Sprint3Application } from "../sprint3/application.js";
import { TreasuryPositionService } from "./positions.js";

export class Sprint4Application {
  readonly positions: TreasuryPositionService;

  constructor(readonly sprint3: Sprint3Application) {
    this.positions = new TreasuryPositionService(sprint3);
  }
}

export const createSprint4Application = (): { app: Sprint4Application; sprint3: Sprint3Application } => {
  const { app: sprint3 } = createSprint3Application();
  return {
    app: new Sprint4Application(sprint3),
    sprint3
  };
};

import { createSprint2Application, Sprint2Application } from "../sprint2/application.js";
import { ObligationReservationService } from "./obligations.js";

export class Sprint3Application {
  readonly obligations: ObligationReservationService;

  constructor(readonly sprint2: Sprint2Application) {
    this.obligations = new ObligationReservationService(sprint2);
  }
}

export const createSprint3Application = (): { app: Sprint3Application; sprint2: Sprint2Application } => {
  const { app: sprint2 } = createSprint2Application();
  return {
    app: new Sprint3Application(sprint2),
    sprint2
  };
};

import { createSprint7Application, Sprint7Application } from "../sprint7/application.js";
import { Sprint8HardeningReleaseService } from "./hardening-release.js";

export class Sprint8Application {
  readonly hardeningRelease: Sprint8HardeningReleaseService;

  constructor(readonly sprint7: Sprint7Application) {
    this.hardeningRelease = new Sprint8HardeningReleaseService(sprint7);
  }
}

export const createSprint8Application = (): { app: Sprint8Application; sprint7: Sprint7Application } => {
  const { app: sprint7 } = createSprint7Application();
  return { app: new Sprint8Application(sprint7), sprint7 };
};

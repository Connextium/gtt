import { createSprint1Application, Sprint1Application } from "../sprint1/application.js";
import type { InMemorySprint1Store } from "../sprint1/store.js";
import type { ActorContext } from "../sprint1/types.js";
import { BalanceProjectionService } from "./balances.js";
import { OnboardingApplicationService } from "./onboarding.js";
import { CircleOnboardingSimulator } from "./onboarding-simulator.js";
import type { OnboardingAdapter, ProductSurfaceSnapshot } from "./types.js";

export class Sprint2Application {
  readonly balances: BalanceProjectionService;
  readonly onboarding: OnboardingApplicationService;

  constructor(
    readonly sprint1: Sprint1Application,
    readonly store: InMemorySprint1Store,
    onboardingAdapter: OnboardingAdapter
  ) {
    this.balances = new BalanceProjectionService(store);
    this.onboarding = new OnboardingApplicationService(sprint1, store, onboardingAdapter);
  }

  getProductSurfaceSnapshot(context: ActorContext): ProductSurfaceSnapshot {
    const accounts = this.sprint1.listAccountsOfDigitalAsset(context);
    return {
      roleNavigation: context.roles.includes("auditor")
        ? ["business_clients", "accounts_of_digital_asset", "statements"]
        : ["business_clients", "onboarding", "accounts_of_digital_asset", "balances"],
      businessClients: this.sprint1.listBusinessClients(context),
      onboardingApplications: this.onboarding.listApplications(context),
      accountsOfDigitalAsset: accounts,
      accountBalanceCards: accounts.map((account) => this.balances.getClassifiedBalance(context, account.id))
    };
  }
}

export const createSprint2Application = (): {
  app: Sprint2Application;
  store: InMemorySprint1Store;
  adapter: CircleOnboardingSimulator;
} => {
  const { app: sprint1, store } = createSprint1Application();
  const adapter = new CircleOnboardingSimulator();
  return {
    app: new Sprint2Application(sprint1, store, adapter),
    store,
    adapter
  };
};

import { nextId } from "../sprint1/ids.js";
import type { OnboardingAdapter, OnboardingSchema, OnboardingStatus } from "./types.js";

export class CircleOnboardingSimulator implements OnboardingAdapter {
  private readonly applications = new Map<string, OnboardingStatus>();

  async createApplication(input: { legalName: string; country: string }): Promise<{
    providerApplicationId: string;
    providerClientEntityId: string;
    status: OnboardingStatus;
  }> {
    const providerApplicationId = nextId("circle_application");
    const providerClientEntityId = nextId("circle_client");
    this.applications.set(providerApplicationId, "draft");
    void input;
    return {
      providerApplicationId,
      providerClientEntityId,
      status: "draft"
    };
  }

  async retrieveSchema(providerApplicationId: string): Promise<OnboardingSchema> {
    this.requireApplication(providerApplicationId);
    return {
      version: "simulator-2026-07",
      sections: [
        {
          key: "business_information",
          title: "Business information",
          fields: [
            { key: "legal_name", type: "text", required: true },
            { key: "country", type: "country", required: true },
            { key: "registration_number", type: "text", required: true }
          ]
        },
        {
          key: "authorized_representative",
          title: "Authorized representative",
          fields: [
            { key: "full_name", type: "text", required: true },
            { key: "date_of_birth", type: "date", required: true },
            { key: "identity_document", type: "document", required: true }
          ]
        }
      ]
    };
  }

  async submitApplication(providerApplicationId: string): Promise<OnboardingStatus> {
    this.requireApplication(providerApplicationId);
    this.applications.set(providerApplicationId, "submitted");
    return "submitted";
  }

  async getApplicationStatus(providerApplicationId: string): Promise<OnboardingStatus> {
    this.requireApplication(providerApplicationId);
    const current = this.applications.get(providerApplicationId);
    if (current === "submitted" || current === "in_review") {
      this.applications.set(providerApplicationId, "approved");
      return "approved";
    }
    return current ?? "draft";
  }

  private requireApplication(providerApplicationId: string): void {
    if (!this.applications.has(providerApplicationId)) {
      throw new Error("onboarding_application_not_found");
    }
  }
}

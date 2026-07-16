import { Sprint1Application } from "../sprint1/application.js";
import { DomainError, invariant } from "../sprint1/errors.js";
import { nextId, nowIso } from "../sprint1/ids.js";
import type { InMemorySprint1Store } from "../sprint1/store.js";
import type { AccountOfDigitalAsset, ActorContext } from "../sprint1/types.js";
import type {
  OnboardingAdapter,
  OnboardingApplication,
  OnboardingDocument,
  OnboardingSchemaSnapshot,
  OnboardingSectionResponse
} from "./types.js";

export class OnboardingApplicationService {
  private readonly applications = new Map<string, OnboardingApplication>();
  private readonly schemas = new Map<string, OnboardingSchemaSnapshot>();
  private readonly sections = new Map<string, OnboardingSectionResponse>();
  private readonly documents = new Map<string, OnboardingDocument>();
  private readonly processedWebhookEvents = new Set<string>();

  constructor(
    private readonly sprint1: Sprint1Application,
    private readonly store: InMemorySprint1Store,
    private readonly adapter: OnboardingAdapter
  ) {}

  async createOnboardingApplication(context: ActorContext, businessClientId: string): Promise<OnboardingApplication> {
    const client = this.sprint1.getBusinessClient(context, businessClientId);
    invariant(Boolean(client), "business_client_not_found", { businessClientId });

    const provider = await this.adapter.createApplication({
      legalName: client!.legalName,
      country: client!.country
    });
    const now = nowIso();
    const application: OnboardingApplication = {
      id: nextId("onboarding"),
      tenantId: context.tenantId,
      businessClientId,
      provider: "circle_simulator",
      providerApplicationId: provider.providerApplicationId,
      providerClientEntityId: provider.providerClientEntityId,
      status: provider.status,
      createdAt: now,
      updatedAt: now
    };
    this.applications.set(application.id, application);
    return application;
  }

  async retrieveOnboardingSchema(context: ActorContext, onboardingApplicationId: string): Promise<OnboardingSchemaSnapshot> {
    const application = this.requireApplication(context, onboardingApplicationId);
    const schema = await this.adapter.retrieveSchema(application.providerApplicationId);
    const snapshot: OnboardingSchemaSnapshot = {
      id: nextId("schema"),
      tenantId: context.tenantId,
      onboardingApplicationId,
      provider: application.provider,
      schemaVersion: schema.version,
      schemaBody: schema,
      retrievedAt: nowIso()
    };
    this.schemas.set(snapshot.id, snapshot);
    return snapshot;
  }

  saveOnboardingSection(
    context: ActorContext,
    onboardingApplicationId: string,
    sectionKey: string,
    responseBody: Record<string, unknown>
  ): OnboardingSectionResponse {
    this.requireApplication(context, onboardingApplicationId);
    const mapKey = `${onboardingApplicationId}:${sectionKey}`;
    const existing = this.sections.get(mapKey);
    const response: OnboardingSectionResponse = {
      id: existing?.id ?? nextId("section"),
      tenantId: context.tenantId,
      onboardingApplicationId,
      sectionKey,
      responseBody,
      version: existing ? existing.version + 1 : 1,
      updatedAt: nowIso()
    };
    this.sections.set(mapKey, response);
    return response;
  }

  addDocumentMetadata(
    context: ActorContext,
    onboardingApplicationId: string,
    input: { documentType: string; fileName: string; externalReference?: string }
  ): OnboardingDocument {
    this.requireApplication(context, onboardingApplicationId);
    const document: OnboardingDocument = {
      id: nextId("document"),
      tenantId: context.tenantId,
      onboardingApplicationId,
      documentType: input.documentType,
      fileName: input.fileName,
      externalReference: input.externalReference,
      status: "metadata_recorded",
      createdAt: nowIso()
    };
    this.documents.set(document.id, document);
    return document;
  }

  async submitOnboardingApplication(context: ActorContext, onboardingApplicationId: string): Promise<OnboardingApplication> {
    const application = this.requireApplication(context, onboardingApplicationId);
    const status = await this.adapter.submitApplication(application.providerApplicationId);
    const updated = {
      ...application,
      status,
      submittedAt: nowIso(),
      updatedAt: nowIso()
    };
    this.applications.set(updated.id, updated);
    return updated;
  }

  async pollOnboardingStatus(context: ActorContext, onboardingApplicationId: string): Promise<OnboardingApplication> {
    const application = this.requireApplication(context, onboardingApplicationId);
    const status = await this.adapter.getApplicationStatus(application.providerApplicationId);
    const updated = {
      ...application,
      status,
      approvedAt: status === "approved" ? nowIso() : application.approvedAt,
      updatedAt: nowIso()
    };
    this.applications.set(updated.id, updated);
    return updated;
  }

  mapApprovedApplication(context: ActorContext, onboardingApplicationId: string): AccountOfDigitalAsset {
    const application = this.requireApplication(context, onboardingApplicationId);
    invariant(application.status === "approved", "onboarding_application_not_approved");
    this.sprint1.mapApprovedOnboarding(
      context,
      application.businessClientId,
      application.providerClientEntityId,
      application.providerApplicationId
    );
    return this.sprint1.createAccountOfDigitalAsset(context, {
      businessClientId: application.businessClientId,
      accountName: "Primary Settlement ADA",
      usePurpose: "settlement",
      circleAccountId: nextId("circle_account"),
      circleSubAccountId: nextId("circle_sub_account"),
      idempotencyKey: `map_approved_${onboardingApplicationId}`
    });
  }

  handleWebhookEvent(context: ActorContext, event: { eventId: string; eventType: string; payload: unknown }): void {
    if (this.processedWebhookEvents.has(event.eventId)) {
      return;
    }
    this.store.insertInboundEvent(this.store.createInboundEvent("circle_simulator", event.eventId, event.eventType, event.payload));
    this.processedWebhookEvents.add(event.eventId);
    void context;
  }

  listApplications(context: ActorContext): OnboardingApplication[] {
    return [...this.applications.values()].filter((application) => application.tenantId === context.tenantId);
  }

  schemaSnapshotCount(): number {
    return this.schemas.size;
  }

  sectionCount(): number {
    return this.sections.size;
  }

  documentCount(): number {
    return this.documents.size;
  }

  private requireApplication(context: ActorContext, onboardingApplicationId: string): OnboardingApplication {
    const application = this.applications.get(onboardingApplicationId);
    if (!application) {
      throw new DomainError("onboarding_application_not_found");
    }
    invariant(application.tenantId === context.tenantId, "tenant_access_denied");
    return application;
  }
}

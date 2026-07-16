import { createInitialState, emitAudit, emitOutbox, type ApiState, type EventRecord } from "../data.js";
import { loadApiStateSnapshot, saveApiStateSnapshot } from "../db/state-store.js";

export interface WorkerResult {
  processedOutbox: number;
  processedInbox: number;
  deadLettered: number;
}

const maxAttempts = Number(process.env.GTT_EVENT_MAX_ATTEMPTS ?? 3);

export const processEvents = async (state: ApiState): Promise<WorkerResult> => {
  let processedOutbox = 0;
  let processedInbox = 0;
  let deadLettered = 0;

  for (const event of pendingEvents(state.outbox)) {
    if (processEvent(state, event, "outbox")) processedOutbox += 1;
    if (event.status === "dead_letter") deadLettered += 1;
  }

  for (const event of pendingEvents(state.inbox)) {
    if (processEvent(state, event, "inbox")) processedInbox += 1;
    if (event.status === "dead_letter") deadLettered += 1;
  }

  return { processedOutbox, processedInbox, deadLettered };
};

export const runWorkerOnce = async (): Promise<WorkerResult> => {
  const state = await loadApiStateSnapshot(createInitialState());
  const result = await processEvents(state);
  await saveApiStateSnapshot(state);
  return result;
};

const pendingEvents = (events: EventRecord[]) => events.filter((event) => event.status === "pending");

const processEvent = (state: ApiState, event: EventRecord, source: "outbox" | "inbox"): boolean => {
  try {
    event.attemptCount += 1;
    if (event.eventType === "circle.transfer.status_changed") {
      applyCircleStatusChange(state, event);
    }
    event.status = "processed";
    event.processedAt = new Date().toISOString();
    emitAudit(state, {
      eventType: `event.${source}.processed`,
      correlationId: event.id
    });
    return true;
  } catch (error) {
    event.failureReason = error instanceof Error ? error.message : "event_processing_failed";
    if (event.attemptCount >= maxAttempts) {
      event.status = "dead_letter";
      state.deadLetters.push({ ...event, id: event.id.startsWith("dead") ? event.id : `dead_${event.id}` });
      emitOutbox(state, "dead_letter.created", { source, eventId: event.id, eventType: event.eventType });
    }
    return false;
  }
};

const applyCircleStatusChange = (state: ApiState, event: EventRecord): void => {
  const resourceId = typeof event.payload.resourceId === "string" ? event.payload.resourceId : undefined;
  const providerEventId = typeof event.payload.providerEventId === "string" ? event.payload.providerEventId : undefined;
  const status = typeof event.payload.status === "string" ? event.payload.status : "unknown";
  const target = state.payments.find((payment) => payment.providerTransferId === resourceId || payment.providerTransferId === providerEventId);
  if (!target) return;
  target.status = status === "complete" || status === "confirmed" ? "complete" : status === "failed" ? "failed" : target.status;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorkerOnce()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

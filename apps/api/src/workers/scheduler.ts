import { createInitialState, emitAudit, emitOutbox, newId, type ApiState } from "../data.js";
import { loadApiStateSnapshot, saveApiStateSnapshot } from "../db/state-store.js";

export interface SchedulerResult {
  expiredReservations: number;
  reconciliationRunsCreated: number;
}

export const runScheduledJobs = async (state: ApiState): Promise<SchedulerResult> => {
  const now = Date.now();
  let expiredReservations = 0;
  for (const reservation of state.reservations) {
    if (reservation.status === "active") {
      const ageMs = now - new Date(reservation.createdAt).getTime();
      const ttlMs = Number(process.env.GTT_RESERVATION_TTL_MS ?? 24 * 60 * 60 * 1000);
      if (ageMs > ttlMs) {
        reservation.status = "expired";
        expiredReservations += 1;
        emitOutbox(state, "funding_reservation.expired", { reservationId: reservation.id });
      }
    }
  }

  const runId = newId("recon_run");
  emitAudit(state, {
    eventType: "reconciliation.run.scheduled",
    correlationId: runId
  });

  return {
    expiredReservations,
    reconciliationRunsCreated: 1
  };
};

export const runSchedulerOnce = async (): Promise<SchedulerResult> => {
  const state = await loadApiStateSnapshot(createInitialState());
  const result = await runScheduledJobs(state);
  await saveApiStateSnapshot(state);
  return result;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runSchedulerOnce()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

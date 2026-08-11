export const moduleName = "client-onboarding";
export {
  authenticateBusinessUser,
  handleGetMyAdaBalance,
  handleGetMyAdaStatement,
  handleGetOrCreateMyOnboarding,
  handleRespondToMyOnboardingRfi,
  handleSaveMyOnboardingStep,
  handleSelfRegistrationInvitation,
  handleSubmitMyOnboarding,
  isValidEmail,
  normalizeEmail
} from "./self-registration.js";
export type { AuthenticatedBusinessUser } from "./self-registration.js";

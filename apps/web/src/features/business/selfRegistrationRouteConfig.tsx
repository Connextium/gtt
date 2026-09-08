import { type ReactNode } from "react";
import { CheckEmailScreen, RegisterScreen, SetPasswordScreen, SignInScreen } from "./onboarding/AuthScreensModule.js";
import { OnboardingStepsModule } from "./onboarding/OnboardingStepsModule.js";
import { PendingReviewModule, RfiResponseModule } from "./onboarding/PendingReviewModule.js";
import { SubmissionConfirmedModule } from "./onboarding/SubmissionConfirmedModule.js";
import { nextOnboardingRoute, onboardingStepNumber, routeForApplication } from "./onboarding/onboardingRouting.js";
import { AuthGuard } from "./shared/AuthGuard.js";
import { type BusinessJwtSession } from "./shared/useSupabaseSession.js";
import { SovereignTreasuryScreen } from "./treasury/SovereignTreasuryScreen.js";
import { WelcomeLandingModule } from "./welcome/WelcomeLandingModule.js";

export type Navigate = (path: string) => void;

export const selfRegistrationRoutes = new Set([
  "/",
  "/register",
  "/sign-in",
  "/auth/check-email",
  "/auth/set-password",
  "/onboarding/step-1",
  "/onboarding/step-2",
  "/onboarding/step-3",
  "/onboarding/step-4",
  "/submission-confirmed",
  "/application-pending",
  "/rfi-response",
  "/treasury",
  "/business/client-account",
  "/business/treasury/funding",
  "/welcome"
]);

export function resolveSelfRegistrationRoute({
  loading,
  navigate,
  onAuthenticated,
  onLogout,
  path,
  session
}: {
  loading: boolean;
  navigate: Navigate;
  onAuthenticated: (session: BusinessJwtSession) => void;
  onLogout: () => Promise<void> | void;
  path: string;
  session: BusinessJwtSession | null;
}): ReactNode {
  if (path === "/" || path === "/register") return <RegisterScreen navigate={navigate} />;
  if (path === "/sign-in") return <SignInScreen navigate={navigate} onAuthenticated={onAuthenticated} />;
  if (path === "/auth/check-email") return <CheckEmailScreen navigate={navigate} />;
  if (path === "/auth/set-password") {
    return <SetPasswordScreen navigate={navigate} nextOnboardingRoute={nextOnboardingRoute} onAuthenticated={onAuthenticated} session={session} />;
  }
  if (path === "/submission-confirmed") {
    return withAuth(
      <SubmissionConfirmedModule navigate={navigate} onLogout={onLogout} session={session} />,
      loading,
      navigate,
      session
    );
  }
  if (path === "/application-pending") {
    return withAuth(
      <PendingReviewModule navigate={navigate} onLogout={onLogout} routeForApplication={routeForApplication} session={session} />,
      loading,
      navigate,
      session
    );
  }
  if (path === "/rfi-response") {
    return withAuth(<RfiResponseModule navigate={navigate} onLogout={onLogout} session={session} />, loading, navigate, session);
  }
  if (path === "/treasury") {
    return withAuth(<SovereignTreasuryScreen navigate={navigate} onLogout={onLogout} session={session} />, loading, navigate, session);
  }
  if (path === "/business/client-account") {
    return withAuth(
      <SovereignTreasuryScreen
        initialView="open-account"
        navigate={navigate}
        onLogout={onLogout}
        session={session}
      />,
      loading,
      navigate,
      session
    );
  }
  const fundingDetailMatch = path.match(/^\/business\/treasury\/funding\/([^/]+)$/);
  if (path === "/business/treasury/funding" || fundingDetailMatch) {
    return withAuth(
      <SovereignTreasuryScreen
        initialFundingInstructionId={fundingDetailMatch ? decodeURIComponent(fundingDetailMatch[1]!) : undefined}
        initialView="funding"
        navigate={navigate}
        onLogout={onLogout}
        session={session}
      />,
      loading,
      navigate,
      session
    );
  }
  if (path === "/welcome") {
    return withAuth(
      <WelcomeLandingModule navigate={navigate} onLogout={onLogout} session={session} />,
      loading,
      navigate,
      session
    );
  }
  if (path.startsWith("/onboarding/")) {
    return withAuth(
      <OnboardingStepsModule
        navigate={navigate}
        onboardingStepNumber={onboardingStepNumber}
        onLogout={onLogout}
        path={path}
        routeForApplication={routeForApplication}
        session={session}
      />,
      loading,
      navigate,
      session
    );
  }
  return <RegisterScreen navigate={navigate} />;
}

function withAuth(children: ReactNode, loading: boolean, navigate: Navigate, session: BusinessJwtSession | null): ReactNode {
  return (
    <AuthGuard isAuthenticated={Boolean(session)} isLoading={loading} onUnauthenticated={() => navigate("/register")}>
      {children}
    </AuthGuard>
  );
}

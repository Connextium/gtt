import { type Session } from "@supabase/supabase-js";
import { type ReactNode } from "react";
import { CheckEmailScreen, RegisterScreen, SetPasswordScreen, SignInScreen } from "./onboarding/AuthScreensModule.js";
import { OnboardingStepsModule } from "./onboarding/OnboardingStepsModule.js";
import { PendingReviewModule, RfiResponseModule } from "./onboarding/PendingReviewModule.js";
import { SubmissionConfirmedModule } from "./onboarding/SubmissionConfirmedModule.js";
import { nextOnboardingRoute, onboardingStepNumber, routeForApplication } from "./onboarding/onboardingRouting.js";
import { AuthGuard } from "./shared/AuthGuard.js";
import { SovereignTreasuryScreen } from "./treasury/SovereignTreasuryScreen.js";
import { WelcomeLandingModule } from "./welcome/WelcomeLandingModule.js";

export type Navigate = (path: string) => void;

type AuthSupabase = Parameters<typeof SignInScreen>[0]["supabase"];

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
  "/business/treasury/funding",
  "/welcome"
]);

export function resolveSelfRegistrationRoute({
  loading,
  navigate,
  onLogout,
  path,
  session,
  supabase
}: {
  loading: boolean;
  navigate: Navigate;
  onLogout: () => Promise<void> | void;
  path: string;
  session: Session | null;
  supabase: AuthSupabase;
}): ReactNode {
  if (path === "/" || path === "/register") return <RegisterScreen navigate={navigate} />;
  if (path === "/sign-in") return <SignInScreen navigate={navigate} supabase={supabase} />;
  if (path === "/auth/check-email") return <CheckEmailScreen navigate={navigate} />;
  if (path === "/auth/set-password") {
    return <SetPasswordScreen navigate={navigate} nextOnboardingRoute={nextOnboardingRoute} session={session} supabase={supabase} />;
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
    return withAuth(<SovereignTreasuryScreen navigate={navigate} session={session} />, loading, navigate, session);
  }
  if (path === "/business/treasury/funding") {
    return withAuth(
      <SovereignTreasuryScreen initialView="funding" navigate={navigate} session={session} />,
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

function withAuth(children: ReactNode, loading: boolean, navigate: Navigate, session: Session | null): ReactNode {
  return (
    <AuthGuard isAuthenticated={Boolean(session)} isLoading={loading} onUnauthenticated={() => navigate("/register")}>
      {children}
    </AuthGuard>
  );
}

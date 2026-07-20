import { SelfRegistrationRouter, selfRegistrationRoutes } from "../../self-registration.js";

export const isBusinessRoute = (path: string): boolean =>
  selfRegistrationRoutes.has(path) || path.startsWith("/onboarding/");

export const BusinessApp = ({
  navigate,
  path
}: {
  navigate: (path: string) => void;
  path: string;
}) => <SelfRegistrationRouter path={path} navigate={navigate} />;

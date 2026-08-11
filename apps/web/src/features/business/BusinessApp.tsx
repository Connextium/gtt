import { SelfRegistrationRouter, selfRegistrationRoutes } from "../../self-registration.js";

export const isBusinessRoute = (path: string): boolean =>
  selfRegistrationRoutes.has(path)
  || path.startsWith("/onboarding/")
  || path.startsWith("/business/treasury/funding/");

export const BusinessApp = ({
  navigate,
  path
}: {
  navigate: (path: string) => void;
  path: string;
}) => {
  return <SelfRegistrationRouter path={path} navigate={navigate} />;
};

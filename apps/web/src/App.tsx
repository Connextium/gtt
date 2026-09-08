import { Suspense, lazy, useEffect, useState } from "react";
import "./styles.css";

const BusinessApp = lazy(() => import("./features/business/BusinessApp.js").then((module) => ({ default: module.BusinessApp })));
const InternalApp = lazy(() => import("./internal/InternalApp.js").then((module) => ({ default: module.InternalApp })));

export const App = () => {
  const [path, setPath] = useState(window.location.pathname);

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(window.location.pathname);
  };

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const internalRoute = path === "/internal" || path.startsWith("/internal/");

  return (
    <Suspense fallback={<div className="gtt-app-loading">Loading application...</div>}>
      {internalRoute ? <InternalApp navigate={navigate} path={path} /> : <BusinessApp navigate={navigate} path={path} />}
    </Suspense>
  );
};

import { useEffect, useState } from "react";
import { BusinessApp, isBusinessRoute } from "./features/business/BusinessApp.js";
import { InternalApp, isInternalRoute } from "./internal/InternalApp.js";
import "./styles.css";

export const App = () => {
  const [path, setPath] = useState(window.location.pathname);

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (isBusinessRoute(path)) {
    return <BusinessApp navigate={navigate} path={path} />;
  }

  if (isInternalRoute(path)) {
    return <InternalApp navigate={navigate} path={path} />;
  }

  return <BusinessApp navigate={navigate} path="/" />;
};

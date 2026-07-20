import type { ApiState } from "../data.js";

export const cloneApiState = (state: ApiState): ApiState => structuredClone(state);

export const replaceApiState = (target: ApiState, source: ApiState): void => {
  for (const key of Object.keys(target) as Array<keyof ApiState>) {
    delete target[key];
  }
  Object.assign(target, source);
};

export const withApiStateTransaction = async <T>(
  state: ApiState,
  work: (draft: ApiState) => Promise<T> | T,
  beforeCommit?: (draft: ApiState, result: T) => Promise<void> | void
): Promise<T> => {
  const draft = cloneApiState(state);
  const result = await work(draft);
  await beforeCommit?.(draft, result);
  replaceApiState(state, draft);
  return result;
};

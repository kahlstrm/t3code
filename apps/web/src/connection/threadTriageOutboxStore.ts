import {
  makeThreadTriageOutboxStore,
  ThreadTriageOutboxStorageError,
} from "@t3tools/client-runtime/platform";
import * as Effect from "effect/Effect";

const STORAGE_KEY = "t3code:thread-triage-outbox";

/** Resolves with the release once the lock is granted, so the locked work runs on the caller's fiber. */
const acquireLock = (locks: LockManager) =>
  Effect.tryPromise({
    try: () =>
      new Promise<() => void>((granted, rejected) => {
        locks
          .request(STORAGE_KEY, () => new Promise<void>((release) => granted(() => release())))
          .catch(rejected);
      }),
    catch: (cause) => new ThreadTriageOutboxStorageError({ cause }),
  });

/** Kept out of the environment cache so clearing cached data keeps unsynced settles and snoozes. */
export const browserThreadTriageOutboxStore = makeThreadTriageOutboxStore({
  read: Effect.try({
    try: () => window.localStorage.getItem(STORAGE_KEY),
    catch: (cause) => new ThreadTriageOutboxStorageError({ cause }),
  }),
  write: (value) =>
    Effect.try({
      try: () => window.localStorage.setItem(STORAGE_KEY, value),
      catch: (cause) => new ThreadTriageOutboxStorageError({ cause }),
    }),
  // Reject writes without cross-tab exclusion so shared localStorage changes cannot be lost.
  exclusive: (effect) =>
    typeof navigator === "undefined" || navigator.locks === undefined
      ? Effect.fail(
          new ThreadTriageOutboxStorageError({
            cause: new Error("Offline thread changes require Web Locks. Use HTTPS or localhost."),
          }),
        )
      : Effect.acquireUseRelease(
          acquireLock(navigator.locks),
          () => effect,
          (release) => Effect.sync(release),
        ),
});

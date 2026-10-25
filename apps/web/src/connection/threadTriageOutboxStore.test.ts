import { describe, expect, it } from "@effect/vitest";
import { CommandId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ThreadTriageOutboxStorageError } from "@t3tools/client-runtime/platform";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { afterEach, vi } from "vite-plus/test";

import { browserThreadTriageOutboxStore } from "./threadTriageOutboxStore";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser thread triage storage", () => {
  it.effect.each(["unavailable", "rejected"] as const)(
    "refuses to save queued changes when the shared lock is %s",
    (lock) =>
      Effect.gen(function* () {
        const setItem = vi.fn();
        vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem } });
        vi.stubGlobal(
          "navigator",
          lock === "unavailable"
            ? {}
            : { locks: { request: () => Promise.reject(new Error("Lock request denied")) } },
        );

        const result = yield* Effect.exit(
          browserThreadTriageOutboxStore.put({
            environmentId: EnvironmentId.make("remote"),
            threadId: ThreadId.make("thread"),
            commandId: CommandId.make("queued-settle"),
            action: { type: "settle" },
            queuedAt: DateTime.makeUnsafe("2026-09-12T10:00:00.000Z"),
            snapshotSequence: 1,
          }),
        );

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(Cause.squash(result.cause)).toBeInstanceOf(ThreadTriageOutboxStorageError);
        }
        expect(setItem).not.toHaveBeenCalled();
      }),
  );

  it.effect("persists a queued change when the shared lock is available", () =>
    Effect.gen(function* () {
      let raw: string | null = null;
      vi.stubGlobal("window", {
        localStorage: {
          getItem: () => raw,
          setItem: (_key: string, value: string) => {
            raw = value;
          },
        },
      });
      vi.stubGlobal("navigator", {
        locks: { request: (_name: string, callback: () => Promise<unknown>) => callback() },
      });
      const entry = {
        environmentId: EnvironmentId.make("remote"),
        threadId: ThreadId.make("thread"),
        commandId: CommandId.make("queued-settle"),
        action: { type: "settle" as const },
        queuedAt: DateTime.makeUnsafe("2026-09-12T10:00:00.000Z"),
        snapshotSequence: 1,
      };

      yield* browserThreadTriageOutboxStore.put(entry);

      expect((yield* browserThreadTriageOutboxStore.load).entries).toEqual([entry]);
    }),
  );

  it.effect("clears retained environment state even when its storage lock is unavailable", () =>
    Effect.gen(function* () {
      vi.stubGlobal("navigator", {});
      const environmentId = EnvironmentId.make("removed");
      const retained = new Set([environmentId]);
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          browserThreadTriageOutboxStore.subscribeCleared((removed) => retained.delete(removed)),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      );

      const result = yield* Effect.exit(
        browserThreadTriageOutboxStore.clearEnvironment(environmentId),
      );

      expect(result._tag).toBe("Failure");
      expect(retained.size).toBe(0);
    }),
  );
});

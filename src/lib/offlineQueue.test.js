import { describe, it, expect, beforeEach, vi } from "vitest";
import { enqueue, drain, registerHandler, getState, discardAll, retryNow } from "./offlineQueue";

// The offline queue holds points that have been tapped but not yet saved. If
// it loses one, reorders them, or replays one twice, the score on the bracket
// is wrong and nobody can tell why. So the ordering and durability guarantees
// are tested rather than trusted.

beforeEach(() => {
  localStorage.clear();
  discardAll();
});

describe("enqueue and drain", () => {
  it("sends a queued operation and clears it", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerHandler("test_ok", handler);

    enqueue("test_ok", ["match-1", "A", 1]);
    await drain();

    expect(handler).toHaveBeenCalledWith("match-1", "A", 1);
    expect(getState().pending).toBe(0);
  });

  it("replays in the order the taps happened", async () => {
    const seen = [];
    registerHandler("test_order", async (n) => { seen.push(n); });

    for (let i = 1; i <= 5; i++) enqueue("test_order", [i]);
    await drain();

    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps an operation queued when the network fails", async () => {
    registerHandler("test_offline", async () => { throw new Error("Failed to fetch"); });

    enqueue("test_offline", ["x"]);
    await drain();

    expect(getState().pending).toBe(1);
  });

  it("does not send later operations ahead of a failed one", async () => {
    const seen = [];
    let failing = true;
    registerHandler("test_block", async (n) => {
      if (failing) throw new Error("Failed to fetch");
      seen.push(n);
    });

    enqueue("test_block", [1]);
    enqueue("test_block", [2]);
    await drain();
    expect(seen).toEqual([]);          // nothing jumped the queue
    expect(getState().pending).toBe(2);

    failing = false;
    await retryNow();
    expect(seen).toEqual([1, 2]);      // and then in the right order
    expect(getState().pending).toBe(0);
  });

  it("survives a page reload, because the queue is in localStorage", async () => {
    registerHandler("test_persist", async () => { throw new Error("Failed to fetch"); });
    enqueue("test_persist", ["a"]);
    await drain();

    // Simulate a reload: the module keeps no in-memory copy of the queue.
    expect(JSON.parse(localStorage.getItem("md_offline_queue_v1"))).toHaveLength(1);
    expect(getState().pending).toBe(1);
  });

  it("gives up on an operation the server keeps rejecting, so it cannot block the rest forever", async () => {
    const seen = [];
    registerHandler("test_reject", async (n) => {
      if (n === 1) throw new Error("new row violates row-level security policy");
      seen.push(n);
    });

    enqueue("test_reject", [1]);
    enqueue("test_reject", [2]);

    // Three attempts on a permanent failure, then it is dropped and the queue
    // moves on. A rejected write is never going to succeed on the tenth try.
    await drain(); await drain(); await drain();

    expect(seen).toEqual([2]);
    expect(getState().pending).toBe(0);
  });

  it("keeps retrying a network failure rather than dropping it", async () => {
    registerHandler("test_net", async () => { throw new Error("NetworkError when attempting to fetch"); });
    enqueue("test_net", ["a"]);

    await drain(); await drain(); await drain(); await drain();

    // Still queued: unlike a rejection, a network failure is expected to
    // succeed later, and dropping it would silently lose a point.
    expect(getState().pending).toBe(1);
  });

  it("drops an operation with no registered handler instead of jamming", async () => {
    enqueue("test_unknown_kind", ["a"]);
    await drain();
    expect(getState().pending).toBe(0);
  });

  it("refuses to queue beyond its limit rather than discarding earlier points", async () => {
    registerHandler("test_full", async () => { throw new Error("Failed to fetch"); });
    for (let i = 0; i < 500; i++) enqueue("test_full", [i]);
    expect(() => enqueue("test_full", [501])).toThrow(/Too many unsent changes/);
  });

  it("reports the pending count to subscribers so the banner can be truthful", async () => {
    registerHandler("test_sub", async () => { throw new Error("Failed to fetch"); });
    enqueue("test_sub", ["a"]);
    enqueue("test_sub", ["b"]);
    await drain();
    expect(getState().pending).toBe(2);
    expect(getState().oldestAt).toBeTruthy();
  });
});

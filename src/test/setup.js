import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement these, and components that use them would
// otherwise throw during a test rather than failing on their actual behaviour.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!window.scrollTo) window.scrollTo = () => {};

if (!global.IntersectionObserver) {
  global.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}

// Nothing in the test suite may reach the network. Any test that needs a
// specific response mocks it explicitly; the default is a client that returns
// empty results rather than one that tries to open a socket.
vi.mock("../lib/supabaseClient", () => {
  const chain = () => {
    const result = Promise.resolve({ data: null, error: null });
    const proxy = new Proxy(result, {
      get(target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          return target[prop].bind(target);
        }
        return () => proxy;
      },
    });
    return proxy;
  };

  return {
    supabase: {
      from: () => chain(),
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signUp: () => Promise.resolve({ data: {}, error: null }),
        signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
        signOut: () => Promise.resolve({ error: null }),
        updateUser: () => Promise.resolve({ error: null }),
        resetPasswordForEmail: () => Promise.resolve({ error: null }),
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

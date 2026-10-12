// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import {
  requestSessionAccount,
  subscribeSessionAccountRequests,
} from "./sessionAccountRequest";

it("tells the app which conversation wants which account, until unsubscribed", () => {
  const listener = vi.fn();
  const stop = subscribeSessionAccountRequests(listener);
  requestSessionAccount("chat-1", "account-work");
  window.dispatchEvent(
    new CustomEvent("monocode-session-account-request", { detail: { x: 1 } }),
  );
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith("chat-1", "account-work");
  stop();
  requestSessionAccount("chat-1", "default");
  expect(listener).toHaveBeenCalledTimes(1);
});

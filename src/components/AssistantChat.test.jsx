import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import AssistantChat from "./AssistantChat";

const repo = vi.hoisted(() => ({ askAssistant: vi.fn(), createTournamentFromPlan: vi.fn() }));
vi.mock("../lib/repository", () => repo);
vi.mock("../lib/AuthContext", () => ({ useAuth: () => ({ session: { user: { id: "u1" } } }) }));

const details = { name: "Sunday Doubles", venue: "Smash Arena", startDate: "2099-11-08" };
const players = ["Rahul", "Arjun", "Kiran", "Sneha"];
const draft = (over = {}, tournament = details) => ({ tournament, categories: [{ category: "MS", format: "ROUND_ROBIN", entries: players, ...over }] });

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function open() {
  return render(
    <MemoryRouter initialEntries={["/organizer"]}>
      <Routes>
        <Route path="/organizer" element={<AssistantChat onManual={() => {}} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const box = () => screen.getByLabelText("Your message");
const type = (text) => fireEvent.change(box(), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send" }));
const createButton = () => screen.findByRole("button", { name: "Create tournament" });

beforeEach(() => {
  window.sessionStorage.clear();
  repo.askAssistant.mockReset();
  repo.createTournamentFromPlan.mockReset();
});

describe("AssistantChat", () => {
  it("turns a message into a preview the organizer can confirm", async () => {
    repo.askAssistant.mockResolvedValue({ reply: "Here's your draw.", draft: draft() });
    open();
    type("Sunday at Smash Arena\nRahul\nArjun\nKiran\nSneha");
    send();
    expect(await screen.findByText("Here's your draw.")).toBeInTheDocument();
    expect(screen.getByText("Sunday Doubles")).toBeInTheDocument();
    expect(screen.getByText(/See all 6 matches/)).toBeInTheDocument();
    expect(await createButton()).toBeEnabled();
  });

  it("keeps Create off and says why until the details are in", async () => {
    repo.askAssistant.mockResolvedValue({ reply: "When is it?", draft: draft({}, { name: "Open" }) });
    open();
    type("Rahul Arjun Kiran Sneha");
    send();
    expect(await screen.findByText(/Still needed: the date, the venue/)).toBeInTheDocument();
    expect(await createButton()).toBeDisabled();
  });

  it("sends the current draft and the whole conversation with a correction", async () => {
    repo.askAssistant.mockResolvedValueOnce({ reply: "Done.", draft: draft() });
    repo.askAssistant.mockResolvedValueOnce({ reply: "Changed.", draft: draft() });
    open();
    type("first");
    send();
    await screen.findByText("Done.");
    type("second");
    send();
    await screen.findByText("Changed.");
    const body = repo.askAssistant.mock.calls[1][0];
    expect(body.draft).toEqual(draft());
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(body.today).toMatch(/^[A-Za-z]+ \d{4}-\d{2}-\d{2}$/);
  });

  it("flags a player a correction dropped, whatever the reply says", async () => {
    repo.askAssistant.mockResolvedValueOnce({ reply: "Done.", draft: draft() });
    repo.askAssistant.mockResolvedValueOnce({ reply: "All set.", draft: draft({ entries: ["Rahul", "Arjun", "Kiran"] }) });
    open();
    type("first");
    send();
    await screen.findByText("Done.");
    type("rename someone");
    send();
    expect(await screen.findByText("Removed: Sneha")).toBeInTheDocument();
  });

  it("puts the text back when the request fails, so a long paste isn't lost", async () => {
    repo.askAssistant.mockRejectedValue(new Error("The assistant is busy right now."));
    open();
    type("a very long list");
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent("busy");
    expect(box()).toHaveValue("a very long list");
    expect(screen.queryByText("Check this")).not.toBeInTheDocument();
  });

  it("refuses text that's too long instead of sending it", async () => {
    open();
    type("x".repeat(38001));
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent("too much text");
    expect(repo.askAssistant).not.toHaveBeenCalled();
  });

  it("opens the tournament after Create", async () => {
    repo.askAssistant.mockResolvedValue({ reply: "Done.", draft: draft() });
    repo.createTournamentFromPlan.mockResolvedValue({ tournament: { id: "t1" } });
    open();
    type("go");
    send();
    fireEvent.click(await createButton());
    expect(await screen.findByTestId("where")).toHaveTextContent("/organizer/t1");
    expect(repo.createTournamentFromPlan.mock.calls[0][0].ready).toBe(true);
  });

  it("links to the tournament when a later step failed, instead of offering Create again", async () => {
    repo.askAssistant.mockResolvedValue({ reply: "Done.", draft: draft() });
    repo.createTournamentFromPlan.mockResolvedValue({ tournament: { id: "t1" }, failed: "Network down" });
    open();
    type("go");
    send();
    fireEvent.click(await createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("The tournament was created");
    fireEvent.click(screen.getByRole("button", { name: "Open the tournament" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/organizer/t1"));
  });

  it("brings the chat back after leaving the page", async () => {
    repo.askAssistant.mockResolvedValue({ reply: "Done.", draft: draft() });
    const first = open();
    type("go");
    send();
    await screen.findByText("Done.");
    first.unmount();
    open();
    expect(screen.getByText("Done.")).toBeInTheDocument();
    expect(screen.getByText("Sunday Doubles")).toBeInTheDocument();
  });

  it("offers the manual route from the start", () => {
    open();
    expect(screen.getByRole("button", { name: "Set up by hand" })).toBeInTheDocument();
  });
});

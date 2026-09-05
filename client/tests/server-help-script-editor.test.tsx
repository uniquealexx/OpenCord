import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ScriptEditor } from "@/components/server-help/script-editor";

function Harness({ initial = "", disabled = false }: { initial?: string; disabled?: boolean }): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="script">Script</label>
      <ScriptEditor id="script" value={value} onChange={setValue} disabled={disabled} />
    </>
  );
}

afterEach(() => cleanup());

describe("script editor", () => {
  it("numbers every line and highlights comments, strings and api calls", () => {
    render(<Harness initial={'// Rules\napi.page("rules", "Rules");\napi.text("No spam", { size: "lg" });'} />);
    const gutter = screen.getByTestId("script-gutter");
    expect(gutter).toHaveTextContent("1");
    expect(gutter).toHaveTextContent("2");
    expect(gutter).toHaveTextContent("3");
    const highlight = screen.getByTestId("script-highlight");
    expect(highlight.textContent).toContain("// Rules");
    expect(highlight.querySelector(".text-emerald-300")).not.toBeNull();
    expect(highlight.querySelector(".text-violet-300")).not.toBeNull();
    expect(highlight.querySelector(".text-slate-500.italic")).not.toBeNull();
  });

  it("edits text through the transparent textarea", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const area = screen.getByLabelText("Script");
    await user.type(area, 'api.page("a", "A");');
    expect(area).toHaveValue('api.page("a", "A");');
    expect(screen.getByTestId("script-gutter")).toHaveTextContent("1");
  });

  it("inserts two spaces on Tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const area = screen.getByLabelText("Script") as HTMLTextAreaElement;
    await user.click(area);
    await user.keyboard("{Tab}");
    expect(area).toHaveValue("  ");
  });

  it("disables input when read-only", () => {
    const onChange = vi.fn();
    render(
      <>
        <label htmlFor="locked">Script</label>
        <ScriptEditor id="locked" value="x" onChange={onChange} disabled />
      </>,
    );
    expect(screen.getByLabelText("Script")).toBeDisabled();
  });
});

import { describe, test, expect, afterEach } from "bun:test";
import { bar, header, status, dim, emphasis } from "../../src/cli/format";
import { setNoColor } from "../../src/cli/format";

describe("color output verification", () => {
  afterEach(() => {
    setNoColor(false);
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
  });

  test("bar produces ANSI escape codes under TTY", () => {
    setNoColor(false);
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    const result = bar(0.5);
    expect(result).toMatch(/\x1b\[/);
  });

  test("header produces ANSI escape codes under TTY", () => {
    setNoColor(false);
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(header("Test")).toMatch(/\x1b\[/);
  });

  test("status produces ANSI escape codes under TTY", () => {
    setNoColor(false);
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(status("success", "Done")).toMatch(/\x1b\[/);
  });

  test("no ANSI codes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(bar(0.5)).not.toMatch(/\x1b\[/);
    expect(header("Test")).not.toMatch(/\x1b\[/);
    expect(status("success", "Done")).not.toMatch(/\x1b\[/);
    expect(dim("text")).not.toMatch(/\x1b\[/);
    expect(emphasis("text")).not.toMatch(/\x1b\[/);
  });

  test("no ANSI codes when not TTY", () => {
    setNoColor(false);
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
    expect(bar(0.5)).not.toMatch(/\x1b\[/);
    expect(header("Test")).not.toMatch(/\x1b\[/);
  });
});

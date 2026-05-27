import { describe, test, expect } from "bun:test";
import { MIGRATIONS } from "../src/db/migrations/index";

describe("migration ordering", () => {
  test("versions are sequential 1..N", () => {
    for (let i = 0; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBe(i + 1);
    }
  });
});

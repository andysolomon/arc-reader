import { describe, expect, it } from "vitest";
import { catalogue, splitPostTitle } from "./postTitle";

describe("splitPostTitle", () => {
  it("takes the author and site off X's page title", () => {
    expect(splitPostTitle('Livsun on X: "Prompt → Context → Harness → Loop → Graph: The 5 Levels of AI Engineering" / X'))
      .toEqual({ title: "Prompt → Context → Harness → Loop → Graph: The 5 Levels of AI Engineering", author: "Livsun" });
    expect(splitPostTitle('Judgment Labs on X: "Searching a billion tokens of agent data"'))
      .toEqual({ title: "Searching a billion tokens of agent data", author: "Judgment Labs" });
  });

  it("keeps quotes inside the post", () => {
    expect(splitPostTitle('Ann on X: "Say "hi" twice" / X')).toEqual({ title: 'Say "hi" twice', author: "Ann" });
  });

  it("names a post with no words by its author", () => {
    expect(splitPostTitle("Ann on X / X")).toEqual({ title: "Post by Ann", author: "Ann" });
  });

  it("drops a lone site suffix and leaves other titles alone", () => {
    expect(splitPostTitle("Agent harnesses / X")).toEqual({ title: "Agent harnesses" });
    expect(splitPostTitle("Agent harnesses")).toEqual({ title: "Agent harnesses" });
  });
});

describe("catalogue", () => {
  it("cleans titles only for documents from X", () => {
    expect(catalogue({ title: 'Ann on X: "Hello" / X', domain: "x.com" })).toEqual({ title: "Hello", author: "Ann" });
    expect(catalogue({ title: "Thoughts on X", domain: "example.com" })).toEqual({ title: "Thoughts on X" });
  });

  it("prefers the saved author", () => {
    expect(catalogue({ title: 'Ann on X: "Hello"', domain: "x.com", meta: { author: "Ann Lee" } })).toEqual({ title: "Hello", author: "Ann Lee" });
    expect(catalogue({ title: "An essay", domain: "example.com", meta: { author: "Sam" } })).toEqual({ title: "An essay", author: "Sam" });
  });
});

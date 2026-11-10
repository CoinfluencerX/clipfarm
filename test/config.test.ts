import { describe, expect, it } from "vitest";
import { ConfigError, loadAppConfig, parseYamlConfig } from "../src/config/load.ts";
import { resolveMode } from "../src/config/mode.ts";
import {
  AccountsSchema,
  crossCheckProblems,
  GuardrailsSchema,
  HARD_MAX_POSTS_PER_ACCOUNT_PER_DAY,
  liveReadinessProblems,
  SourcesSchema,
} from "../src/config/schemas.ts";
import { CONFIG_DIR, licensedSource, repoConfigObject, toYaml } from "./helpers.ts";

const sources = (list: unknown[]) => parseYamlConfig(toYaml({ sources: list }), SourcesSchema, "sources.yaml");

describe("repo config", () => {
  it("loads as shipped", () => {
    const cfg = loadAppConfig(CONFIG_DIR);
    expect(cfg.sources.sources[0]?.rights.basis).toBe("own");
    expect(cfg.guardrails.review.mode).toBe("manual");
  });

  it("is not live-ready as shipped: placeholder guardrails and placeholder accounts", () => {
    const problems = liveReadinessProblems(loadAppConfig(CONFIG_DIR));
    expect(problems.join("\n")).toMatch(/placeholder/);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the one rule: every source carries a rights record", () => {
  it("rejects a source with no rights record", () => {
    const { rights: _dropped, ...noRights } = licensedSource();
    expect(() => sources([noRights])).toThrow(ConfigError);
  });

  it("has no 'unknown' or 'fair use' basis", () => {
    expect(() => sources([{ ...licensedSource(), rights: { basis: "fair-use" } }])).toThrow(ConfigError);
  });

  it.each(["granted_by", "evidence", "platforms", "monetization", "credit"])("a license without %s is rejected", (field) => {
    const src = licensedSource();
    delete src.rights[field];
    expect(() => sources([src])).toThrow(ConfigError);
  });

  it("accepts a complete license and your own footage", () => {
    const cfg = sources([licensedSource({ expires: "2027-05-31" }), { ...licensedSource(), id: "mine", rights: { basis: "own" } }]);
    expect(cfg.sources).toHaveLength(2);
  });

  it("rejects ingest kinds that aren't files from the rights holder", () => {
    for (const kind of ["screen-record", "youtube-download", "twitch-rip"]) {
      expect(() => sources([{ ...licensedSource(), ingest: { kind, url: "https://example.com/watch" } }])).toThrow(ConfigError);
    }
  });

  it("rejects duplicate source ids", () => {
    expect(() => sources([licensedSource(), licensedSource()])).toThrow(/duplicate source id/);
  });
});

describe("accounts", () => {
  const accounts = (brands: unknown[]) => parseYamlConfig(toYaml({ brands }), AccountsSchema, "accounts.yaml");

  it("a brand can't hold two accounts on one platform", () => {
    const text = 'brands:\n  - id: main\n    name: Main\n    accounts:\n      tiktok: { username: "a" }\n      tiktok: { username: "b" }\n';
    expect(() => parseYamlConfig(text, AccountsSchema, "accounts.yaml")).toThrow(ConfigError);
  });

  it("rejects the same account under two brands", () => {
    expect(() =>
      accounts([
        { id: "one", name: "One", accounts: { tiktok: { username: "@Same" } } },
        { id: "two", name: "Two", accounts: { tiktok: { username: "same" } } },
      ]),
    ).toThrow(/more than one brand/);
  });

  it("rejects a brand with no accounts", () => {
    expect(() => accounts([{ id: "empty", name: "Empty", accounts: {} }])).toThrow(ConfigError);
  });
});

describe("guardrails", () => {
  const guardrails = (patch: (g: any) => void) => {
    const g = repoConfigObject("guardrails.yaml");
    patch(g);
    return parseYamlConfig(toYaml(g), GuardrailsSchema, "guardrails.yaml");
  };

  it("the daily post cap can't be raised past the hard ceiling", () => {
    expect(() => guardrails((g) => (g.publish.max_posts_per_account_per_day = HARD_MAX_POSTS_PER_ACCOUNT_PER_DAY + 1))).toThrow(ConfigError);
    expect(guardrails((g) => (g.publish.max_posts_per_account_per_day = HARD_MAX_POSTS_PER_ACCOUNT_PER_DAY)).publish.max_posts_per_account_per_day).toBe(5);
  });

  it("the gap between posts can't go below an hour", () => {
    expect(() => guardrails((g) => (g.publish.min_minutes_between_posts = 10))).toThrow(ConfigError);
  });

  it("auto review needs a confidence threshold", () => {
    expect(() => guardrails((g) => (g.review.mode = "auto"))).toThrow(/auto_min_confidence/);
  });

  it("rejects a bad time zone and a bad window", () => {
    expect(() => guardrails((g) => (g.publish.timezone = "Mars/Olympus"))).toThrow(ConfigError);
    expect(() => guardrails((g) => (g.publish.windows = ["6pm-9pm"]))).toThrow(ConfigError);
  });
});

describe("cross-file checks", () => {
  const accounts = parseYamlConfig(toYaml(repoConfigObject("accounts.yaml")), AccountsSchema, "accounts.yaml");

  it("a source can't publish to a brand that doesn't exist", () => {
    const problems = crossCheckProblems({ sources: sources([{ ...licensedSource(), publish_to: ["ghost"] }]), accounts });
    expect(problems[0]).toMatch(/"ghost"/);
  });

  it("flags a license that covers no platform the brand is on", () => {
    const problems = crossCheckProblems({ sources: sources([licensedSource({ platforms: ["x"] })]), accounts });
    expect(problems[0]).toMatch(/no account on any of them/);
  });
});

describe("mode", () => {
  it("defaults to dry-run", () => {
    expect(resolveMode(undefined, { MODE: "live", LIVE: "1" })).toBe("dry-run");
  });

  it("live needs the CLI flag and both .env switches", () => {
    expect(() => resolveMode("live", { MODE: "dry-run", LIVE: "0" }, true)).toThrow(/LIVE=1/);
    expect(() => resolveMode("live", { MODE: "live", LIVE: "0" }, true)).toThrow(/LIVE=1/);
    expect(resolveMode("live", { MODE: "live", LIVE: "1" }, true)).toBe("live");
  });

  it("live is locked until the publishers ship", () => {
    expect(() => resolveMode("live", { MODE: "live", LIVE: "1" })).toThrow(/M5/);
  });
});

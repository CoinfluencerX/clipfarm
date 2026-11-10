import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { z } from "zod";
import { AccountsSchema, crossCheckProblems, GuardrailsSchema, SourcesSchema, type ConfigSet } from "./schemas.ts";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function parseYamlConfig<S extends z.ZodType>(text: string, schema: S, label: string): z.infer<S> {
  let data: unknown;
  try {
    data = parse(text, { uniqueKeys: true });
  } catch (err) {
    throw new ConfigError(`${label}: YAML syntax error: ${(err as Error).message}`);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`${label} is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  return result.data;
}

function loadFile<S extends z.ZodType>(dir: string, file: string, schema: S): z.infer<S> {
  const path = join(dir, file);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`Missing config file: ${path}`);
  }
  return parseYamlConfig(text, schema, file);
}

export type AppConfig = ConfigSet;

export function loadAppConfig(configDir: string): AppConfig {
  const config: AppConfig = {
    sources: loadFile(configDir, "sources.yaml", SourcesSchema),
    accounts: loadFile(configDir, "accounts.yaml", AccountsSchema),
    guardrails: loadFile(configDir, "guardrails.yaml", GuardrailsSchema),
  };
  const problems = crossCheckProblems(config);
  if (problems.length > 0) throw new ConfigError(`Config files don't agree:\n  - ${problems.join("\n  - ")}`);
  return config;
}

import { parse as parseYaml } from "yaml";
import type {
  PermissionSnapshot,
  PermissionEntry,
  ToolDeclaration,
  Capability,
  AllowlistEntry,
} from "./types.js";
import { ALL_CAPABILITIES } from "./types.js";
import { inferCapabilities } from "./heuristics.js";

/**
 * Parse a YAML config file and extract its permission snapshot.
 */
export function parseConfigFile(filePath: string, content: string): PermissionSnapshot {
  const doc = safeParseYaml(content);
  if (!doc || typeof doc !== "object") {
    const hasContent = content.trim().length > 0;
    return {
      filePath,
      entries: [],
      tools: [],
      parseWarning: hasContent ? "parse_error" : undefined,
    };
  }

  const rec = doc as Record<string, unknown>;

  if (isWorkflowFile(rec)) {
    return parseWorkflowPermissions(filePath, rec);
  }

  if (isMcpConfig(rec)) {
    return parseMcpConfig(filePath, rec);
  }

  if (isAgentConfig(rec)) {
    return parseAgentConfig(filePath, rec);
  }

  return {
    filePath,
    entries: [],
    tools: [],
    parseWarning: "unrecognized_format",
  };
}

/**
 * Parse an allowlist YAML file.
 */
export function parseAllowlist(content: string): AllowlistEntry[] {
  const doc = safeParseYaml(content);
  if (!doc || !Array.isArray(doc)) return [];

  const entries: AllowlistEntry[] = [];
  for (const item of doc) {
    if (typeof item === "object" && item !== null && "tool" in item) {
      const rec = item as Record<string, unknown>;
      const tool = String(rec["tool"]);
      const caps = Array.isArray(rec["capabilities"])
        ? (rec["capabilities"] as unknown[])
            .map(String)
            .filter((c): c is Capability => ALL_CAPABILITIES.includes(c as Capability))
        : [];
      entries.push({ tool, capabilities: caps });
    }
  }
  return entries;
}

function safeParseYaml(content: string): unknown {
  try {
    return parseYaml(content);
  } catch {
    return null;
  }
}

function isWorkflowFile(doc: Record<string, unknown>): boolean {
  return "on" in doc || "jobs" in doc;
}

function isMcpConfig(doc: Record<string, unknown>): boolean {
  return "mcpServers" in doc || "mcp_servers" in doc || "servers" in doc;
}

function isAgentConfig(doc: Record<string, unknown>): boolean {
  return "tools" in doc || "agents" in doc || "permissions" in doc;
}

function parseWorkflowPermissions(
  filePath: string,
  doc: Record<string, unknown>,
): PermissionSnapshot {
  const entries: PermissionEntry[] = [];
  const tools: ToolDeclaration[] = [];

  const topPerms = doc["permissions"];
  if (topPerms && typeof topPerms === "object" && !Array.isArray(topPerms)) {
    const permEntries = extractExplicitPermissions(
      topPerms as Record<string, unknown>,
      filePath,
      "workflow-level",
    );
    entries.push(...permEntries);
  }

  const jobs = doc["jobs"];
  if (jobs && typeof jobs === "object") {
    for (const [jobName, jobDef] of Object.entries(jobs as Record<string, unknown>)) {
      if (!jobDef || typeof jobDef !== "object") continue;
      const jobObj = jobDef as Record<string, unknown>;

      const jobPerms = jobObj["permissions"];
      if (jobPerms && typeof jobPerms === "object" && !Array.isArray(jobPerms)) {
        const permEntries = extractExplicitPermissions(
          jobPerms as Record<string, unknown>,
          filePath,
          `job:${jobName}`,
        );
        entries.push(...permEntries);
      }

      const steps = jobObj["steps"];
      if (Array.isArray(steps)) {
        for (const step of steps) {
          if (!step || typeof step !== "object") continue;
          const stepObj = step as Record<string, unknown>;
          const uses = stepObj["uses"];
          if (typeof uses === "string") {
            const caps = inferCapabilities(uses, "action");
            const tool: ToolDeclaration = {
              name: uses,
              type: "action",
              capabilities: caps,
              source: filePath,
            };
            tools.push(tool);

            for (const cap of caps) {
              entries.push({
                capability: cap,
                source: filePath,
                sourceType: "heuristic",
                tool: uses,
                raw: `uses: ${uses}`,
              });
            }
          }
        }
      }
    }
  }

  return { filePath, entries, tools };
}

function parseMcpConfig(filePath: string, doc: Record<string, unknown>): PermissionSnapshot {
  const entries: PermissionEntry[] = [];
  const tools: ToolDeclaration[] = [];

  const servers =
    (doc["mcpServers"] as Record<string, unknown> | undefined) ??
    (doc["mcp_servers"] as Record<string, unknown> | undefined) ??
    (doc["servers"] as Record<string, unknown> | undefined);

  if (!servers || typeof servers !== "object") {
    return { filePath, entries: [], tools: [] };
  }

  for (const [serverName, serverDef] of Object.entries(servers)) {
    if (!serverDef || typeof serverDef !== "object") continue;
    const serverObj = serverDef as Record<string, unknown>;

    const explicitPerms = serverObj["permissions"] ?? serverObj["capabilities"];

    const caps: Capability[] = Array.isArray(explicitPerms)
      ? (explicitPerms as unknown[])
          .map(String)
          .filter((c): c is Capability => ALL_CAPABILITIES.includes(c as Capability))
      : inferCapabilities(serverName, "mcp-server");

    const sourceType = Array.isArray(explicitPerms) ? "explicit" : "heuristic";
    const suffix = sourceType === "heuristic" ? " (heuristic)" : "";

    for (const cap of caps) {
      entries.push({
        capability: cap,
        source: filePath,
        sourceType,
        tool: serverName,
        raw: `server:${serverName}${suffix} -> ${cap}`,
      });
    }

    tools.push({
      name: serverName,
      type: "mcp-server",
      capabilities: caps,
      source: filePath,
    });
  }

  return { filePath, entries, tools };
}

function parseAgentConfig(filePath: string, doc: Record<string, unknown>): PermissionSnapshot {
  const entries: PermissionEntry[] = [];
  const tools: ToolDeclaration[] = [];

  const toolsList = doc["tools"];
  if (Array.isArray(toolsList)) {
    for (const toolDef of toolsList) {
      if (!toolDef || typeof toolDef !== "object") continue;
      const toolObj = toolDef as Record<string, unknown>;
      const name = String(toolObj["name"] ?? "unknown");
      const perms = toolObj["permissions"] ?? toolObj["capabilities"];

      const caps: Capability[] = Array.isArray(perms)
        ? (perms as unknown[])
            .map(String)
            .filter((c): c is Capability => ALL_CAPABILITIES.includes(c as Capability))
        : inferCapabilities(name, "agent-tool");

      const sourceType = Array.isArray(perms) ? "explicit" : "heuristic";
      const suffix = sourceType === "heuristic" ? " (heuristic)" : "";

      for (const cap of caps) {
        entries.push({
          capability: cap,
          source: filePath,
          sourceType,
          tool: name,
          raw: `tool:${name}${suffix} -> ${cap}`,
        });
      }

      tools.push({
        name,
        type: "agent-tool",
        capabilities: caps,
        source: filePath,
      });
    }
  }

  return { filePath, entries, tools };
}

function extractExplicitPermissions(
  perms: Record<string, unknown>,
  source: string,
  context: string,
): PermissionEntry[] {
  const entries: PermissionEntry[] = [];

  const permMapping: Record<string, Capability[]> = {
    contents: ["read.repo"],
    issues: ["read.issues"],
    "pull-requests": ["read.pulls"],
    packages: ["read.packages"],
  };

  const writeMapping: Record<string, Capability[]> = {
    contents: ["write.repo"],
    issues: ["write.issues"],
    "pull-requests": ["write.pulls"],
    packages: ["write.packages"],
    actions: ["write.actions"],
  };

  for (const [key, value] of Object.entries(perms)) {
    const level = String(value);
    const readCaps = permMapping[key];
    const writeCaps = writeMapping[key];

    if (level === "read" && readCaps) {
      for (const cap of readCaps) {
        entries.push({
          capability: cap,
          source,
          sourceType: "explicit",
          tool: context,
          raw: `permissions.${key}: ${level}`,
        });
      }
    } else if (level === "write") {
      const allCaps = [...(readCaps ?? []), ...(writeCaps ?? [])];
      for (const cap of allCaps) {
        entries.push({
          capability: cap,
          source,
          sourceType: "explicit",
          tool: context,
          raw: `permissions.${key}: ${level}`,
        });
      }
    }
  }

  return entries;
}

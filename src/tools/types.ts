import type { ToolResult } from "../garmin/types.js";

export interface ToolInputSchema {
  type: string;
  description: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, ToolInputSchema> | Record<string, never>;
  handler: (input: Record<string, unknown>) => Promise<ToolResult<unknown>>;
}

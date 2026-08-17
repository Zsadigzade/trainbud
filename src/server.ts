import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { executeTool, toolRegistry, toolSchemas } from "./tools/index.js";
import { logger } from "./utils/logger.js";
import { packageVersion } from "./version.js";
import { formatToolError } from "./toolErrors.js";

// SECTION: MCP Server

export { formatToolError } from "./toolErrors.js";

export interface GarminMcpServer {
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export function registerGarminTools(mcpServer: McpServer): void {
  for (const tool of toolRegistry) {
    const schema = toolSchemas[tool.name as keyof typeof toolSchemas];

    mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: schema,
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await executeTool(tool.name, args);

          return {
            content: [
              {
                type: "text" as const,
                text: result.text,
              },
            ],
          };
        } catch (error) {
          logger.error({ error, tool: tool.name }, "Tool execution failed");

          const message = formatToolError(error);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: message,
              },
            ],
          };
        }
      }
    );
  }
}

export function createMcpServerInstance(): McpServer {
  const mcpServer = new McpServer({
    name: "trainbud",
    version: packageVersion,
  });

  registerGarminTools(mcpServer);
  return mcpServer;
}

export function createMcpServer(): GarminMcpServer {
  let mcpServer = createMcpServerInstance();
  let transport: StdioServerTransport | null = null;

  return {
    async start(): Promise<void> {
      mcpServer = createMcpServerInstance();
      transport = new StdioServerTransport();
      await mcpServer.connect(transport);
      logger.info("TrainBud server started on stdio transport");
    },
    async close(): Promise<void> {
      await mcpServer.close();
      transport = null;
    },
  };
}

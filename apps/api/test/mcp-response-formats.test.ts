import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolResultSchema,
  JSONRPCResponseSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

// Protocol-only controls: no database, credentials, public listener or application bypass.
const structured = { message: 'OK: "quoted" \n Unicode ☃', revision: 1 };
const variants: [string, CallToolResult][] = [
  ['text only', { content: [{ type: 'text', text: 'OK' }] }],
  [
    'structured and JSON text',
    {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
    },
  ],
  [
    'structured with metadata',
    {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
      _meta: { 'wally/test': 'synthetic' },
    },
  ],
  [
    'execution error',
    {
      content: [{ type: 'text', text: '{"error":"NOT_FOUND"}' }],
      structuredContent: { error: 'NOT_FOUND' },
      isError: true,
    },
  ],
];
describe('MCP response format controls', () => {
  it.each(variants)('serializes %s as one JSON-RPC object', async (_name, result) => {
    const server = new McpServer({ name: 'format-control', version: '1' });
    server.registerTool('probe', { inputSchema: {} }, async () => result);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-11-25',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: { name: 'probe', arguments: {} },
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const envelope = JSONRPCResponseSchema.parse(await response.json());
      if (!('result' in envelope)) throw new Error(JSON.stringify(envelope.error));
      expect(envelope).toMatchObject({ jsonrpc: '2.0', id: 7 });
      expect(CallToolResultSchema.parse(envelope.result)).toEqual(result);
    } finally {
      await server.close();
    }
  });

  it('rejects a declared output-schema mismatch instead of emitting malformed success', async () => {
    const server = new McpServer({ name: 'schema-control', version: '1' });
    server.registerTool(
      'probe',
      { inputSchema: {}, outputSchema: { revision: z.number() } },
      async () => ({
        content: [{ type: 'text', text: 'invalid fixture' }],
        structuredContent: { revision: 'wrong type' },
      }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'probe', arguments: {} },
          }),
        }),
      );
      const envelope = JSONRPCResponseSchema.parse(await response.json());
      if (!('result' in envelope)) throw new Error(JSON.stringify(envelope.error));
      expect(CallToolResultSchema.parse(envelope.result).isError).toBe(true);
    } finally {
      await server.close();
    }
  });
});

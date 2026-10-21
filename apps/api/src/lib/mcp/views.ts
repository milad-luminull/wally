import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { noteDtoSchema } from '@wally/shared';
import { AppError } from '../errors.js';
import { mcpToolInputs, runMcpTool, type McpToolContext } from './tools.js';
import { cardWidgetHtml } from './widget.js';

const cardSchema = noteDtoSchema
  .pick({
    id: true,
    title: true,
    description: true,
    status: true,
    priority: true,
    horizon: true,
    dueDate: true,
    tags: true,
    revision: true,
    colour: true,
    subtaskSummary: true,
  })
  .extend({ assignee: z.string().nullable(), url: z.string().url() });
export const cardViewSchema = z.object({
  view: z.enum(['card', 'list']),
  board: z.object({ id: z.string(), name: z.string(), url: z.string().url() }),
  cards: z.array(cardSchema).max(100),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

/** Presentation only. All data is reloaded through the same authorized MCP queries. */
export function registerCardViews(server: McpServer, context: McpToolContext, webOrigin: string) {
  const origin = new URL(webOrigin).origin;
  const html = cardWidgetHtml(origin);
  const resourceUri = `ui://wally/cards-${createHash('sha256').update(html).digest('hex').slice(0, 16)}.html`;
  const boardUrl = (id: string) => new URL(`/boards/${encodeURIComponent(id)}`, origin);
  server.registerResource(
    'wally-cards',
    resourceUri,
    {
      title: 'Wally cards',
      mimeType: 'text/html;profile=mcp-app',
    },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: 'text/html;profile=mcp-app',
          text: html,
          _meta: {
            ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
            'openai/widgetDescription':
              'Wally note cards with status, priority and links to the live board.',
            'openai/widgetPrefersBorder': false,
            'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
          },
        },
      ],
    }),
  );
  for (const name of ['show_card', 'show_cards'] as const) {
    const single = name === 'show_card';
    server.registerTool(
      name,
      {
        title: single ? 'Show Wally card' : 'Show Wally cards',
        description: single
          ? 'Display a Wally card. After reading, creating or updating a note, pass its boardId and returned noteId here to show the final result. Reloads current authorized data; never repeats a write.'
          : 'Display a list of Wally cards. After list_notes, pass the same board and filters (and cursor for the same page). Reloads current authorized notes. Use for visual board results; does not modify notes.',
        inputSchema: single ? mcpToolInputs.get_note.shape : mcpToolInputs.list_notes.shape,
        outputSchema: cardViewSchema.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: resourceUri },
          'openai/outputTemplate': resourceUri,
          'openai/toolInvocation/invoking': 'Loading cards…',
          'openai/toolInvocation/invoked': 'Cards ready',
          securitySchemes: [{ type: 'oauth2', scopes: ['wally:read'] }],
        },
      },
      async (args: unknown) => {
        try {
          const input = (single ? mcpToolInputs.get_note : mcpToolInputs.list_notes).parse(args);
          const result = await runMcpTool(context, single ? 'get_note' : 'list_notes', input);
          const boardResult = await runMcpTool(context, 'get_board', { boardId: input.boardId });
          const board = z.object({ id: z.string(), name: z.string() }).parse(boardResult.data);
          const page = single
            ? { notes: [noteDtoSchema.parse(result.data)], total: 1, nextCursor: null }
            : z
                .object({
                  notes: z.array(noteDtoSchema),
                  total: z.number(),
                  nextCursor: z.string().nullable(),
                })
                .parse(result.data);
          const output = cardViewSchema.parse({
            view: single ? 'card' : 'list',
            board: { ...board, url: boardUrl(board.id).href },
            cards: page.notes.map((note) => {
              const url = boardUrl(board.id);
              url.searchParams.set('note', note.id);
              return {
                ...note,
                assignee: note.assignee?.displayName ?? note.assignee?.email ?? null,
                url: url.href,
              };
            }),
            total: page.total,
            nextCursor: page.nextCursor,
          });
          return {
            structuredContent: output,
            content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  error instanceof AppError
                    ? `${error.code}: ${error.message}`
                    : 'Unable to load cards.',
              },
            ],
          };
        }
      },
    );
  }
}

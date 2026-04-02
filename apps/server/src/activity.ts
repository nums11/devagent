import path from 'node:path';
import type { CommandExecutionItem, ThreadEvent } from '@openai/codex-sdk';
import type { ActivityKind, ActivityRecord, ActivityStatus } from './types.js';

export type ActivityDraft = {
  sourceKey: string;
  kind: ActivityKind;
  title: string;
  detail?: string | null;
  status: ActivityStatus;
  metadata?: Record<string, unknown>;
};

const SEARCH_COMMANDS = new Set(['rg', 'grep', 'find', 'fd']);
const FILE_READ_COMMANDS = new Set(['cat', 'sed', 'head', 'tail', 'nl', 'less']);

function trimLine(text: string, max = 180): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return '';
  }

  return collapsed.length > max ? `${collapsed.slice(0, max - 3).trimEnd()}...` : collapsed;
}

function pickOutputPreview(output: string | undefined): string | null {
  if (!output) {
    return null;
  }

  const cleaned = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-6)
    .join('\n')
    .trim();

  return cleaned || null;
}

function basenameOrSelf(target: string): string {
  const base = path.basename(target);
  return base || target;
}

function cleanToken(token: string): string {
  return token.replace(/^['"`]+|['"`]+$/g, '');
}

function extractLikelyPath(command: string): string | null {
  const parts = command.split(/\s+/).map(cleanToken).filter(Boolean);
  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const value = parts[index];
    if (value.startsWith('-')) {
      continue;
    }

    if (value.includes('/') || value.includes('.')) {
      return value;
    }
  }

  return null;
}

function extractSearchQuery(command: string): string | null {
  const match = command.match(/['"]([^'"]{2,120})['"]/);
  if (match?.[1]) {
    return trimLine(match[1], 120);
  }

  const parts = command.split(/\s+/).map(cleanToken).filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) {
    const value = parts[index];
    if (value.startsWith('-')) {
      continue;
    }

    return trimLine(value, 120);
  }

  return null;
}

function deriveCommandActivity(
  eventType: 'item.started' | 'item.updated' | 'item.completed',
  item: CommandExecutionItem
): ActivityDraft | null {
  const command = trimLine(item.command, 220);
  const shellCommand = item.command.trim().split(/\s+/)[0] || '';
  const commandName = cleanToken(shellCommand);
  const outputPreview = pickOutputPreview(item.aggregated_output);
  const status =
    item.status === 'failed' ? 'failed' : item.status === 'completed' ? 'completed' : 'running';

  if (SEARCH_COMMANDS.has(commandName)) {
    const query = extractSearchQuery(item.command) || command;
    return {
      sourceKey: `item:${item.id}`,
      kind: 'search',
      title: `Searched for ${query}`,
      detail: eventType === 'item.completed' ? null : command,
      status,
      metadata: {
        command,
        outputPreview
      }
    };
  }

  if (FILE_READ_COMMANDS.has(commandName)) {
    const filePath = extractLikelyPath(item.command);
    return {
      sourceKey: `item:${item.id}`,
      kind: 'file_read',
      title: filePath ? `Read ${basenameOrSelf(filePath)}` : `Read file`,
      detail: command,
      status,
      metadata: {
        command,
        filePath,
        outputPreview
      }
    };
  }

  return {
    sourceKey: `item:${item.id}`,
    kind: 'command',
    title: status === 'running' ? 'Running command' : 'Ran command',
    detail: command,
    status,
    metadata: {
      command,
      outputPreview,
      exitCode: item.exit_code ?? null
    }
  };
}

export function deriveActivityDrafts(event: ThreadEvent): ActivityDraft[] {
  if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
    const { item } = event;

    if (item.type === 'agent_message') {
      return [];
    }

    if (item.type === 'reasoning') {
      return [
        {
          sourceKey: `item:${item.id}`,
          kind: 'thinking',
          title: trimLine(item.text, 180) || 'Thinking',
          status: 'completed',
          metadata: {
            text: item.text
          }
        }
      ];
    }

    if (item.type === 'web_search') {
      return [
        {
          sourceKey: `item:${item.id}`,
          kind: 'search',
          title: `Searched for ${trimLine(item.query, 120)}`,
          detail: event.type === 'item.completed' ? null : item.query,
          status: event.type === 'item.completed' ? 'completed' : 'running',
          metadata: {
            query: item.query
          }
        }
      ];
    }

    if (item.type === 'command_execution') {
      const activity = deriveCommandActivity(event.type, item);
      return activity ? [activity] : [];
    }

    if (item.type === 'file_change') {
      const paths = item.changes.map((change) => change.path);
      const label =
        paths.length === 1
          ? `${item.status === 'failed' ? 'Failed to edit' : 'Edited'} ${basenameOrSelf(paths[0])}`
          : `${item.status === 'failed' ? 'Failed to edit' : 'Edited'} ${paths.length} files`;

      return [
        {
          sourceKey: `item:${item.id}`,
          kind: 'file_change',
          title: label,
          detail: paths.map((value) => basenameOrSelf(value)).join(', '),
          status: item.status === 'failed' ? 'failed' : 'completed',
          metadata: {
            changes: item.changes
          }
        }
      ];
    }

    if (item.type === 'mcp_tool_call') {
      return [
        {
          sourceKey: `item:${item.id}`,
          kind: 'tool_call',
          title: `${item.server}/${item.tool}`,
          detail:
            item.status === 'failed'
              ? item.error?.message || 'Tool call failed'
              : trimLine(JSON.stringify(item.arguments), 180),
          status:
            item.status === 'failed'
              ? 'failed'
              : item.status === 'completed'
                ? 'completed'
                : 'running',
          metadata: {
            server: item.server,
            tool: item.tool
          }
        }
      ];
    }

    if (item.type === 'todo_list') {
      const completed = item.items.filter((todo) => todo.completed).length;
      return [
        {
          sourceKey: `item:${item.id}`,
          kind: 'todo',
          title: `Updated plan`,
          detail: `${completed}/${item.items.length} steps completed`,
          status: event.type === 'item.completed' ? 'completed' : 'running',
          metadata: {
            items: item.items
          }
        }
      ];
    }

    if (item.type === 'error') {
      return [
        {
          sourceKey: `item:${item.id}`,
          kind: 'error',
          title: 'Run error',
          detail: item.message,
          status: 'failed',
          metadata: {
            message: item.message
          }
        }
      ];
    }
  }

  if (event.type === 'turn.failed') {
    return [
      {
        sourceKey: 'turn.failed',
        kind: 'error',
        title: 'Turn failed',
        detail: event.error.message,
        status: 'failed',
        metadata: {
          message: event.error.message
        }
      }
    ];
  }

  if (event.type === 'error') {
    return [
      {
        sourceKey: `error:${event.message}`,
        kind: 'error',
        title: 'Bridge error',
        detail: event.message,
        status: 'failed',
        metadata: {
          message: event.message
        }
      }
    ];
  }

  return [];
}

export function summarizeActivity(activity: ActivityRecord): string {
  if (activity.kind === 'command' && activity.detail) {
    return activity.detail;
  }

  return activity.title;
}

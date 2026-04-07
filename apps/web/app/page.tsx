'use client';

import React from 'react';
import {
  type ActivityItem,
  type ConnectionState,
  type Conversation,
  type Message,
  type QueuedTurn,
  type RunRecord,
  type RuntimeConfig,
  type SelectedImage,
  type ServerRunEvent,
  type ThemeMode,
  type UploadedImageAttachment,
  type ViewMode,
  type Workspace,
  deriveBridgeUrls,
  deriveUserMessageContent,
  formatConversationMeta,
  formatElapsedLabel,
  formatModeLabel,
  formatSandboxModeLabel,
  formatWorkspaceLabel,
  formatWorkspaceSubtitle,
  formatWorkspaceSyncSummary,
  readResponsePayload,
  shouldOfferWorkspaceSync,
  summarizeActivity,
  upsertActivity
} from '../lib/dev-agent';

const THEME_STORAGE_KEY = 'dev-agent-web-theme-mode';
const MAX_SOCKET_RECONNECT_DELAY_MS = 10000;
const WORKSPACE_SYNC_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

type ActiveRun = {
  conversationId: string;
  runId: string;
  startedAt: string;
};

type TimelineItem =
  | { key: string; type: 'message'; createdAt: string; message: Message }
  | { key: string; type: 'activity'; createdAt: string; activity: ActivityItem }
  | { key: string; type: 'run-marker'; createdAt: string; run: RunRecord };

function buildTimeline(messages: Message[], activities: ActivityItem[], runs: RunRecord[]): TimelineItem[] {
  return [
    ...messages.map((message) => ({
      key: `message-${message.id}`,
      type: 'message' as const,
      createdAt: message.createdAt,
      message
    })),
    ...activities.map((activity) => ({
      key: `activity-${activity.id}`,
      type: 'activity' as const,
      createdAt: activity.createdAt,
      activity
    })),
    ...runs
      .filter((run) => run.status !== 'running')
      .map((run) => ({
        key: `run-${run.id}`,
        type: 'run-marker' as const,
        createdAt: run.completedAt || run.startedAt,
        run
      }))
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function syncActiveRunFromRuns(
  conversationId: string,
  nextRuns: RunRecord[],
  setActiveRun: React.Dispatch<React.SetStateAction<ActiveRun | null>>,
  activeConversationId: string | null,
  setStatus: React.Dispatch<React.SetStateAction<string>>
) {
  const runningRun = [...nextRuns].reverse().find((run) => run.status === 'running' && !run.completedAt);
  if (runningRun) {
    setActiveRun((currentActiveRun) => {
      const nextActiveRun = {
        conversationId,
        runId: runningRun.id,
        startedAt: runningRun.startedAt
      };
      const changed =
        currentActiveRun?.conversationId !== nextActiveRun.conversationId ||
        currentActiveRun?.runId !== nextActiveRun.runId;

      if (changed && conversationId === activeConversationId) {
        setStatus(`Running Codex turn ${runningRun.id.slice(0, 8)}...`);
      }

      return nextActiveRun;
    });
    return;
  }

  setActiveRun((currentActiveRun) => {
    if (currentActiveRun?.conversationId !== conversationId) {
      return currentActiveRun;
    }

    if (conversationId === activeConversationId) {
      const latestRun = nextRuns[nextRuns.length - 1];
      if (latestRun?.status === 'completed') {
        setStatus('Codex turn completed');
      } else if (latestRun?.status === 'failed') {
        setStatus('Codex turn no longer active');
      }
    }
    return null;
  });
}

function themeClassName(themeMode: ThemeMode) {
  return themeMode === 'light' ? 'theme-light' : 'theme-dark';
}

function GearIcon() {
  return (
    <svg className="shell-icon" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="8" y="0" width="2" height="5.8" rx="1" fill="currentColor" />
      <rect x="8" y="12.2" width="2" height="5.8" rx="1" fill="currentColor" />
      <rect x="0" y="8" width="5.8" height="2" rx="1" fill="currentColor" />
      <rect x="12.2" y="8" width="5.8" height="2" rx="1" fill="currentColor" />
      <rect x="3.15" y="1.5" width="2" height="5" rx="1" fill="currentColor" transform="rotate(-45 4.15 4)" />
      <rect x="12.85" y="10.95" width="2" height="5" rx="1" fill="currentColor" transform="rotate(-45 13.85 13.45)" />
      <rect x="10.85" y="1.5" width="2" height="5" rx="1" fill="currentColor" transform="rotate(45 11.85 4)" />
      <rect x="1.15" y="10.95" width="2" height="5" rx="1" fill="currentColor" transform="rotate(45 2.15 13.45)" />
      <circle cx="9" cy="9" r="2.5" fill="currentColor" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg className="shell-icon" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1.75" y="3.75" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6.25" y="7.25" width="11" height="2" rx="1" fill="currentColor" transform="rotate(-45 11.75 8.25)" />
      <path d="M14.5 3.4l1.7 1.7-3.1 1z" fill="currentColor" transform="rotate(-45 14.5 3.4)" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="shell-icon" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

export default function Page() {
  const [{ apiUrl, wsUrl }] = React.useState(() => deriveBridgeUrls());
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [activities, setActivities] = React.useState<ActivityItem[]>([]);
  const [runs, setRuns] = React.useState<RunRecord[]>([]);
  const [runtime, setRuntime] = React.useState<RuntimeConfig | null>(null);
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [selectedImages, setSelectedImages] = React.useState<SelectedImage[]>([]);
  const [queuedTurns, setQueuedTurns] = React.useState<Record<string, QueuedTurn>>({});
  const [activeRun, setActiveRun] = React.useState<ActiveRun | null>(null);
  const [status, setStatus] = React.useState('Connecting to Dev Agent...');
  const [connectionState, setConnectionState] = React.useState<ConnectionState>('connecting');
  const [themeMode, setThemeMode] = React.useState<ThemeMode>('dark');
  const [viewMode, setViewMode] = React.useState<ViewMode>('chat');
  const [newChatOpen, setNewChatOpen] = React.useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string>('general');
  const [creatingConversation, setCreatingConversation] = React.useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = React.useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = React.useState<string | null>(null);
  const [runClock, setRunClock] = React.useState<number>(Date.now());
  const [thinkingFrame, setThinkingFrame] = React.useState(0);
  const [syncingWorkspaceId, setSyncingWorkspaceId] = React.useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const socketRef = React.useRef<WebSocket | null>(null);
  const socketSequenceRef = React.useRef(0);
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimeoutRef = React.useRef<number | null>(null);
  const shouldMaintainSocketRef = React.useRef(false);
  const activeConversationIdRef = React.useRef<string | null>(null);
  const activeRunRef = React.useRef<ActiveRun | null>(null);
  const viewModeRef = React.useRef<ViewMode>('chat');
  const queuedTurnsRef = React.useRef<Record<string, QueuedTurn>>({});
  const queuedTurnDispatchingRef = React.useRef<Record<string, boolean>>({});
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  const activeConversation = React.useMemo(
    () => conversations.find((item) => item.id === activeConversationId) || null,
    [activeConversationId, conversations]
  );
  const activeWorkspace = React.useMemo(
    () => workspaces.find((workspace) => workspace.id === activeConversation?.workspaceId) || null,
    [activeConversation?.workspaceId, workspaces]
  );
  const queuedTurn = activeConversationId ? queuedTurns[activeConversationId] || null : null;
  const activeConversationIsRunning = activeRun?.conversationId === activeConversationId;
  const composerHasContent = draft.trim().length > 0 || selectedImages.length > 0;
  const activeWorkspaceNeedsSync = shouldOfferWorkspaceSync(activeWorkspace);
  const timelineItems = React.useMemo(() => buildTimeline(messages, activities, runs), [activities, messages, runs]);
  const topBarStatus = React.useMemo(() => {
    if (connectionState === 'connecting') {
      return 'Connecting to Dev Agent...';
    }

    if (connectionState === 'disconnected') {
      return 'Disconnected from Dev Agent';
    }

    return status;
  }, [connectionState, status]);
  const activeWorkspaceMetaLabel = React.useMemo(() => {
    if (!activeConversation) {
      return 'General chat';
    }
    return formatConversationMeta(activeConversation);
  }, [activeConversation]);
  const recentActivityFeed = React.useMemo(() => [...activities].slice(-6).reverse(), [activities]);
  const messageOrdinalById = React.useMemo(() => {
    const counts = new Map<string, number>();
    let assistantCount = 0;
    let userCount = 0;
    for (const message of messages) {
      if (message.role === 'assistant') {
        assistantCount += 1;
        counts.set(message.id, assistantCount);
      } else if (message.role === 'user') {
        userCount += 1;
        counts.set(message.id, userCount);
      }
    }
    return counts;
  }, [messages]);

  React.useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  React.useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  React.useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  React.useEffect(() => {
    queuedTurnsRef.current = queuedTurns;
  }, [queuedTurns]);

  React.useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'dark' || storedTheme === 'light') {
      setThemeMode(storedTheme);
    }
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timelineItems, activeConversationIsRunning]);

  React.useEffect(() => {
    if (!activeConversationIsRunning) {
      return;
    }

    setRunClock(Date.now());
    const intervalId = window.setInterval(() => {
      setRunClock(Date.now());
      setThinkingFrame((current) => current + 1);
    }, 420);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeConversationIsRunning]);

  const clearReconnectTimeout = React.useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const loadConversations = React.useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/conversations`);
    const payload = await readResponsePayload<{ conversations?: Conversation[]; error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load conversations.');
    }
    setConversations(payload.conversations || []);
    if (!activeConversationIdRef.current && payload.conversations?.length) {
      setActiveConversationId(payload.conversations[0].id);
    }
  }, [apiUrl]);

  const loadWorkspaces = React.useCallback(async (options: { refresh?: boolean } = {}) => {
    setLoadingWorkspaces(true);
    setWorkspaceLoadError(null);
    try {
      const response = await fetch(`${apiUrl}/api/workspaces${options.refresh ? '?refresh=1' : ''}`);
      const payload = await readResponsePayload<{ workspaces?: Workspace[]; error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load workspaces.');
      }
      setWorkspaces(payload.workspaces || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workspaces.';
      setWorkspaceLoadError(message);
      throw error;
    } finally {
      setLoadingWorkspaces(false);
    }
  }, [apiUrl]);

  const markConversationViewed = React.useCallback(async (conversationId: string) => {
    const response = await fetch(`${apiUrl}/api/conversations/${conversationId}/view`, {
      method: 'POST'
    });
    const payload = await readResponsePayload<{ conversation?: Conversation; error?: string }>(response);
    if (!response.ok || !payload.conversation) {
      throw new Error(payload.error || 'Failed to mark conversation viewed.');
    }
    setConversations((current) =>
      current.map((item) => (item.id === payload.conversation?.id ? payload.conversation : item))
    );
    return payload.conversation;
  }, [apiUrl]);

  const loadConversationDetail = React.useCallback(async (
    conversationId: string,
    options: { markViewed?: boolean } = {}
  ) => {
    const response = await fetch(`${apiUrl}/api/conversations/${conversationId}`);
    const payload = await readResponsePayload<{
      messages?: Message[];
      activities?: ActivityItem[];
      runs?: RunRecord[];
      error?: string;
    }>(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load conversation.');
    }
    const nextMessages = payload.messages || [];
    const nextActivities = payload.activities || [];
    const nextRuns = payload.runs || [];
    setMessages(nextMessages);
    setActivities(nextActivities);
    setRuns(nextRuns);
    syncActiveRunFromRuns(conversationId, nextRuns, setActiveRun, activeConversationIdRef.current, setStatus);
    const shouldMarkViewed =
      options.markViewed !== false &&
      viewModeRef.current === 'chat' &&
      document.visibilityState === 'visible' &&
      activeConversationIdRef.current === conversationId;
    if (shouldMarkViewed) {
      try {
        await markConversationViewed(conversationId);
      } catch {
        // Keep the visible conversation usable even if the viewed timestamp fails to persist.
      }
    }
  }, [apiUrl, markConversationViewed]);

  const loadRuntime = React.useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/runtime-config`);
    const payload = await readResponsePayload<{ runtime?: RuntimeConfig; error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load runtime config.');
    }
    setRuntime(payload.runtime || null);
  }, [apiUrl]);

  const applyWorkspaceUpdate = React.useCallback((workspace: Workspace) => {
    setWorkspaces((current) => current.map((item) => (item.id === workspace.id ? workspace : item)));
  }, []);

  const refreshConversationState = React.useCallback(async () => {
    await Promise.allSettled([loadRuntime(), loadConversations(), loadWorkspaces({ refresh: true })]);
    const currentConversationId = activeConversationIdRef.current;
    if (currentConversationId) {
      await loadConversationDetail(currentConversationId);
    }
  }, [loadConversationDetail, loadConversations, loadRuntime, loadWorkspaces]);

  const connectSocket = React.useCallback((force = false) => {
    if (!shouldMaintainSocketRef.current) {
      return;
    }

    const existingSocket = socketRef.current;
    if (!force && existingSocket && (existingSocket.readyState === WebSocket.CONNECTING || existingSocket.readyState === WebSocket.OPEN)) {
      return;
    }

    const sequence = socketSequenceRef.current + 1;
    socketSequenceRef.current = sequence;

    if (force && existingSocket && (existingSocket.readyState === WebSocket.CONNECTING || existingSocket.readyState === WebSocket.OPEN)) {
      existingSocket.close();
    }

    clearReconnectTimeout();
    setConnectionState('connecting');
    setStatus('Connecting to Dev Agent...');

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketSequenceRef.current !== sequence) {
        return;
      }

      reconnectAttemptsRef.current = 0;
      setConnectionState('connected');
      setStatus('Connected to Dev Agent');
    };

    socket.onmessage = (messageEvent) => {
      if (socketSequenceRef.current !== sequence) {
        return;
      }

      let event: ServerRunEvent;
      try {
        event = JSON.parse(messageEvent.data) as ServerRunEvent;
      } catch {
        return;
      }

      if (event.type === 'connection.ready') {
        setRuntime(event.runtime);
        setStatus('Codex bridge ready');
        refreshConversationState().catch((error) => {
          setStatus(error instanceof Error ? error.message : 'Failed to refresh conversation state.');
        });
        return;
      }

      if (event.type === 'conversation.updated') {
        setConversations((current) => current.map((item) => (item.id === event.conversation.id ? event.conversation : item)));
        return;
      }

      if (event.type === 'conversation.message.created') {
        if (event.conversationId === activeConversationIdRef.current) {
          setMessages((current) => {
            const alreadyPresent = current.some((item) => item.id === event.message.id);
            return alreadyPresent ? current : [...current, event.message];
          });
          if (
            event.message.role === 'assistant' &&
            viewModeRef.current === 'chat' &&
            document.visibilityState === 'visible'
          ) {
            markConversationViewed(event.conversationId).catch(() => undefined);
          }
        }
        return;
      }

      if (event.type === 'conversation.run.started') {
        setActiveRun({
          conversationId: event.conversationId,
          runId: event.runId,
          startedAt: event.startedAt
        });
        setRuns((current) => {
          const alreadyPresent = current.some((run) => run.id === event.runId);
          if (alreadyPresent) {
            return current;
          }

          return [
            ...current,
            {
              id: event.runId,
              conversationId: event.conversationId,
              prompt: '',
              status: 'running',
              startedAt: event.startedAt,
              completedAt: null,
              finalResponse: null
            }
          ];
        });
        setThinkingFrame(0);
        if (event.conversationId === activeConversationIdRef.current) {
          setStatus(`Running Codex turn ${event.runId.slice(0, 8)}...`);
        }
        return;
      }

      if (event.type === 'conversation.run.activity') {
        if (event.conversationId === activeConversationIdRef.current) {
          setActivities((current) => upsertActivity(current, event.activity));
        }
        return;
      }

      if (event.type === 'conversation.run.completed') {
        setRuns((current) =>
          current.map((run) =>
            run.id === event.runId
              ? {
                  ...run,
                  status: 'completed',
                  completedAt: new Date().toISOString(),
                  finalResponse: event.finalResponse
                }
              : run
          )
        );
        if (event.conversationId === activeConversationIdRef.current) {
          loadConversationDetail(event.conversationId).catch(() => {
            setMessages((current) => [
              ...current,
              {
                id: event.runId,
                role: 'assistant',
                content: event.finalResponse,
                attachments: [],
                createdAt: new Date().toISOString()
              }
            ]);
          });
          setStatus('Codex turn completed');
        }

        if (event.runId === activeRunRef.current?.runId) {
          setActiveRun(null);
        }
        return;
      }

      if (event.type === 'conversation.run.cancelled') {
        setRuns((current) =>
          current.map((run) =>
            run.id === event.runId
              ? {
                  ...run,
                  status: 'failed',
                  completedAt: new Date().toISOString()
                }
              : run
          )
        );
        if (event.runId === activeRunRef.current?.runId) {
          setActiveRun(null);
        }
        if (event.conversationId === activeConversationIdRef.current) {
          loadConversationDetail(event.conversationId).catch(() => undefined);
          setStatus(event.reason);
        }
        return;
      }

      if (event.type === 'conversation.run.failed') {
        if (event.runId) {
          setRuns((current) =>
            current.map((run) =>
              run.id === event.runId
                ? {
                    ...run,
                    status: 'failed',
                    completedAt: new Date().toISOString()
                  }
                : run
            )
          );
        }
        if (event.runId && event.runId === activeRunRef.current?.runId) {
          setActiveRun(null);
        }
        if (!event.conversationId || event.conversationId === activeConversationIdRef.current) {
          setStatus(event.error);
        }
      }
    };

    socket.onerror = () => {
      if (socketSequenceRef.current !== sequence) {
        return;
      }

      setStatus('WebSocket connection error');
    };

    socket.onclose = () => {
      if (socketSequenceRef.current !== sequence) {
        return;
      }

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      setConnectionState('disconnected');

      if (!shouldMaintainSocketRef.current || document.visibilityState !== 'visible') {
        return;
      }

      const nextAttempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = nextAttempt;
      const delay = Math.min(1000 * 2 ** (nextAttempt - 1), MAX_SOCKET_RECONNECT_DELAY_MS);

      clearReconnectTimeout();
      setConnectionState('connecting');
      setStatus(nextAttempt === 1 ? 'Reconnecting to Dev Agent...' : `Reconnecting to Dev Agent (${nextAttempt})...`);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectSocket(true);
      }, delay);
    };
  }, [clearReconnectTimeout, loadConversationDetail, markConversationViewed, refreshConversationState, wsUrl]);

  React.useEffect(() => {
    loadConversations().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load conversations.');
    });
  }, [loadConversations]);

  React.useEffect(() => {
    loadRuntime().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load runtime config.');
    });
  }, [loadRuntime]);

  React.useEffect(() => {
    loadWorkspaces({ refresh: true }).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load workspaces.');
    });
  }, [loadWorkspaces]);

  React.useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    loadConversationDetail(activeConversationId).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load messages.');
    });
  }, [activeConversationId, loadConversationDetail]);

  React.useEffect(() => {
    shouldMaintainSocketRef.current = true;
    connectSocket();

    return () => {
      shouldMaintainSocketRef.current = false;
      clearReconnectTimeout();
      socketSequenceRef.current += 1;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
        socket.close();
      }
    };
  }, [clearReconnectTimeout, connectSocket]);

  React.useEffect(() => {
    const handleFocus = () => {
      connectSocket(true);
      refreshConversationState().catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Failed to refresh conversation state.');
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      handleFocus();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [connectSocket, refreshConversationState]);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      loadWorkspaces({ refresh: true }).catch(() => undefined);
    }, WORKSPACE_SYNC_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadWorkspaces]);

  const openNewChatSheet = React.useCallback(() => {
    setViewMode('chat');
    setSelectedWorkspaceId('general');
    setWorkspaceLoadError(null);
    loadWorkspaces({ refresh: true }).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load workspaces.');
    });
    setNewChatOpen(true);
  }, [loadWorkspaces]);

  const createConversation = React.useCallback(async (workspaceId?: string | null) => {
    const response = await fetch(`${apiUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'New Codex Chat',
        mode: workspaceId ? 'workspace' : 'chat',
        workspaceId: workspaceId || null
      })
    });

    const payload = await readResponsePayload<{ conversation?: Conversation; error?: string }>(response);
    if (!response.ok || !payload.conversation) {
      throw new Error(payload.error || 'Failed to create conversation.');
    }

    const conversation = payload.conversation;
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setMessages([]);
    setActivities([]);
    setRuns([]);
    setDraft('');
    setSelectedImages([]);
    setViewMode('chat');
    setSidebarOpen(false);
    setNewChatOpen(false);
  }, [apiUrl]);

  const startNewChat = React.useCallback(async () => {
    if (creatingConversation) {
      return;
    }

    const nextWorkspaceId = selectedWorkspaceId === 'general' ? null : selectedWorkspaceId;
    try {
      setCreatingConversation(true);
      await createConversation(nextWorkspaceId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create conversation.');
    } finally {
      setCreatingConversation(false);
    }
  }, [createConversation, creatingConversation, selectedWorkspaceId]);

  const selectConversation = React.useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
    setViewMode('chat');
    setSidebarOpen(false);
    setDraft('');
    setSelectedImages([]);
    loadConversationDetail(conversationId).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load conversation.');
    });
  }, [loadConversationDetail]);

  const syncActiveWorkspace = React.useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }

    if (activeConversationIsRunning) {
      setStatus('Stop the active run before syncing this workspace.');
      return;
    }

    try {
      setSyncingWorkspaceId(activeWorkspace.id);
      setStatus(`Syncing ${activeWorkspace.name} with main...`);
      const response = await fetch(`${apiUrl}/api/workspaces/${activeWorkspace.id}/sync`, {
        method: 'POST'
      });
      const payload = await readResponsePayload<{ workspace?: Workspace; error?: string }>(response);
      if (!response.ok || !payload.workspace) {
        throw new Error(payload.error || 'Failed to sync workspace.');
      }

      applyWorkspaceUpdate(payload.workspace);
      await Promise.allSettled([
        loadWorkspaces({ refresh: true }),
        loadConversations(),
        activeConversationId ? loadConversationDetail(activeConversationId) : Promise.resolve()
      ]);
      setStatus(`${payload.workspace.name} is back in sync with main.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to sync workspace.');
      loadWorkspaces({ refresh: true }).catch(() => undefined);
    } finally {
      setSyncingWorkspaceId(null);
    }
  }, [
    activeConversationId,
    activeConversationIsRunning,
    activeWorkspace,
    apiUrl,
    applyWorkspaceUpdate,
    loadConversationDetail,
    loadConversations,
    loadWorkspaces
  ]);

  const dispatchRun = React.useCallback(async (input: {
    conversationId: string;
    prompt: string;
    selectedImages: SelectedImage[];
  }) => {
    if (!socketRef.current) {
      throw new Error('Codex connection is not ready.');
    }

    const prompt = input.prompt.trim();
    let uploadedAttachments: UploadedImageAttachment[] = [];
    if (input.selectedImages.length) {
      setStatus(input.selectedImages.length === 1 ? 'Uploading image...' : `Uploading ${input.selectedImages.length} images...`);
      uploadedAttachments = await Promise.all(
        input.selectedImages.map(async (image) => {
          const form = new FormData();
          form.append('image', image.file, image.fileName);

          const response = await fetch(`${apiUrl}/api/uploads/image`, {
            method: 'POST',
            body: form
          });
          const payload = await readResponsePayload<{ attachment?: UploadedImageAttachment; error?: string }>(response);
          if (!response.ok || !payload.attachment) {
            throw new Error(payload.error || 'Failed to upload image.');
          }

          return payload.attachment;
        })
      );
    }

    const createdAt = new Date().toISOString();
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        content: deriveUserMessageContent(prompt),
        attachments: input.selectedImages.map((image) => ({
          id: image.id,
          type: 'image',
          fileName: image.fileName,
          mimeType: image.mimeType,
          previewUrl: image.previewUrl,
          mediaUrl: image.previewUrl
        })),
        createdAt
      }
    ]);
    setThinkingFrame(0);

    socketRef.current.send(
      JSON.stringify({
        type: 'conversation.run',
        conversationId: input.conversationId,
        prompt,
        attachments: uploadedAttachments
      })
    );
  }, [apiUrl]);

  const clearQueuedTurn = React.useCallback((conversationId: string) => {
    setQueuedTurns((current) => {
      if (!current[conversationId]) {
        return current;
      }

      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const dispatchQueuedTurn = React.useCallback(async (conversationId: string, nextQueuedTurn: QueuedTurn) => {
    const prompt = nextQueuedTurn.prompt.trim();
    if (!prompt && nextQueuedTurn.selectedImages.length === 0) {
      return;
    }

    if (queuedTurnDispatchingRef.current[conversationId]) {
      return;
    }

    queuedTurnDispatchingRef.current[conversationId] = true;
    try {
      await dispatchRun({
        conversationId,
        prompt,
        selectedImages: nextQueuedTurn.selectedImages
      });
      clearQueuedTurn(conversationId);
      if (conversationId === activeConversationIdRef.current) {
        setStatus('Queued next turn submitted.');
      }
    } finally {
      delete queuedTurnDispatchingRef.current[conversationId];
    }
  }, [clearQueuedTurn, dispatchRun]);

  React.useEffect(() => {
    if (activeRun) {
      return;
    }

    const nextQueuedEntry = Object.entries(queuedTurns).find(([, item]) => item.prompt.trim().length > 0 || item.selectedImages.length > 0);
    if (!nextQueuedEntry) {
      return;
    }

    const [conversationId, nextQueuedTurn] = nextQueuedEntry;
    if (queuedTurnDispatchingRef.current[conversationId]) {
      return;
    }

    dispatchQueuedTurn(conversationId, nextQueuedTurn).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to submit queued next turn.');
    });
  }, [activeRun, dispatchQueuedTurn, queuedTurns]);

  const sendMessage = React.useCallback(async () => {
    if ((!draft.trim() && selectedImages.length === 0) || !activeConversationId) {
      return;
    }

    if (activeRunRef.current?.conversationId === activeConversationId) {
      const nextQueuedTurn = {
        prompt: draft.trim(),
        selectedImages: [...selectedImages]
      };
      setStatus('Queueing next turn...');
      setQueuedTurns((current) => ({
        ...current,
        [activeConversationId]: nextQueuedTurn
      }));
      setDraft('');
      setSelectedImages([]);
      setStatus('Next turn queued.');
      return;
    }

    if (!socketRef.current) {
      return;
    }

    await dispatchRun({
      conversationId: activeConversationId,
      prompt: draft,
      selectedImages
    });
    setDraft('');
    setSelectedImages([]);
  }, [activeConversationId, dispatchRun, draft, selectedImages]);

  const onComposerKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }, [sendMessage]);

  const cancelActiveRun = React.useCallback(() => {
    if (!activeRun || activeRun.conversationId !== activeConversationId || !socketRef.current) {
      return;
    }

    const hadQueuedTurn = Boolean(activeConversationId && queuedTurnsRef.current[activeConversationId]);
    if (activeConversationId) {
      clearQueuedTurn(activeConversationId);
    }

    socketRef.current.send(
      JSON.stringify({
        type: 'conversation.run.cancel',
        conversationId: activeRun.conversationId,
        runId: activeRun.runId
      })
    );
    setStatus(hadQueuedTurn ? 'Stopping Codex turn and clearing queued next turn...' : 'Stopping Codex turn...');
  }, [activeConversationId, activeRun, clearQueuedTurn]);

  const onPickImages = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      return;
    }

    setSelectedImages((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}`,
        fileName: file.name,
        file,
        mimeType: file.type || null,
        previewUrl: URL.createObjectURL(file)
      }))
    ]);
    event.target.value = '';
  }, []);

  const removeSelectedImage = React.useCallback((imageId: string) => {
    setSelectedImages((current) => current.filter((image) => image.id !== imageId));
  }, []);

  const queuedTurnPreview = React.useMemo(() => {
    if (!queuedTurn) {
      return '';
    }

    return queuedTurn.prompt.trim() || 'Images only';
  }, [queuedTurn]);

  const thinkingLabel = React.useMemo(() => {
    const phase = thinkingFrame % 3;
    return phase === 0 ? 'Codex is thinking' : phase === 1 ? 'Codex is thinking.' : 'Codex is thinking..';
  }, [thinkingFrame]);

  return (
    <main className={`shell ${themeClassName(themeMode)}`}>
      <div className={`sidebar-scrim ${sidebarOpen ? 'is-open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="sidebar-header">
          <div>
            <p className="sidebar-eyebrow">Dev Agent</p>
            <h2 className="sidebar-title">Threads</h2>
          </div>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            ×
          </button>
        </div>

        <div className="thread-list">
          {conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <button
                key={conversation.id}
                className={`thread-item ${active ? 'is-active' : ''}`}
                onClick={() => selectConversation(conversation.id)}
              >
                <span className="thread-title-row">
                  <span className="thread-title">{conversation.title}</span>
                  {conversation.attentionState === 'running' ? (
                    <span className="thread-dot thread-dot-running" aria-label="Agent running" />
                  ) : conversation.attentionState === 'unread' ? (
                    <span className="thread-dot thread-dot-unread" aria-label="Unread agent update" />
                  ) : null}
                </span>
                <span className="thread-meta">
                  {formatModeLabel(conversation.mode)} · {formatWorkspaceLabel(conversation)}
                </span>
              </button>
            );
          })}
        </div>

        <section className="activity-panel">
          <p className="panel-eyebrow">Run activity</p>
          <div className="activity-feed">
            {recentActivityFeed.length ? (
              recentActivityFeed.map((activity) => (
                <p key={activity.id} className="activity-feed-item">
                  {summarizeActivity(activity)}
                </p>
              ))
            ) : (
              <p className="activity-feed-empty">Waiting for the next turn.</p>
            )}
          </div>
        </section>
      </aside>

      <section className="main-pane">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button desktop-hidden" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              ≡
            </button>
            <div className="topbar-copy">
              <h1>{viewMode === 'settings' ? 'Settings' : activeConversation?.title || 'New thread'}</h1>
              <p className="topbar-status">{topBarStatus}</p>
              {viewMode === 'settings' ? null : (
                <p className="topbar-workspace">{activeWorkspaceMetaLabel}</p>
              )}
            </div>
          </div>

          <div className="topbar-actions">
            {viewMode === 'settings' || !activeWorkspaceNeedsSync ? null : (
              <button className="pill-button" onClick={() => void syncActiveWorkspace()} disabled={syncingWorkspaceId === activeWorkspace?.id}>
                {syncingWorkspaceId === activeWorkspace?.id ? 'Syncing' : 'Sync'}
              </button>
            )}
            <button className="icon-button" onClick={() => setViewMode('settings')} aria-label="Settings">
              <GearIcon />
            </button>
            <button className="icon-button" onClick={openNewChatSheet} aria-label="New chat">
              <ComposeIcon />
            </button>
          </div>
        </header>

        {viewMode === 'settings' ? (
          <section className="settings-view">
            <div className="settings-card">
              <h2>Appearance</h2>
              <p>Switch between the darker workspace mode and a brighter paper-like interface.</p>
              <div className="theme-grid">
                <button className={`theme-option ${themeMode === 'dark' ? 'is-active' : ''}`} onClick={() => setThemeMode('dark')}>
                  <strong>Dark mode</strong>
                  <span>A desktop-Codex inspired surface with calmer chrome.</span>
                </button>
                <button className={`theme-option ${themeMode === 'light' ? 'is-active' : ''}`} onClick={() => setThemeMode('light')}>
                  <strong>Light mode</strong>
                  <span>A brighter paper-like workspace that keeps the same structure.</span>
                </button>
              </div>
            </div>

            <div className="settings-card">
              <h2>Codex runtime</h2>
              <p>These values come from the server so you can confirm how the bridge is configured.</p>
              <ul className="runtime-list">
                <li>Model: {runtime?.model || 'loading'}</li>
                <li>Reasoning: {runtime?.reasoningEffort || 'loading'}</li>
                <li>Access: {formatSandboxModeLabel(runtime?.sandboxMode) || 'loading'}</li>
                <li>Approvals: {runtime?.approvalPolicy || 'loading'}</li>
                <li>Network: {runtime ? (runtime.networkAccessEnabled ? 'enabled' : 'disabled') : 'loading'}</li>
              </ul>
            </div>
          </section>
        ) : (
          <>
            <section className="conversation-surface">
              <div className="timeline">
                {timelineItems.length ? (
                  timelineItems.map((item) => {
                    if (item.type === 'message') {
                      const message = item.message;
                      return (
                        <article
                          key={item.key}
                          className={`message-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
                        >
                          <div className="message-card">
                            <div className="message-card-header">
                              <span className="message-role">{message.role === 'user' ? 'You' : 'Codex'}</span>
                              {message.content ? (
                                <button className="copy-button" onClick={() => void navigator.clipboard.writeText(message.content)}>
                                  Copy
                                </button>
                              ) : null}
                            </div>
                            {message.attachments.length ? (
                              <div className={`attachment-grid ${message.attachments.length === 1 ? 'is-single' : ''}`}>
                                {message.attachments.map((attachment) => (
                                  <div key={attachment.id} className="attachment-card">
                                    {attachment.type === 'video' || attachment.mimeType?.startsWith('video/') ? (
                                      <video className="attachment-video" controls src={attachment.mediaUrl || attachment.previewUrl} />
                                    ) : (
                                      <img className="attachment-image" src={attachment.previewUrl} alt={attachment.fileName} />
                                    )}
                                    <span className="attachment-caption">{attachment.fileName}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {message.content ? <p className="message-text">{message.content}</p> : null}
                            {message.role !== 'event' ? (
                              <span className="message-index">
                                {message.role === 'assistant' ? `Reply ${messageOrdinalById.get(message.id) || 1}` : `Prompt ${messageOrdinalById.get(message.id) || 1}`}
                              </span>
                            ) : null}
                          </div>
                        </article>
                      );
                    }

                    if (item.type === 'run-marker') {
                      const endTime = new Date(item.run.completedAt || item.run.startedAt).getTime();
                      const startTime = new Date(item.run.startedAt).getTime();
                      const elapsedSeconds = Math.max(1, Math.floor((endTime - startTime) / 1000));
                      return (
                        <div key={item.key} className="run-marker">
                          <span />
                          <p>Worked for {formatElapsedLabel(elapsedSeconds)}</p>
                          <span />
                        </div>
                      );
                    }

                    const activity = item.activity;
                    if (activity.kind === 'command') {
                      const outputPreview = typeof activity.metadata.outputPreview === 'string' ? activity.metadata.outputPreview : null;
                      return (
                        <article key={item.key} className="command-card">
                          <div className="command-card-header">
                            <div>
                              <h3>{activity.title}</h3>
                              <p>{activity.status === 'running' ? 'Running now' : 'Command finished'}</p>
                            </div>
                            <span className={`status-pill status-${activity.status}`}>{activity.status}</span>
                          </div>
                          <div className="command-card-body">
                            <div>
                              <span className="command-label">Shell</span>
                              <code>{activity.detail || activity.title}</code>
                            </div>
                            {outputPreview ? (
                              <div>
                                <span className="command-label">Output</span>
                                <pre>{outputPreview}</pre>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    }

                    return (
                      <article key={item.key} className={`activity-card status-${activity.status}`}>
                        <span className="activity-kind">{activity.kind.replace('_', ' ')}</span>
                        <h3>{activity.title}</h3>
                        {activity.detail ? <p>{activity.detail}</p> : null}
                      </article>
                    );
                  })
                ) : (
                  <div className="landing-state">
                    <p>I&apos;m your dev agent.</p>
                    <p>Ask me to implement anything.</p>
                  </div>
                )}

                {activeConversationIsRunning && activeRun ? (
                  <div className="run-marker is-live">
                    <span />
                    <p>
                      Working for{' '}
                      {formatElapsedLabel(
                        Math.max(
                          1,
                          Math.floor((runClock - new Date(activeRun.startedAt).getTime()) / 1000)
                        )
                      )}
                    </p>
                    <span />
                  </div>
                ) : null}

                {activeConversationIsRunning ? (
                  <div className="activity-card status-running thinking-card">
                    <h3>{thinkingLabel}</h3>
                  </div>
                ) : null}
                <div ref={messagesEndRef} />
              </div>
            </section>

            <section className="composer-dock">
              <div className="composer-shell">
                {queuedTurn ? (
                  <div className="queued-card">
                    <div className="queued-card-header">
                      <span>Queued next turn</span>
                      <button onClick={() => activeConversationId && clearQueuedTurn(activeConversationId)}>Clear</button>
                    </div>
                    <p>{queuedTurnPreview}</p>
                    {queuedTurn.selectedImages.length ? (
                      <small>
                        {queuedTurn.selectedImages.length} image{queuedTurn.selectedImages.length === 1 ? '' : 's'} attached
                      </small>
                    ) : null}
                  </div>
                ) : null}

                {selectedImages.length ? (
                  <div className="selected-images">
                    {selectedImages.map((image) => (
                      <div key={image.id} className="selected-image-chip">
                        <img src={image.previewUrl} alt={image.fileName} />
                        <span>{image.fileName}</span>
                        <button onClick={() => removeSelectedImage(image.id)}>×</button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <textarea
                  className="composer-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  placeholder={activeConversationIsRunning ? 'Queue the next turn while Codex is working' : 'Ask for follow-up changes'}
                />

                <div className="composer-footer">
                  <div className="composer-footer-left">
                    <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onPickImages} />
                    <button className="utility-button" onClick={() => fileInputRef.current?.click()}>
                      +
                    </button>
                    <div className="meta-pills">
                      <span>{runtime?.model || 'Runtime'}</span>
                      <span>{runtime?.reasoningEffort || '...'}</span>
                      <span>{formatSandboxModeLabel(runtime?.sandboxMode)}</span>
                    </div>
                  </div>

                  {activeConversationIsRunning && !composerHasContent ? (
                    <button className="send-button" onClick={cancelActiveRun} aria-label="Stop run">
                      <StopIcon />
                    </button>
                  ) : (
                    <button className="send-button" onClick={() => void sendMessage()} aria-label="Send message">
                      ↑
                    </button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </section>

      {newChatOpen ? (
        <div className="modal-shell" role="dialog" aria-modal="true">
          <div className="modal-scrim" onClick={() => setNewChatOpen(false)} />
          <div className="modal-card">
            <h2>New chat</h2>
            <p>
              Pick a workspace instance if you want Codex to work locally on this Mac, or leave the
              thread unbound for a general chat.
            </p>

            <section className="workspace-section">
              <h3>Quick picks</h3>
              <div className="workspace-grid">
                <button
                  className={`workspace-card ${selectedWorkspaceId === 'general' ? 'is-active' : ''}`}
                  onClick={() => setSelectedWorkspaceId('general')}
                >
                  <strong>General chat</strong>
                  <span>No repo binding. Best for questions and planning.</span>
                </button>

                {workspaces.map((workspace) => {
                  const selected = selectedWorkspaceId === workspace.id;
                  return (
                    <button
                      key={workspace.id}
                      className={`workspace-card ${selected ? 'is-active' : ''}`}
                      onClick={() => setSelectedWorkspaceId(workspace.id)}
                    >
                      <strong>{workspace.name}</strong>
                      <span>{formatWorkspaceSubtitle(workspace)}</span>
                      <small>{formatWorkspaceSyncSummary(workspace)}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="workspace-section">
              <h3>Selection</h3>
              <p className={`selection-copy ${workspaceLoadError ? 'is-error' : ''}`}>
                {workspaceLoadError
                  ? workspaceLoadError
                  : loadingWorkspaces
                    ? 'Loading workspace instances from Dev Agent...'
                    : selectedWorkspaceId !== 'general'
                      ? (() => {
                          const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
                          if (!selectedWorkspace) {
                            return 'Choose a workspace.';
                          }
                          return `${selectedWorkspace.localPath}${selectedWorkspace.supabaseProjectRef ? ` • ${selectedWorkspace.supabaseProjectRef}` : ''} • ${formatWorkspaceSyncSummary(selectedWorkspace)}`;
                        })()
                      : 'This thread will stay unbound so you can just chat.'}
              </p>
            </section>

            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setNewChatOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={() => void startNewChat()} disabled={creatingConversation || loadingWorkspaces}>
                {creatingConversation ? 'Starting…' : 'Start New Chat'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

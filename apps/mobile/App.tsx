import React from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions
} from 'react-native';
import Constants from 'expo-constants';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';

type Conversation = {
  id: string;
  title: string;
  mode: 'chat' | 'workspace' | 'harness';
  workspacePath?: string | null;
};

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'event';
  content: string;
  attachments: {
    id: string;
    type?: 'image' | 'video';
    fileName: string;
    mimeType: string | null;
    uploadedPath?: string | null;
    previewUrl: string;
    mediaUrl?: string | null;
  }[];
  createdAt: string;
};

type SelectedImage = {
  id: string;
  fileName: string;
  uri: string;
  mimeType: string | null;
};

type UploadedImageAttachment = {
  id: string;
  type?: 'image' | 'video';
  fileName: string;
  uploadedPath: string;
  previewUrl: string;
  mediaUrl?: string | null;
  mimeType: string | null;
};

type QueuedSteerMap = Record<string, string>;

type ActivityItem = {
  id: string;
  runId: string;
  conversationId: string;
  sourceKey: string;
  kind: 'thinking' | 'search' | 'file_read' | 'command' | 'file_change' | 'tool_call' | 'todo' | 'error';
  title: string;
  detail: string | null;
  status: 'running' | 'completed' | 'failed';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type RunRecord = {
  id: string;
  conversationId: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  finalResponse: string | null;
};

type RuntimeConfig = {
  model: string;
  reasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
};

type ServerRunEvent =
  | { type: 'conversation.updated'; conversation: Conversation }
  | { type: 'conversation.message.created'; conversationId: string; message: Message }
  | { type: 'conversation.run.started'; conversationId: string; runId: string; startedAt: string }
  | { type: 'conversation.run.activity'; conversationId: string; runId: string; activity: ActivityItem }
  | { type: 'conversation.run.event'; conversationId: string; runId: string; event: unknown }
  | { type: 'conversation.run.cancelled'; conversationId: string; runId: string; reason: string }
  | { type: 'conversation.run.completed'; conversationId: string; runId: string; finalResponse: string }
  | { type: 'conversation.run.failed'; conversationId: string | null; runId: string | null; error: string }
  | { type: 'connection.ready'; runtime: RuntimeConfig };

type TimelineEntry =
  | {
      key: string;
      type: 'message';
      createdAt: string;
      message: Message;
    }
  | {
      key: string;
      type: 'activity';
      createdAt: string;
      activity: ActivityItem;
    }
  | {
      key: string;
      type: 'run-marker';
      createdAt: string;
      run: RunRecord;
    };

type ThemeMode = 'dark' | 'light';
type ViewMode = 'chat' | 'settings';
type ContextMessage = Pick<Message, 'id' | 'role' | 'content' | 'attachments'>;
type WorkspaceValidation =
  | {
      state: 'idle';
      message: string;
      resolvedPath: string | null;
      isGitRepo: boolean;
    }
  | {
      state: 'checking';
      message: string;
      resolvedPath: string | null;
      isGitRepo: boolean;
    }
  | {
      state: 'valid';
      message: string;
      resolvedPath: string | null;
      isGitRepo: boolean;
    }
  | {
      state: 'invalid';
      message: string;
      resolvedPath: string | null;
      isGitRepo: boolean;
    };

type WorkspaceQuickPick = {
  id: string;
  label: string;
  description: string;
  path: string | null;
};

type Theme = {
  statusBar: 'light' | 'dark';
  safeArea: string;
  shell: string;
  sidebar: string;
  sidebarBorder: string;
  overlay: string;
  surface: string;
  surfaceAlt: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentText: string;
  softAccent: string;
  userBubble: string;
  assistantBlock: string;
  activeThread: string;
  threadIdle: string;
  pillBorder: string;
  pillFill: string;
  inputFill: string;
  settingsTint: string;
};

type LandingPrompt = {
  id: 'primary' | 'harness';
  eyebrow: string;
  title: string;
  prompt: string;
};

const DISPLAY_FONT = Platform.select({
  ios: 'AvenirNextCondensed-Heavy',
  android: 'sans-serif-condensed',
  default: 'sans-serif'
});

const BODY_FONT = Platform.select({
  ios: 'AvenirNext-Medium',
  android: 'sans-serif-medium',
  default: 'sans-serif'
});

const MARKER_FONT = Platform.select({
  ios: 'Marker Felt',
  android: 'sans-serif',
  default: 'sans-serif'
});

const LANDING_PROMPTS: LandingPrompt[] = [
  {
    id: 'primary',
    eyebrow: 'Poster brief',
    title: 'Build the playful landing variant',
    prompt: 'Build a playful landing screen and run the harness.'
  },
  {
    id: 'harness',
    eyebrow: 'Harness pass',
    title: 'Run the verification loop and report it back',
    prompt: 'Run the harness and report the smoke command.'
  }
];

const WORKSPACE_QUICK_PICKS: WorkspaceQuickPick[] = [
  {
    id: 'general',
    label: 'General chat',
    description: 'No repo binding. Best for questions and planning.',
    path: null
  },
  {
    id: 'dev-agent',
    label: 'Dev Agent',
    description: '/Users/team7agent/dev-agent',
    path: '/Users/team7agent/dev-agent'
  },
  {
    id: 'stick2it-app',
    label: 'Stick2It App',
    description: '/Users/team7agent/stick2it/stick2it',
    path: '/Users/team7agent/stick2it/stick2it'
  },
  {
    id: 'stick2it-admin',
    label: 'Stick2It Admin',
    description: '/Users/team7agent/stick2it/admin',
    path: '/Users/team7agent/stick2it/admin'
  }
];

function GearIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 1.6,
          borderColor: color
        }}
      />
      {[
        { width: 2, height: 6, top: -1, left: 8 },
        { width: 2, height: 6, top: 13, left: 8 },
        { width: 6, height: 2, top: 8, left: -1 },
        { width: 6, height: 2, top: 8, left: 13 },
        { width: 2, height: 5, top: 1, left: 3, transform: [{ rotate: '-45deg' }] },
        { width: 2, height: 5, top: 12, left: 12, transform: [{ rotate: '-45deg' }] },
        { width: 2, height: 5, top: 1, left: 12, transform: [{ rotate: '45deg' }] },
        { width: 2, height: 5, top: 12, left: 3, transform: [{ rotate: '45deg' }] }
      ].map((item, index) => (
        <View
          key={index}
          style={[
            {
              position: 'absolute',
              backgroundColor: color,
              borderRadius: 999
            },
            item
          ]}
        />
      ))}
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: color
        }}
      />
    </View>
  );
}

function ComposeIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: 14,
          height: 14,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          left: 1,
          top: 3
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 11,
          height: 2,
          borderRadius: 999,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
          top: 6,
          left: 7
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          borderLeftWidth: 2,
          borderRightWidth: 2,
          borderBottomWidth: 4,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          transform: [{ rotate: '-45deg' }],
          top: 3,
          left: 13
        }}
      />
    </View>
  );
}

function StopIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          backgroundColor: color
        }}
      />
    </View>
  );
}

function InlineVideoAttachment({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  return (
    <VideoView
      style={{ width: '100%', height: '100%' }}
      player={player}
      nativeControls
      contentFit="cover"
    />
  );
}

const extra = (Constants.expoConfig?.extra || {}) as {
  apiUrl?: string;
  wsUrl?: string;
};

const API_URL = String(
  process.env.EXPO_PUBLIC_DEV_AGENT_API_URL || extra.apiUrl || 'http://localhost:4242'
).replace(/\/+$/, '');
const WS_URL = String(process.env.EXPO_PUBLIC_DEV_AGENT_WS_URL || extra.wsUrl || 'ws://localhost:4242/ws');
const THEME_STORAGE_KEY = 'dev-agent-theme-mode';

const THEMES: Record<ThemeMode, Theme> = {
  dark: {
    statusBar: 'light',
    safeArea: '#0B0B0D',
    shell: '#0E0E11',
    sidebar: '#151519',
    sidebarBorder: '#272A31',
    overlay: 'rgba(4, 4, 6, 0.72)',
    surface: '#17171B',
    surfaceAlt: '#1D1D22',
    surfaceMuted: '#121216',
    border: '#2C2C33',
    text: '#F5F7FA',
    textMuted: '#B1B1BA',
    textSubtle: '#7A7A84',
    accent: '#F5F7FA',
    accentText: '#101014',
    softAccent: '#24242A',
    userBubble: '#212126',
    assistantBlock: '#0E0E11',
    activeThread: '#26262D',
    threadIdle: '#151519',
    pillBorder: '#34343C',
    pillFill: '#1B1B20',
    inputFill: '#19191E',
    settingsTint: '#D7D7DE'
  },
  light: {
    statusBar: 'dark',
    safeArea: '#FFFFFF',
    shell: '#FFFFFF',
    sidebar: '#FFFFFF',
    sidebarBorder: '#DEDEE3',
    overlay: 'rgba(255, 255, 255, 0)',
    surface: '#FFFFFF',
    surfaceAlt: '#F3F3F6',
    surfaceMuted: '#ECECF1',
    border: '#D9D9E0',
    text: '#121216',
    textMuted: '#595965',
    textSubtle: '#7D7D88',
    accent: '#121216',
    accentText: '#FFFFFF',
    softAccent: '#EAEAF0',
    userBubble: '#ECECF2',
    assistantBlock: '#FFFFFF',
    activeThread: '#E9E9EF',
    threadIdle: '#F6F6F8',
    pillBorder: '#D8D8E0',
    pillFill: '#F5F5F8',
    inputFill: '#F5F5F8',
    settingsTint: '#121216'
  }
};

function formatModeLabel(mode: Conversation['mode']): string {
  if (mode === 'workspace') {
    return 'Workspace';
  }

  if (mode === 'harness') {
    return 'Harness';
  }

  return 'Chat';
}

function formatWorkspaceLabel(workspacePath?: string | null): string {
  if (!workspacePath) {
    return 'General chat';
  }

  const matched = WORKSPACE_QUICK_PICKS.find((item) => item.path === workspacePath);
  if (matched) {
    return matched.label;
  }

  const segments = workspacePath.split('/').filter(Boolean);
  return segments[segments.length - 1] || workspacePath;
}

function formatSandboxModeLabel(sandboxMode: string | null | undefined): string {
  if (!sandboxMode) {
    return '...';
  }

  if (sandboxMode === 'danger-full-access') {
    return 'Full access';
  }

  return sandboxMode;
}

function deriveUserMessageContent(prompt: string): string {
  return prompt.trim();
}

function upsertActivity(current: ActivityItem[], next: ActivityItem) {
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [...current, next].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.updatedAt.localeCompare(right.updatedAt)
    );
  }

  const updated = [...current];
  updated[index] = next;
  return updated;
}

function summarizeActivity(activity: ActivityItem): string {
  if (activity.kind === 'command' && activity.detail) {
    return activity.detail;
  }

  return activity.title;
}

function getActivityTone(activity: ActivityItem): 'neutral' | 'error' | 'live' {
  if (activity.status === 'failed' || activity.kind === 'error') {
    return 'error';
  }

  if (activity.status === 'running') {
    return 'live';
  }

  return 'neutral';
}

function formatThinkingLabel(frame: number) {
  const suffix = ['', '.', '..', '...'][frame % 4];
  return `Thinking${suffix}`;
}

function formatElapsedLabel(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0 && seconds === 0) {
    return `${hours}h`;
  }

  if (seconds === 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  return `${hours}h ${remainingMinutes}m ${seconds}s`;
}

type TimelineRenderItem =
  | {
      key: string;
      type: 'message';
      message: Message;
    }
  | {
      key: string;
      type: 'activity';
      activity: ActivityItem;
    }
  | {
      key: string;
      type: 'exploration-summary';
      activities: ActivityItem[];
    }
  | {
      key: string;
      type: 'run-marker';
      run: RunRecord;
    };

function isExplorationActivity(activity: ActivityItem) {
  return (
    (activity.kind === 'search' || activity.kind === 'file_read') &&
    activity.status !== 'failed'
  );
}

function buildTimelineRenderItems(entries: TimelineEntry[]): TimelineRenderItem[] {
  const items: TimelineRenderItem[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    if (entry.type === 'message') {
      items.push({
        key: entry.key,
        type: 'message',
        message: entry.message
      });
      continue;
    }

    if (entry.type === 'run-marker') {
      items.push({
        key: entry.key,
        type: 'run-marker',
        run: entry.run
      });
      continue;
    }

    if (!isExplorationActivity(entry.activity)) {
      items.push({
        key: entry.key,
        type: 'activity',
        activity: entry.activity
      });
      continue;
    }

    const group: ActivityItem[] = [entry.activity];
    let cursor = index + 1;
    while (cursor < entries.length) {
      const candidate = entries[cursor];
      if (candidate.type !== 'activity' || !isExplorationActivity(candidate.activity)) {
        break;
      }

      group.push(candidate.activity);
      cursor += 1;
    }

    if (group.length === 1) {
      items.push({
        key: entry.key,
        type: 'activity',
        activity: entry.activity
      });
    } else {
      items.push({
        key: `summary:${group.map((activity) => activity.id).join(':')}`,
        type: 'exploration-summary',
        activities: group
      });
      index = cursor - 1;
    }
  }

  return items;
}

function createStyles(theme: Theme, sidebarWidth: number) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.safeArea
    },
    container: {
      flex: 1,
      backgroundColor: theme.shell
    },
    shell: {
      flex: 1,
      backgroundColor: theme.shell
    },
    overlayTouchArea: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 10
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.overlay
    },
    sidebar: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: sidebarWidth,
      backgroundColor: theme.sidebar,
      borderRightWidth: 1,
      borderRightColor: theme.sidebarBorder,
      paddingHorizontal: 14,
      paddingTop: 16,
      paddingBottom: 18,
      zIndex: 20,
      shadowColor: '#000000',
      shadowOpacity: theme.statusBar === 'light' ? 0.34 : 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 6, height: 0 }
    },
    sidebarHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16
    },
    sidebarEyebrow: {
      color: theme.textSubtle,
      fontSize: 11,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      marginBottom: 4
    },
    sidebarTitle: {
      color: theme.text,
      fontSize: 28,
      fontWeight: '700'
    },
    iconButton: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: theme.surfaceAlt,
      borderWidth: 1,
      borderColor: theme.border
    },
    iconButtonText: {
      color: theme.text,
      fontSize: 19,
      fontWeight: '700',
      lineHeight: 20
    },
    panelEyebrow: {
      color: theme.textSubtle,
      fontSize: 11,
      letterSpacing: 1.3,
      textTransform: 'uppercase',
      marginBottom: 8
    },
    threadList: {
      flex: 1,
      marginBottom: 14
    },
    threadListContent: {
      gap: 6,
      paddingBottom: 12
    },
    threadItem: {
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
      backgroundColor: theme.threadIdle
    },
    threadItemActive: {
      backgroundColor: theme.activeThread
    },
    threadTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 4
    },
    threadMeta: {
      color: theme.textSubtle,
      fontSize: 12
    },
    activityPanel: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 14,
      minHeight: 126,
      maxHeight: 170
    },
    activityScroll: {
      flex: 1
    },
    activityItem: {
      color: theme.textMuted,
      fontSize: 12,
      lineHeight: 17,
      marginBottom: 8
    },
    activityEmpty: {
      color: theme.textSubtle,
      fontSize: 12
    },
    mainPane: {
      flex: 1,
      backgroundColor: theme.shell,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 12
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 10
    },
    topBarLeft: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      flex: 1
    },
    topBarTitleWrap: {
      flex: 1
    },
    topBarTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 3
    },
    topBarStatus: {
      color: theme.textSubtle,
      fontSize: 13
    },
    topBarWorkspace: {
      color: theme.textSubtle,
      fontSize: 12,
      marginTop: 1
    },
    topBarActions: {
      flexDirection: 'row',
      gap: 8,
      paddingTop: 1
    },
    topBarAction: {
      width: 38,
      height: 38,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt
    },
    topBarPillAction: {
      minWidth: 70,
      height: 38,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      paddingHorizontal: 14
    },
    topBarActionText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '700'
    },
    newChatOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.statusBar === 'light' ? 'rgba(5, 5, 7, 0.72)' : 'rgba(12, 12, 16, 0.18)',
      justifyContent: 'flex-end',
      paddingHorizontal: 14,
      paddingBottom: 20,
      zIndex: 30
    },
    newChatSheet: {
      borderRadius: 26,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 16,
      gap: 14
    },
    newChatTitle: {
      color: theme.text,
      fontSize: 22,
      fontWeight: '700'
    },
    newChatCopy: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 21
    },
    workspaceSection: {
      gap: 10
    },
    workspaceSectionTitle: {
      color: theme.textSubtle,
      fontSize: 11,
      letterSpacing: 1.3,
      textTransform: 'uppercase'
    },
    workspaceQuickPickGrid: {
      gap: 10
    },
    workspaceQuickPick: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      paddingHorizontal: 14,
      paddingVertical: 14
    },
    workspaceQuickPickActive: {
      backgroundColor: theme.softAccent
    },
    workspaceQuickPickLabel: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 4
    },
    workspaceQuickPickDescription: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 18
    },
    workspacePathInput: {
      minHeight: 56,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      color: theme.text,
      fontSize: 15,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    workspaceValidationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    workspaceValidationCopy: {
      flex: 1,
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19
    },
    workspaceValidationCopyInvalid: {
      color: '#D86B6B'
    },
    workspaceValidationCopyValid: {
      color: theme.text
    },
    workspaceValidationButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      paddingHorizontal: 14,
      paddingVertical: 9
    },
    workspaceValidationButtonText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600'
    },
    newChatActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 4
    },
    newChatActionSecondary: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    newChatActionPrimary: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    newChatActionPrimaryDisabled: {
      opacity: 0.52
    },
    newChatActionSecondaryText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600'
    },
    newChatActionPrimaryText: {
      color: theme.accentText,
      fontSize: 14,
      fontWeight: '700'
    },
    conversationSurface: {
      flex: 1,
      borderTopWidth: 1,
      borderTopColor: theme.border
    },
    messages: {
      flex: 1
    },
    messagesContent: {
      paddingTop: 22,
      paddingBottom: 34,
      gap: 18
    },
    messageRow: {
      width: '100%'
    },
    assistantRow: {
      alignItems: 'flex-start'
    },
    userRow: {
      alignItems: 'flex-end'
    },
    assistantBlock: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingBottom: 2
    },
    userBubble: {
      maxWidth: '88%',
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: theme.userBubble,
      borderWidth: 1,
      borderColor: theme.border
    },
    messageRole: {
      color: theme.textSubtle,
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 8
    },
    messageText: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 25
    },
    messageAttachmentGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 10
    },
    messageAttachmentSingle: {
      width: 220,
      height: 220,
      borderRadius: 18,
      backgroundColor: theme.surfaceMuted,
      overflow: 'hidden'
    },
    messageAttachmentMulti: {
      width: 136,
      height: 136,
      borderRadius: 16,
      backgroundColor: theme.surfaceMuted,
      overflow: 'hidden'
    },
    messageAttachmentImage: {
      width: '100%',
      height: '100%'
    },
    messageAttachmentVideo: {
      width: '100%',
      height: '100%',
      backgroundColor: '#000000'
    },
    messageAttachmentCaption: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 10,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: 'rgba(12, 12, 16, 0.72)'
    },
    messageAttachmentCaptionText: {
      color: '#F5F7FA',
      fontSize: 12,
      fontWeight: '600'
    },
    copyToast: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 110,
      alignItems: 'center',
      zIndex: 40,
      pointerEvents: 'none'
    },
    copyToastPill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      paddingHorizontal: 14,
      paddingVertical: 8
    },
    copyToastText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600'
    },
    contextOverlay: {
      flex: 1,
      backgroundColor: theme.statusBar === 'light' ? 'rgba(5, 5, 7, 0.72)' : 'rgba(12, 12, 16, 0.18)',
      justifyContent: 'center',
      paddingHorizontal: 24
    },
    contextStage: {
      alignItems: 'center',
      justifyContent: 'center'
    },
    contextPreviewWrap: {
      width: '100%',
      alignItems: 'center',
      marginBottom: 16
    },
    contextPreviewCard: {
      width: '100%',
      maxWidth: 360,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 18,
      paddingVertical: 16,
      shadowColor: '#000000',
      shadowOpacity: theme.statusBar === 'light' ? 0.28 : 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 }
    },
    contextPreviewUser: {
      backgroundColor: theme.userBubble
    },
    contextPreviewAssistant: {
      backgroundColor: theme.surface
    },
    contextMenu: {
      width: '100%',
      maxWidth: 260,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowOpacity: theme.statusBar === 'light' ? 0.22 : 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 }
    },
    contextMenuAction: {
      paddingHorizontal: 18,
      paddingVertical: 16
    },
    contextMenuActionText: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '600'
    },
    activityRow: {
      width: '100%',
      alignItems: 'flex-start'
    },
    runMarkerRow: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 6,
      marginVertical: 8
    },
    runMarkerLine: {
      flex: 1,
      height: 1,
      backgroundColor: theme.border
    },
    runMarkerLabel: {
      color: theme.textSubtle,
      fontSize: 13,
      fontWeight: '600'
    },
    activityStack: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center'
    },
    activitySummaryCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 14,
      paddingVertical: 13
    },
    activitySummaryTitle: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 8
    },
    activitySummaryLine: {
      color: theme.textSubtle,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 2
    },
    activityInline: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 6
    },
    activityEyebrow: {
      color: theme.textSubtle,
      fontSize: 11,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      marginBottom: 6
    },
    activityTitle: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 20
    },
    activityDetail: {
      color: theme.textSubtle,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 4
    },
    activityInlineError: {
      color: '#D77272'
    },
    activityInlineLive: {
      color: theme.text
    },
    commandCard: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      overflow: 'hidden'
    },
    commandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.border
    },
    commandHeaderLeft: {
      flex: 1,
      paddingRight: 12
    },
    commandTitle: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 4
    },
    commandMeta: {
      color: theme.textSubtle,
      fontSize: 12
    },
    commandStatusPill: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border
    },
    commandStatusText: {
      color: theme.textMuted,
      fontSize: 11,
      letterSpacing: 1.1,
      textTransform: 'uppercase'
    },
    commandStatusTextLive: {
      color: theme.text
    },
    commandStatusTextError: {
      color: '#D77272'
    },
    commandBody: {
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 12
    },
    commandLabel: {
      color: theme.textSubtle,
      fontSize: 11,
      letterSpacing: 1.1,
      textTransform: 'uppercase'
    },
    commandLine: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 22,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
    },
    commandOutput: {
      color: theme.textMuted,
      fontSize: 13,
      lineHeight: 19,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
    },
    thinkingRow: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 6
    },
    thinkingText: {
      color: theme.textMuted,
      fontSize: 15,
      lineHeight: 22
    },
    emptyState: {
      flex: 1,
      justifyContent: 'flex-start',
      alignItems: 'center',
      paddingTop: 108,
      paddingBottom: 40
    },
    emptyCopy: {
      color: theme.textMuted,
      fontSize: 16,
      lineHeight: 25,
      maxWidth: 320,
      textAlign: 'center'
    },
    landingScreen: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 6,
      paddingTop: 2,
      paddingBottom: 10
    },
    landingPoster: {
      minHeight: 520,
      borderRadius: 34,
      borderWidth: 2,
      borderColor: '#17120E',
      backgroundColor: '#FFF4DE',
      overflow: 'hidden',
      paddingHorizontal: 22,
      paddingTop: 24,
      paddingBottom: 20,
      shadowColor: '#3A1D10',
      shadowOpacity: 0.22,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 16 }
    },
    landingPosterGlow: {
      position: 'absolute',
      width: 260,
      height: 260,
      borderRadius: 130,
      backgroundColor: '#FFCE73',
      top: -74,
      right: -52,
      opacity: 0.44
    },
    landingPosterSplash: {
      position: 'absolute',
      width: 230,
      height: 230,
      borderRadius: 115,
      backgroundColor: '#FF7A59',
      bottom: -88,
      left: -68,
      opacity: 0.16
    },
    landingSticker: {
      position: 'absolute',
      borderRadius: 999,
      borderWidth: 2,
      borderColor: '#17120E',
      paddingHorizontal: 12,
      paddingVertical: 7
    },
    landingStickerTop: {
      top: 20,
      right: 18,
      backgroundColor: '#FF6B57'
    },
    landingStickerBottom: {
      bottom: 108,
      right: 22,
      backgroundColor: '#FFE087'
    },
    landingStickerText: {
      color: '#17120E',
      fontSize: 12,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      fontWeight: '800'
    },
    landingEyebrow: {
      color: '#8B3A20',
      fontSize: 13,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 12,
      fontFamily: MARKER_FONT
    },
    landingHeroBlock: {
      maxWidth: 470,
      marginBottom: 20
    },
    landingTitle: {
      color: '#17120E',
      fontSize: 64,
      lineHeight: 58,
      letterSpacing: -2.6,
      fontFamily: DISPLAY_FONT,
      textTransform: 'uppercase'
    },
    landingTitleCompact: {
      fontSize: 54,
      lineHeight: 50
    },
    landingTitleAccent: {
      color: '#F14E37'
    },
    landingCopy: {
      color: '#4E4036',
      fontSize: 17,
      lineHeight: 24,
      marginTop: 14,
      maxWidth: 410,
      fontFamily: BODY_FONT
    },
    landingMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 18
    },
    landingMetaPill: {
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: '#17120E',
      backgroundColor: '#FFFDF6',
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    landingMetaText: {
      color: '#17120E',
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.2
    },
    landingPromptRack: {
      gap: 12
    },
    landingPromptButton: {
      borderRadius: 26,
      borderWidth: 2,
      borderColor: '#17120E',
      paddingHorizontal: 18,
      paddingVertical: 17
    },
    landingPromptButtonPrimary: {
      backgroundColor: '#FF5D47',
      shadowColor: '#17120E',
      shadowOpacity: 0.22,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 8 }
    },
    landingPromptButtonSecondary: {
      backgroundColor: '#FFFDF6',
      shadowColor: '#17120E',
      shadowOpacity: 0.18,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 6 }
    },
    landingPromptButtonPressed: {
      shadowOffset: { width: 0, height: 2 }
    },
    landingPromptEyebrow: {
      color: '#5D2514',
      fontSize: 12,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      marginBottom: 8,
      fontWeight: '700'
    },
    landingPromptTitle: {
      color: '#17120E',
      fontSize: 24,
      lineHeight: 27,
      fontFamily: DISPLAY_FONT,
      textTransform: 'uppercase'
    },
    landingPromptCopy: {
      color: '#4E4036',
      fontSize: 14,
      lineHeight: 20,
      marginTop: 8,
      fontFamily: BODY_FONT
    },
    landingDraftPreview: {
      marginTop: 16,
      borderRadius: 24,
      borderWidth: 2,
      borderColor: '#17120E',
      backgroundColor: 'rgba(255, 253, 246, 0.92)',
      paddingHorizontal: 16,
      paddingVertical: 15
    },
    landingDraftLabel: {
      color: '#8B3A20',
      fontSize: 12,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      marginBottom: 8,
      fontWeight: '700'
    },
    landingDraftText: {
      color: '#17120E',
      fontSize: 17,
      lineHeight: 24,
      fontFamily: BODY_FONT
    },
    landingDraftHint: {
      color: '#5F5348',
      fontSize: 14,
      lineHeight: 20,
      marginTop: 10,
      fontFamily: BODY_FONT
    },
    settingsSurface: {
      flex: 1,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 18
    },
    settingsHeader: {
      marginBottom: 20
    },
    settingsTitle: {
      color: theme.text,
      fontSize: 32,
      lineHeight: 37,
      fontWeight: '700',
      marginBottom: 8
    },
    settingsCopy: {
      color: theme.textMuted,
      fontSize: 15,
      lineHeight: 23,
      maxWidth: 520
    },
    settingsSection: {
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 18,
      marginBottom: 14
    },
    settingsSectionTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 6
    },
    settingsSectionCopy: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 22,
      marginBottom: 14
    },
    themeOption: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      padding: 16,
      marginBottom: 10
    },
    themeOptionActive: {
      borderColor: theme.settingsTint,
      backgroundColor: theme.softAccent
    },
    themeOptionTitle: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 4
    },
    themeOptionCopy: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 21
    },
    settingsMetaList: {
      gap: 10
    },
    settingsMetaItem: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 22
    },
    composerDock: {
      paddingTop: 12
    },
    composerShell: {
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      padding: 12
    },
    queuedSteerCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginBottom: 10
    },
    queuedSteerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6
    },
    queuedSteerLabel: {
      color: theme.textSubtle,
      fontSize: 11,
      letterSpacing: 1.1,
      textTransform: 'uppercase'
    },
    queuedSteerClear: {
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: '600'
    },
    queuedSteerText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 20
    },
    attachmentTray: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 10
    },
    attachmentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.pillBorder,
      backgroundColor: theme.pillFill,
      paddingLeft: 10,
      paddingRight: 8,
      paddingVertical: 7
    },
    attachmentChipDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.textSubtle
    },
    attachmentChipText: {
      color: theme.textMuted,
      fontSize: 12,
      maxWidth: 148
    },
    attachmentChipRemove: {
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceMuted
    },
    attachmentChipRemoveText: {
      color: theme.text,
      fontSize: 11,
      fontWeight: '700'
    },
    input: {
      minHeight: 54,
      maxHeight: 168,
      color: theme.text,
      fontSize: 16,
      lineHeight: 22,
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlignVertical: 'top'
    },
    composerFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 8
    },
    composerMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      flex: 1
    },
    composerUtilityButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.pillBorder,
      backgroundColor: theme.pillFill
    },
    composerUtilityText: {
      color: theme.text,
      fontSize: 20,
      lineHeight: 20,
      marginTop: -2
    },
    composerMetaPill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.pillBorder,
      backgroundColor: theme.pillFill,
      paddingHorizontal: 10,
      paddingVertical: 6,
      color: theme.textMuted,
      fontSize: 12,
      overflow: 'hidden'
    },
    steerMetaButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.pillBorder,
      backgroundColor: theme.pillFill,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    steerMetaButtonActive: {
      backgroundColor: theme.softAccent,
      borderColor: theme.border
    },
    steerMetaButtonText: {
      color: theme.text,
      fontSize: 12,
      fontWeight: '600'
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent
    },
    sendButtonText: {
      color: theme.accentText,
      fontSize: 21,
      fontWeight: '700',
      lineHeight: 22
    },
    steerOverlay: {
      flex: 1,
      backgroundColor: theme.statusBar === 'light' ? 'rgba(5, 5, 7, 0.72)' : 'rgba(12, 12, 16, 0.18)',
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingBottom: 22
    },
    steerSheet: {
      borderRadius: 24,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 16,
      gap: 14
    },
    steerSheetTitle: {
      color: theme.text,
      fontSize: 20,
      fontWeight: '700'
    },
    steerSheetCopy: {
      color: theme.textMuted,
      fontSize: 14,
      lineHeight: 21
    },
    steerInput: {
      minHeight: 110,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      color: theme.text,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      textAlignVertical: 'top'
    },
    steerSheetActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10
    },
    steerSheetButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    steerSheetButtonPrimary: {
      backgroundColor: theme.accent,
      borderColor: theme.accent
    },
    steerSheetButtonText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600'
    },
    steerSheetButtonTextPrimary: {
      color: theme.accentText
    }
  });
}

export default function App() {
  const { width } = useWindowDimensions();
  const sidebarWidth = Math.min(width * 0.84, 340);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [activities, setActivities] = React.useState<ActivityItem[]>([]);
  const [runs, setRuns] = React.useState<RunRecord[]>([]);
  const [selectedImages, setSelectedImages] = React.useState<SelectedImage[]>([]);
  const [draft, setDraft] = React.useState('');
  const [status, setStatus] = React.useState('Connecting to Dev Agent...');
  const [runtime, setRuntime] = React.useState<RuntimeConfig | null>(null);
  const [sidebarVisible, setSidebarVisible] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>('chat');
  const [themeMode, setThemeMode] = React.useState<ThemeMode>('dark');
  const [themeReady, setThemeReady] = React.useState(false);
  const [activeRun, setActiveRun] = React.useState<{ conversationId: string; runId: string; startedAt: string } | null>(null);
  const [thinkingFrame, setThinkingFrame] = React.useState(0);
  const [runClock, setRunClock] = React.useState(0);
  const [copyToastVisible, setCopyToastVisible] = React.useState(false);
  const [contextMessage, setContextMessage] = React.useState<ContextMessage | null>(null);
  const [queuedSteers, setQueuedSteers] = React.useState<QueuedSteerMap>({});
  const [steerModalVisible, setSteerModalVisible] = React.useState(false);
  const [steerDraft, setSteerDraft] = React.useState('');
  const [newChatSheetVisible, setNewChatSheetVisible] = React.useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string>('general');
  const [workspaceDraft, setWorkspaceDraft] = React.useState('');
  const [workspaceValidation, setWorkspaceValidation] = React.useState<WorkspaceValidation>({
    state: 'idle',
    message: 'Choose a quick pick or enter an absolute directory path.',
    resolvedPath: null,
    isGitRepo: false
  });
  const [creatingConversation, setCreatingConversation] = React.useState(false);
  const socketRef = React.useRef<WebSocket | null>(null);
  const messageListRef = React.useRef<ScrollView | null>(null);
  const activeConversationIdRef = React.useRef<string | null>(null);
  const activeRunRef = React.useRef<{ conversationId: string; runId: string; startedAt: string } | null>(null);
  const previousActiveRunRef = React.useRef<{ conversationId: string; runId: string; startedAt: string } | null>(null);
  const queuedSteersRef = React.useRef<QueuedSteerMap>({});
  const dispatchQueuedSteerRef = React.useRef<(conversationId: string, prompt: string) => void>(() => {});
  const queuedSteerDispatchingRef = React.useRef<Record<string, string>>({});
  const copyToastTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextAnimation = React.useRef(new Animated.Value(0)).current;
  const landingEntrance = React.useRef(new Animated.Value(0)).current;
  const landingFloat = React.useRef(new Animated.Value(0)).current;
  const theme = THEMES[themeMode];
  const styles = React.useMemo(() => createStyles(theme, sidebarWidth), [theme, sidebarWidth]);
  const compactLanding = width < 410;

  const activeConversation = React.useMemo(
    () => conversations.find((item) => item.id === activeConversationId) || null,
    [activeConversationId, conversations]
  );
  const canStartNewChat = React.useMemo(() => {
    if (creatingConversation) {
      return false;
    }

    if (selectedWorkspaceId === 'general') {
      return true;
    }

    return workspaceValidation.state === 'valid';
  }, [creatingConversation, selectedWorkspaceId, workspaceValidation.state]);

  const statusTestId = React.useMemo(() => {
    if (status === 'Codex turn completed') {
      return 'status-completed';
    }

    return 'status-text';
  }, [status]);

  const activeConversationIsRunning = React.useMemo(
    () => activeRun?.conversationId === activeConversationId,
    [activeConversationId, activeRun]
  );
  const queuedSteer = React.useMemo(
    () => (activeConversationId ? queuedSteers[activeConversationId] || '' : ''),
    [activeConversationId, queuedSteers]
  );
  const chromeBackground = sidebarVisible ? theme.sidebar : theme.safeArea;
  const shellBackground = sidebarVisible ? theme.sidebar : theme.shell;

  const recentActivityFeed = React.useMemo(
    () => activities.slice(-12).reverse(),
    [activities]
  );

  const timelineEntries = React.useMemo<TimelineEntry[]>(() => {
    const messageEntries = messages.map((message) => ({
      key: `message:${message.id}`,
      type: 'message' as const,
      createdAt: message.createdAt,
      message
    }));
    const activityEntries = activities.map((activity) => ({
      key: `activity:${activity.id}`,
      type: 'activity' as const,
      createdAt: activity.createdAt,
      activity
    }));
    const runEntries = runs
      .filter((run) => run.completedAt)
      .map((run) => ({
        key: `run:${run.id}`,
        type: 'run-marker' as const,
        createdAt: run.completedAt || run.startedAt,
        run
      }));

    return [...messageEntries, ...activityEntries, ...runEntries].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key)
    );
  }, [activities, messages, runs]);

  const timelineRenderItems = React.useMemo(
    () => buildTimelineRenderItems(timelineEntries),
    [timelineEntries]
  );
  const landingVisible = React.useMemo(
    () => viewMode === 'chat' && timelineRenderItems.length === 0 && !activeConversationIsRunning,
    [activeConversationIsRunning, timelineRenderItems.length, viewMode]
  );
  const messageOrdinalById = React.useMemo(() => {
    const counts: Record<Message['role'], number> = {
      user: 0,
      assistant: 0,
      system: 0,
      event: 0
    };
    const ordinals = new Map<string, number>();

    for (const message of messages) {
      counts[message.role] += 1;
      ordinals.set(message.id, counts[message.role]);
    }

    return ordinals;
  }, [messages]);

  const loadConversations = React.useCallback(async () => {
    const response = await fetch(`${API_URL}/api/conversations`);
    const payload = await response.json();
    setConversations(payload.conversations || []);
    if (!activeConversationId && payload.conversations?.length) {
      setActiveConversationId(payload.conversations[0].id);
    }
  }, [activeConversationId]);

  const loadConversationDetail = React.useCallback(async (conversationId: string) => {
    const response = await fetch(`${API_URL}/api/conversations/${conversationId}`);
    const payload = await response.json();
    setMessages(payload.messages || []);
    setActivities(payload.activities || []);
    setRuns(payload.runs || []);
  }, []);

  const loadRuntime = React.useCallback(async () => {
    const response = await fetch(`${API_URL}/api/runtime-config`);
    const payload = await response.json();
    setRuntime(payload.runtime || null);
  }, []);

  React.useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  React.useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  React.useEffect(() => {
    queuedSteersRef.current = queuedSteers;
  }, [queuedSteers]);

  React.useEffect(() => {
    return () => {
      if (copyToastTimeoutRef.current) {
        clearTimeout(copyToastTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (contextMessage) {
      contextAnimation.setValue(0);
      Animated.parallel([
        Animated.timing(contextAnimation, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        })
      ]).start();
      return;
    }

    contextAnimation.stopAnimation();
    contextAnimation.setValue(0);
  }, [contextAnimation, contextMessage]);

  React.useEffect(() => {
    let entranceAnimation: Animated.CompositeAnimation | null = null;
    let floatLoop: Animated.CompositeAnimation | null = null;

    if (!landingVisible) {
      landingEntrance.stopAnimation();
      landingFloat.stopAnimation();
      landingEntrance.setValue(0);
      landingFloat.setValue(0);
      return;
    }

    landingEntrance.setValue(0);
    landingFloat.setValue(0);
    entranceAnimation = Animated.timing(landingEntrance, {
      toValue: 1,
      duration: 540,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(landingFloat, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        }),
        Animated.timing(landingFloat, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        })
      ])
    );

    entranceAnimation.start();
    floatLoop.start();

    return () => {
      entranceAnimation?.stop();
      floatLoop?.stop();
      landingEntrance.stopAnimation();
      landingFloat.stopAnimation();
    };
  }, [landingEntrance, landingFloat, landingVisible]);

  React.useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((value) => {
        if (value === 'light' || value === 'dark') {
          setThemeMode(value);
        }
      })
      .finally(() => {
        setThemeReady(true);
      });
  }, []);

  React.useEffect(() => {
    if (!themeReady) {
      return;
    }

    AsyncStorage.setItem(THEME_STORAGE_KEY, themeMode).catch(() => {
      // Keep the UI responsive even if local persistence fails.
    });
  }, [themeMode, themeReady]);

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
    if (!activeConversationId) {
      return;
    }

    loadConversationDetail(activeConversationId).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load messages.');
    });
  }, [activeConversationId, loadConversationDetail]);

  React.useEffect(() => {
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus('Connected to Dev Agent');
    };

    socket.onmessage = (message) => {
      let event: ServerRunEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }

      if (event.type === 'connection.ready') {
        setRuntime(event.runtime);
        setStatus('Codex bridge ready');
        return;
      }

      if (event.type === 'conversation.updated') {
        setConversations((current) =>
          current.map((item) => (item.id === event.conversation.id ? event.conversation : item))
        );
        return;
      }

      if (event.type === 'conversation.message.created') {
        if (event.conversationId === activeConversationIdRef.current) {
          setMessages((current) => {
            const alreadyPresent = current.some((message) => message.id === event.message.id);
            return alreadyPresent ? current : [...current, event.message];
          });
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

      if (event.type === 'conversation.run.event') {
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
        }

        if (event.runId === activeRunRef.current?.runId) {
          setActiveRun(null);
        }
        if (event.conversationId === activeConversationIdRef.current) {
          setStatus('Codex turn completed');
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
          loadConversationDetail(event.conversationId).catch(() => {
            // Keep the current timeline if the refresh fails.
          });
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
      setStatus('WebSocket connection error');
    };

    socket.onclose = () => {
      setActiveRun(null);
      setStatus('Disconnected from Dev Agent');
    };

    return () => {
      socket.close();
    };
  }, [loadConversationDetail]);

  React.useEffect(() => {
    if (!timelineRenderItems.length && !activeConversationIsRunning) {
      return;
    }

    const timeoutId = setTimeout(() => {
      messageListRef.current?.scrollToEnd({ animated: true });
    }, 10);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [activeConversationIsRunning, timelineRenderItems]);

  React.useEffect(() => {
    if (!activeConversationIsRunning) {
      return;
    }

    setRunClock(Date.now());
    const intervalId = setInterval(() => {
      setRunClock(Date.now());
      setThinkingFrame((current) => current + 1);
    }, 420);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeConversationIsRunning]);

  const validateWorkspacePath = React.useCallback(async (directoryPath: string) => {
    const trimmedPath = directoryPath.trim();
    if (!trimmedPath) {
      setWorkspaceValidation({
        state: 'idle',
        message: 'Choose a quick pick or enter an absolute directory path.',
        resolvedPath: null,
        isGitRepo: false
      });
      return null;
    }

    setWorkspaceValidation({
      state: 'checking',
      message: 'Checking directory on this Mac...',
      resolvedPath: null,
      isGitRepo: false
    });

    try {
      const response = await fetch(`${API_URL}/api/workspaces/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          directoryPath: trimmedPath
        })
      });
      const payload = await response.json();

      if (!response.ok || !payload.valid) {
        setWorkspaceValidation({
          state: 'invalid',
          message: payload.message || 'Directory is not available.',
          resolvedPath: payload.resolvedPath || null,
          isGitRepo: false
        });
        return null;
      }

      const nextValidation: WorkspaceValidation = {
        state: 'valid',
        message: payload.message || 'Directory is ready.',
        resolvedPath: payload.resolvedPath,
        isGitRepo: Boolean(payload.isGitRepo)
      };
      setWorkspaceValidation(nextValidation);
      return nextValidation;
    } catch (error) {
      setWorkspaceValidation({
        state: 'invalid',
        message: error instanceof Error ? error.message : 'Failed to validate directory.',
        resolvedPath: null,
        isGitRepo: false
      });
      return null;
    }
  }, []);

  const openNewChatSheet = React.useCallback(() => {
    setViewMode('chat');
    setSelectedWorkspaceId('general');
    setWorkspaceDraft('');
    setWorkspaceValidation({
      state: 'idle',
      message: 'Choose a quick pick or enter an absolute directory path.',
      resolvedPath: null,
      isGitRepo: false
    });
    setNewChatSheetVisible(true);
  }, []);

  const applyWorkspaceQuickPick = React.useCallback((workspace: WorkspaceQuickPick) => {
    setSelectedWorkspaceId(workspace.id);
    setWorkspaceDraft(workspace.path || '');
    if (!workspace.path) {
      setWorkspaceValidation({
        state: 'valid',
        message: 'This thread will stay unbound so you can just chat.',
        resolvedPath: null,
        isGitRepo: false
      });
      return;
    }

    validateWorkspacePath(workspace.path).catch((error) => {
      setWorkspaceValidation({
        state: 'invalid',
        message: error instanceof Error ? error.message : 'Failed to validate directory.',
        resolvedPath: null,
        isGitRepo: false
      });
    });
  }, [validateWorkspacePath]);

  const createConversation = React.useCallback(async (workspacePath?: string | null) => {
    const response = await fetch(`${API_URL}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'New Codex Chat',
        mode: workspacePath ? 'workspace' : 'chat',
        workspacePath: workspacePath || null
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create conversation.');
    }
    const conversation = payload.conversation as Conversation;
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setMessages([]);
    setActivities([]);
    setRuns([]);
    setDraft('');
    setSelectedImages([]);
    setViewMode('chat');
    setSidebarVisible(false);
    setNewChatSheetVisible(false);
  }, []);

  const startNewChat = React.useCallback(async () => {
    if (creatingConversation) {
      return;
    }

    let nextWorkspacePath: string | null = null;

    if (selectedWorkspaceId !== 'general') {
      const validation =
        workspaceValidation.state === 'valid' && workspaceValidation.resolvedPath
          ? workspaceValidation
          : await validateWorkspacePath(workspaceDraft);

      if (!validation || validation.state !== 'valid') {
        return;
      }

      nextWorkspacePath = validation.resolvedPath;
    }

    try {
      setCreatingConversation(true);
      await createConversation(nextWorkspacePath);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create conversation.');
    } finally {
      setCreatingConversation(false);
    }
  }, [createConversation, creatingConversation, selectedWorkspaceId, validateWorkspacePath, workspaceDraft, workspaceValidation]);

  const selectConversation = React.useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
    setViewMode('chat');
    setSidebarVisible(false);
    setDraft('');
    setSelectedImages([]);
    loadConversationDetail(conversationId).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load conversation.');
    });
  }, [loadConversationDetail]);

  const openSettings = React.useCallback(() => {
    setViewMode('settings');
    setSidebarVisible(false);
  }, []);

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
      setStatus(
        input.selectedImages.length === 1
          ? 'Uploading image...'
          : `Uploading ${input.selectedImages.length} images...`
      );

      uploadedAttachments = await Promise.all(
        input.selectedImages.map(async (image) => {
          const form = new FormData();
          form.append('image', {
            uri: image.uri,
            name: image.fileName,
            type: image.mimeType || 'image/jpeg'
          } as any);

          const response = await fetch(`${API_URL}/api/uploads/image`, {
            method: 'POST',
            body: form
          });

          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || 'Failed to upload image.');
          }

          return payload.attachment as UploadedImageAttachment;
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
          previewUrl: image.uri,
          mediaUrl: image.uri
        })),
        createdAt
      }
    ]);
    setViewMode('chat');
    setThinkingFrame(0);

    socketRef.current.send(
      JSON.stringify({
        type: 'conversation.run',
        conversationId: input.conversationId,
        prompt,
        attachments: uploadedAttachments
      })
    );
  }, []);

  const pickImages = React.useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus('Photo library access is required to attach images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1
    });

    if (result.canceled || !result.assets.length) {
      return;
    }

    setSelectedImages((current) => {
      const next = [...current];
      for (const asset of result.assets) {
        const fileName = asset.fileName || asset.uri.split('/').pop() || `image-${Date.now()}.jpg`;
        if (next.some((item) => item.uri === asset.uri)) {
          continue;
        }

        next.push({
          id: asset.assetId || `${Date.now()}-${asset.uri}`,
          fileName,
          uri: asset.uri,
          mimeType: asset.mimeType || null
        });
      }

      return next;
    });
  }, []);

  const removeSelectedImage = React.useCallback((imageId: string) => {
    setSelectedImages((current) => current.filter((item) => item.id !== imageId));
  }, []);

  const sendMessage = React.useCallback(async () => {
    if ((!draft.trim() && selectedImages.length === 0) || !activeConversationId || !socketRef.current) {
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

  const cancelActiveRun = React.useCallback(() => {
    if (!activeRun || activeRun.conversationId !== activeConversationId || !socketRef.current) {
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: 'conversation.run.cancel',
        conversationId: activeRun.conversationId,
        runId: activeRun.runId
      })
    );
    setStatus('Stopping Codex turn...');
  }, [activeConversationId, activeRun]);

  const clearQueuedSteer = React.useCallback((conversationId: string) => {
    setQueuedSteers((current) => {
      if (!current[conversationId]) {
        return current;
      }

      const next = { ...current };
      delete next[conversationId];
      queuedSteersRef.current = next;
      return next;
    });
  }, []);

  const queueSteer = React.useCallback(() => {
    if (!activeConversationId || !steerDraft.trim()) {
      return;
    }

    const prompt = steerDraft.trim();
    setStatus('Queuing steer...');
    const runStillActive = activeRunRef.current?.conversationId === activeConversationId;
    if (runStillActive) {
      const nextQueuedSteers = {
        ...queuedSteersRef.current,
        [activeConversationId]: prompt
      };
      queuedSteersRef.current = nextQueuedSteers;
      setQueuedSteers((current) => ({
        ...current,
        [activeConversationId]: prompt
      }));
      setStatus('Steer queued for the next turn.');
    } else {
      dispatchQueuedSteerRef.current(activeConversationId, prompt);
    }
    setSteerDraft('');
    setSteerModalVisible(false);
  }, [activeConversationId, steerDraft]);

  const dispatchQueuedSteer = React.useCallback(async (conversationId: string, prompt: string) => {
    if (!prompt.trim()) {
      return;
    }

    if (queuedSteerDispatchingRef.current[conversationId] === prompt) {
      return;
    }

    queuedSteerDispatchingRef.current[conversationId] = prompt;
    await dispatchRun({
      conversationId,
      prompt,
      selectedImages: []
    });
    clearQueuedSteer(conversationId);
    delete queuedSteerDispatchingRef.current[conversationId];
    if (conversationId === activeConversationIdRef.current) {
      setStatus('Queued steer submitted.');
    }
  }, [clearQueuedSteer, dispatchRun]);

  React.useEffect(() => {
    dispatchQueuedSteerRef.current = (conversationId: string, prompt: string) => {
      dispatchQueuedSteer(conversationId, prompt).catch((error) => {
        delete queuedSteerDispatchingRef.current[conversationId];
        setStatus(error instanceof Error ? error.message : 'Failed to submit queued steer.');
      });
    };
  }, [dispatchQueuedSteer]);

  React.useEffect(() => {
    if (activeRun) {
      return;
    }

    const nextQueuedSteer = Object.entries(queuedSteers).find(([, prompt]) => prompt.trim().length > 0);
    if (!nextQueuedSteer) {
      return;
    }

    const [conversationId, prompt] = nextQueuedSteer;
    if (queuedSteerDispatchingRef.current[conversationId] === prompt) {
      return;
    }

    dispatchQueuedSteerRef.current(conversationId, prompt);
  }, [activeRun, queuedSteers]);

  React.useEffect(() => {
    const previousRun = previousActiveRunRef.current;
    previousActiveRunRef.current = activeRun;

    if (!previousRun || activeRun || !steerModalVisible || !activeConversationId) {
      return;
    }

    const prompt = steerDraft.trim();
    if (!prompt) {
      return;
    }

    setSteerDraft('');
    setSteerModalVisible(false);
    setStatus('Submitting steer...');
    dispatchQueuedSteerRef.current(activeConversationId, prompt);
  }, [activeConversationId, activeRun, steerDraft, steerModalVisible]);

  const closeContextMenu = React.useCallback(() => {
    Animated.timing(contextAnimation, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) {
        setContextMessage(null);
      }
    });
  }, [contextAnimation]);

  const openContextMenu = React.useCallback((message: ContextMessage) => {
    setContextMessage(message);
  }, []);

  const copyMessage = React.useCallback(async (content: string) => {
    await Clipboard.setStringAsync(content);
    setCopyToastVisible(true);
    if (copyToastTimeoutRef.current) {
      clearTimeout(copyToastTimeoutRef.current);
    }
    copyToastTimeoutRef.current = setTimeout(() => {
      setCopyToastVisible(false);
    }, 1400);
  }, []);

  const copyFromContextMenu = React.useCallback((content: string) => {
    copyMessage(content)
      .catch(() => {
        setStatus('Failed to copy message.');
      })
      .finally(() => {
        closeContextMenu();
      });
  }, [closeContextMenu, copyMessage]);

  const renderMessageAttachments = React.useCallback((attachments: Message['attachments']) => {
    if (!attachments.length) {
      return null;
    }

    const single = attachments.length === 1;
    return (
      <View style={styles.messageAttachmentGrid}>
        {attachments.map((attachment) => (
          <View
            key={attachment.id}
            style={single ? styles.messageAttachmentSingle : styles.messageAttachmentMulti}
          >
            {attachment.type === 'video' || attachment.mimeType?.startsWith('video/') ? (
              <>
                <View style={styles.messageAttachmentVideo}>
                  <InlineVideoAttachment uri={attachment.mediaUrl || attachment.previewUrl} />
                </View>
                <View style={styles.messageAttachmentCaption}>
                  <Text numberOfLines={1} style={styles.messageAttachmentCaptionText}>
                    {attachment.fileName}
                  </Text>
                </View>
              </>
            ) : (
              <Image
                source={{ uri: attachment.previewUrl }}
                style={styles.messageAttachmentImage}
                resizeMode="cover"
              />
            )}
          </View>
        ))}
      </View>
    );
  }, [styles]);

  const renderActivityRow = React.useCallback((activity: ActivityItem) => {
    const tone = getActivityTone(activity);
    const titleStyle = [
      styles.activityTitle,
      tone === 'error' ? styles.activityInlineError : null,
      tone === 'live' ? styles.activityInlineLive : null
    ];

    if (activity.kind === 'command') {
      const outputPreview =
        typeof activity.metadata.outputPreview === 'string' ? activity.metadata.outputPreview : null;
      return (
        <View key={activity.id} style={styles.commandCard}>
          <View style={styles.commandHeader}>
            <View style={styles.commandHeaderLeft}>
              <Text style={styles.commandTitle}>{activity.title}</Text>
              <Text style={styles.commandMeta}>
                {activity.status === 'running' ? 'Running now' : 'Command finished'}
              </Text>
            </View>
            <View style={styles.commandStatusPill}>
              <Text
                style={[
                  styles.commandStatusText,
                  tone === 'error' ? styles.commandStatusTextError : null,
                  tone === 'live' ? styles.commandStatusTextLive : null
                ]}
              >
                {activity.status}
              </Text>
            </View>
          </View>

          <View style={styles.commandBody}>
            <View>
              <Text style={styles.commandLabel}>Shell</Text>
              <Text style={styles.commandLine}>{activity.detail || activity.title}</Text>
            </View>
            {outputPreview ? (
              <View>
                <Text style={styles.commandLabel}>Output</Text>
                <Text style={styles.commandOutput}>{outputPreview}</Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    }

    return (
      <View key={activity.id} style={styles.activityInline}>
        <Text style={styles.activityEyebrow}>
          {activity.kind === 'thinking'
            ? 'Progress'
            : activity.kind.replace('_', ' ')}
        </Text>
        <Text style={titleStyle}>{activity.title}</Text>
        {activity.detail ? <Text style={styles.activityDetail}>{activity.detail}</Text> : null}
      </View>
    );
  }, [styles]);

  const renderRunMarker = React.useCallback((run: RunRecord, mode: 'live' | 'completed') => {
    const endTime = mode === 'live' ? runClock : new Date(run.completedAt || run.startedAt).getTime();
    const startTime = new Date(run.startedAt).getTime();
    const elapsedSeconds = Math.max(1, Math.floor((endTime - startTime) / 1000));
    const label =
      mode === 'live'
        ? `Working for ${formatElapsedLabel(elapsedSeconds)}`
        : `Worked for ${formatElapsedLabel(elapsedSeconds)}`;

    return (
      <View key={`${run.id}-${mode}`} style={styles.runMarkerRow}>
        <View style={styles.runMarkerLine} />
        <Text style={styles.runMarkerLabel}>{label}</Text>
        <View style={styles.runMarkerLine} />
      </View>
    );
  }, [runClock, styles.runMarkerLabel, styles.runMarkerLine, styles.runMarkerRow]);

  const contextPreviewAnimatedStyle = React.useMemo(
    () => ({
      opacity: contextAnimation,
      transform: [
        {
          scale: contextAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1.04]
          })
        },
        {
          translateY: contextAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0]
          })
        }
      ]
    }),
    [contextAnimation]
  );

  const contextMenuAnimatedStyle = React.useMemo(
    () => ({
      opacity: contextAnimation,
      transform: [
        {
          scale: contextAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1]
          })
        },
        {
          translateY: contextAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [8, 0]
          })
        }
      ]
    }),
    [contextAnimation]
  );

  const landingPosterAnimatedStyle = React.useMemo(
    () => ({
      opacity: landingEntrance,
      transform: [
        {
          translateY: landingEntrance.interpolate({
            inputRange: [0, 1],
            outputRange: [26, 0]
          })
        },
        {
          scale: landingEntrance.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1]
          })
        }
      ]
    }),
    [landingEntrance]
  );

  const landingTopStickerAnimatedStyle = React.useMemo(
    () => ({
      transform: [
        {
          translateY: landingFloat.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -8]
          })
        },
        {
          rotate: landingFloat.interpolate({
            inputRange: [0, 1],
            outputRange: ['-7deg', '-3deg']
          })
        }
      ]
    }),
    [landingFloat]
  );

  const landingBottomStickerAnimatedStyle = React.useMemo(
    () => ({
      transform: [
        {
          translateY: landingFloat.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 10]
          })
        },
        {
          rotate: landingFloat.interpolate({
            inputRange: [0, 1],
            outputRange: ['5deg', '9deg']
          })
        }
      ]
    }),
    [landingFloat]
  );

  const landingTitleStyle = React.useMemo(
    () => [styles.landingTitle, compactLanding ? styles.landingTitleCompact : null],
    [compactLanding, styles]
  );

  const applyLandingPrompt = React.useCallback((prompt: string) => {
    setDraft(prompt);
    setSelectedImages([]);
    setStatus('Landing prompt ready.');
  }, []);

  const renderLandingState = () => (
    <View testID="landing-screen" style={styles.emptyState}>
      <Text style={styles.emptyCopy}>
        I&apos;m your dev agent.
        {'\n'}
        Ask me to implement anything.
      </Text>
    </View>
  );

  const renderChatPane = () => (
    <>
      <View style={styles.conversationSurface}>
        <ScrollView
          ref={messageListRef}
          testID="message-list"
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
        >
          {timelineRenderItems.length ? (
            timelineRenderItems.map((item) => {
              if (item.type === 'message') {
                const message = item.message;
                return (
                  <View
                    key={item.key}
                    testID={`message-${message.role}-${messageOrdinalById.get(message.id) || 1}`}
                    style={[
                      styles.messageRow,
                      message.role === 'user' ? styles.userRow : styles.assistantRow
                    ]}
                  >
                    <Pressable
                      delayLongPress={220}
                      onLongPress={() => {
                        openContextMenu({
                          id: message.id,
                          role: message.role,
                          content: message.content,
                          attachments: message.attachments
                        });
                      }}
                      style={message.role === 'user' ? styles.userBubble : styles.assistantBlock}
                    >
                      <Text style={styles.messageRole}>{message.role === 'user' ? 'You' : 'Codex'}</Text>
                      {renderMessageAttachments(message.attachments)}
                      {message.content ? <Text style={styles.messageText}>{message.content}</Text> : null}
                    </Pressable>
                  </View>
                );
              }

              if (item.type === 'exploration-summary') {
                const fileReads = item.activities.filter((activity) => activity.kind === 'file_read').length;
                const searches = item.activities.filter((activity) => activity.kind === 'search').length;
                const summaryParts = [
                  fileReads ? `${fileReads} file${fileReads === 1 ? '' : 's'}` : null,
                  searches ? `${searches} search${searches === 1 ? '' : 'es'}` : null
                ].filter(Boolean);

                return (
                  <View key={item.key} style={styles.activityRow}>
                    <View style={styles.activityStack}>
                      <View style={styles.activitySummaryCard}>
                        <Text style={styles.activitySummaryTitle}>
                          Explored {summaryParts.join(', ')}
                        </Text>
                        {item.activities.map((activity) => (
                          <Text key={activity.id} style={styles.activitySummaryLine}>
                            {summarizeActivity(activity)}
                          </Text>
                        ))}
                      </View>
                    </View>
                  </View>
                );
              }

              if (item.type === 'run-marker') {
                return renderRunMarker(item.run, 'completed');
              }

              return (
                <View key={item.key} style={styles.activityRow}>
                  {renderActivityRow(item.activity)}
                </View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              {renderLandingState()}
            </View>
          )}

          {activeConversationIsRunning && activeRun ? renderRunMarker({
            id: activeRun.runId,
            conversationId: activeRun.conversationId,
            prompt: '',
            status: 'running',
            startedAt: activeRun.startedAt,
            completedAt: null,
            finalResponse: null
          }, 'live') : null}

          {activeConversationIsRunning ? (
            <View style={styles.activityRow}>
              <View style={styles.thinkingRow}>
                <Text testID="thinking-indicator" style={styles.thinkingText}>
                  {formatThinkingLabel(thinkingFrame)}
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View style={styles.composerDock}>
        <View style={styles.composerShell}>
          {queuedSteer ? (
            <View style={styles.queuedSteerCard}>
              <View style={styles.queuedSteerHeader}>
                <Text style={styles.queuedSteerLabel}>Queued steer</Text>
                <Pressable onPress={() => activeConversationId && clearQueuedSteer(activeConversationId)}>
                  <Text style={styles.queuedSteerClear}>Clear</Text>
                </Pressable>
              </View>
              <Text numberOfLines={3} style={styles.queuedSteerText}>
                {queuedSteer}
              </Text>
            </View>
          ) : null}
          {selectedImages.length ? (
            <View style={styles.attachmentTray}>
              {selectedImages.map((image) => (
                <View key={image.id} style={styles.attachmentChip}>
                  <View style={styles.attachmentChipDot} />
                  <Text numberOfLines={1} style={styles.attachmentChipText}>
                    {image.fileName}
                  </Text>
                  <Pressable
                    testID={`remove-image-${image.id}`}
                    style={styles.attachmentChipRemove}
                    onPress={() => removeSelectedImage(image.id)}
                  >
                    <Text style={styles.attachmentChipRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <TextInput
            testID="composer-input"
            value={draft}
            onChangeText={setDraft}
            multiline
            scrollEnabled
            placeholder="Ask for follow-up changes"
            placeholderTextColor={theme.textSubtle}
            style={styles.input}
          />
          <View style={styles.composerFooter}>
            <TouchableOpacity
              testID="add-image-button"
              style={styles.composerUtilityButton}
              onPress={() => {
                pickImages().catch((error) => {
                  setStatus(error instanceof Error ? error.message : 'Failed to pick image.');
                });
              }}
            >
              <Text style={styles.composerUtilityText}>+</Text>
            </TouchableOpacity>
            <View style={styles.composerMetaRow}>
              {activeConversationIsRunning ? (
                <TouchableOpacity
                  testID="open-steer-button"
                  style={[styles.steerMetaButton, queuedSteer ? styles.steerMetaButtonActive : null]}
                  onPress={() => {
                    setSteerDraft(queuedSteer || '');
                    setSteerModalVisible(true);
                  }}
                >
                  <Text style={styles.steerMetaButtonText}>{queuedSteer ? 'Steer queued' : 'Steer'}</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.composerMetaPill}>{runtime?.model || 'Runtime'}</Text>
              <Text style={styles.composerMetaPill}>{runtime?.reasoningEffort || '...'}</Text>
              <Text style={styles.composerMetaPill}>{formatSandboxModeLabel(runtime?.sandboxMode)}</Text>
            </View>
            {activeConversationIsRunning ? (
              <TouchableOpacity testID="stop-button" style={styles.sendButton} onPress={cancelActiveRun}>
                <StopIcon color={theme.accentText} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID="send-button"
                style={styles.sendButton}
                onPress={() => {
                  sendMessage().catch((error) => {
                    setStatus(error instanceof Error ? error.message : 'Failed to send message.');
                  });
                }}
              >
                <Text style={styles.sendButtonText}>↑</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {copyToastVisible ? (
        <View style={styles.copyToast}>
          <View style={styles.copyToastPill}>
            <Text style={styles.copyToastText}>Copied</Text>
          </View>
        </View>
      ) : null}

      <Modal visible={!!contextMessage} transparent animationType="none" onRequestClose={closeContextMenu}>
        <Pressable style={styles.contextOverlay} onPress={closeContextMenu}>
          <View style={styles.contextStage}>
            {contextMessage ? (
              <>
                <Animated.View style={[styles.contextPreviewWrap, contextPreviewAnimatedStyle]}>
                  <View
                    style={[
                      styles.contextPreviewCard,
                      contextMessage.role === 'user'
                        ? styles.contextPreviewUser
                        : styles.contextPreviewAssistant
                    ]}
                  >
                    <Text style={styles.messageRole}>
                      {contextMessage.role === 'user' ? 'You' : 'Codex'}
                    </Text>
                    {renderMessageAttachments(contextMessage.attachments)}
                    {contextMessage.content ? (
                      <Text style={styles.messageText}>{contextMessage.content}</Text>
                    ) : null}
                  </View>
                </Animated.View>

                <Animated.View style={[styles.contextMenu, contextMenuAnimatedStyle]}>
                  <Pressable
                    testID="copy-message-action"
                    style={styles.contextMenuAction}
                    onPress={() => copyFromContextMenu(contextMessage.content)}
                  >
                    <Text style={styles.contextMenuActionText}>Copy</Text>
                  </Pressable>
                </Animated.View>
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={steerModalVisible} transparent animationType="fade" onRequestClose={() => setSteerModalVisible(false)}>
        <View style={styles.steerOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSteerModalVisible(false)}
          />
          <View style={styles.steerSheet}>
            <Text style={styles.steerSheetTitle}>Steer</Text>
            <Text style={styles.steerSheetCopy}>
              This steer will be queued and submitted as the next turn after the current run finishes.
            </Text>
              <TextInput
                testID="steer-input"
                value={steerDraft}
                onChangeText={setSteerDraft}
                placeholder="Tell Codex what to do differently next"
                placeholderTextColor={theme.textSubtle}
                autoFocus
                multiline
                style={styles.steerInput}
              />
            <View style={styles.steerSheetActions}>
              <TouchableOpacity
                style={styles.steerSheetButton}
                onPress={() => setSteerModalVisible(false)}
              >
                <Text style={styles.steerSheetButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="queue-steer-button"
                style={[styles.steerSheetButton, styles.steerSheetButtonPrimary]}
                onPressIn={queueSteer}
              >
                <Text style={[styles.steerSheetButtonText, styles.steerSheetButtonTextPrimary]}>
                  Queue steer
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );

  const renderSettingsPane = () => (
    <View style={styles.settingsSurface}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.settingsHeader}>
          <Text style={styles.settingsTitle}>Settings</Text>
          <Text style={styles.settingsCopy}>
            Tune the look of the app and inspect the execution posture of the Codex bridge without
            leaving the mobile shell.
          </Text>
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>Appearance</Text>
          <Text style={styles.settingsSectionCopy}>
            Switch between the darker workspace mode and a brighter paper-like interface.
          </Text>

          <TouchableOpacity
            testID="theme-dark-button"
            style={[styles.themeOption, themeMode === 'dark' && styles.themeOptionActive]}
            onPress={() => setThemeMode('dark')}
          >
            <Text style={styles.themeOptionTitle}>Dark mode</Text>
            <Text style={styles.themeOptionCopy}>
              A desktop-Codex inspired surface with low glare, sharper contrast, and calmer chrome.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="theme-light-button"
            style={[styles.themeOption, themeMode === 'light' && styles.themeOptionActive]}
            onPress={() => setThemeMode('light')}
          >
            <Text style={styles.themeOptionTitle}>Light mode</Text>
            <Text style={styles.themeOptionCopy}>
              A warm, brighter workspace that keeps the same structure while softening the overall
              feel.
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.settingsSectionTitle}>Codex runtime</Text>
          <Text style={styles.settingsSectionCopy}>
            These values are coming from the server so you can confirm how the bridge is currently
            configured.
          </Text>
          <View style={styles.settingsMetaList}>
            <Text style={styles.settingsMetaItem}>Model: {runtime?.model || 'loading'}</Text>
            <Text style={styles.settingsMetaItem}>
              Reasoning: {runtime?.reasoningEffort || 'loading'}
            </Text>
            <Text style={styles.settingsMetaItem}>
              Access: {formatSandboxModeLabel(runtime?.sandboxMode) || 'loading'}
            </Text>
            <Text style={styles.settingsMetaItem}>
              Approvals: {runtime?.approvalPolicy || 'loading'}
            </Text>
            <Text style={styles.settingsMetaItem}>
              Network: {runtime ? (runtime.networkAccessEnabled ? 'enabled' : 'disabled') : 'loading'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: chromeBackground }]}>
      <ExpoStatusBar style={theme.statusBar} />
      <StatusBar barStyle={theme.statusBar === 'light' ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: shellBackground }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={[styles.shell, { backgroundColor: shellBackground }]}>
          {sidebarVisible ? (
            <Pressable
              testID="sidebar-overlay"
              style={styles.overlayTouchArea}
              onPress={() => setSidebarVisible(false)}
            >
              <View style={styles.overlay} />
            </Pressable>
          ) : null}

          {sidebarVisible ? (
            <View testID="sidebar-panel" style={styles.sidebar}>
            <View style={styles.sidebarHeader}>
              <View>
                <Text style={styles.sidebarEyebrow}>Dev Agent</Text>
                <Text style={styles.sidebarTitle}>Threads</Text>
              </View>
              <TouchableOpacity
                testID="close-sidebar-button"
                style={styles.iconButton}
                onPress={() => setSidebarVisible(false)}
              >
                <Text style={styles.iconButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.threadList}
              contentContainerStyle={styles.threadListContent}
              keyboardShouldPersistTaps="handled"
            >
              {conversations.map((conversation) => {
                const active = conversation.id === activeConversationId;
                return (
                  <TouchableOpacity
                    key={conversation.id}
                    testID={`conversation-item-${conversation.id}`}
                    style={[styles.threadItem, active && styles.threadItemActive]}
                    onPress={() => selectConversation(conversation.id)}
                  >
                    <Text numberOfLines={2} style={styles.threadTitle}>
                      {conversation.title}
                    </Text>
                    <Text style={styles.threadMeta}>
                      {formatModeLabel(conversation.mode)} · {formatWorkspaceLabel(conversation.workspacePath)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.activityPanel}>
              <Text style={styles.panelEyebrow}>Run activity</Text>
              <ScrollView style={styles.activityScroll} keyboardShouldPersistTaps="handled">
                {recentActivityFeed.length ? (
                  recentActivityFeed.map((activity) => (
                    <Text key={activity.id} style={styles.activityItem}>
                      {summarizeActivity(activity)}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.activityEmpty}>Waiting for the next turn.</Text>
                )}
              </ScrollView>
            </View>
            </View>
          ) : null}

          <View style={styles.mainPane}>
            <View style={styles.topBar}>
              <View style={styles.topBarLeft}>
                <TouchableOpacity
                  testID="sidebar-toggle-button"
                  style={styles.iconButton}
                  onPress={() => setSidebarVisible(true)}
                >
                  <Text style={styles.iconButtonText}>≡</Text>
                </TouchableOpacity>

                <View style={styles.topBarTitleWrap}>
                  <Text style={styles.topBarTitle} numberOfLines={1}>
                    {viewMode === 'settings'
                      ? 'Settings'
                      : activeConversation?.title || 'New thread'}
                  </Text>
                  <Text testID={statusTestId} style={styles.topBarStatus} numberOfLines={1}>
                    {viewMode === 'settings' ? `Theme: ${themeMode}` : status}
                  </Text>
                  {viewMode === 'settings' ? null : (
                    <Text style={styles.topBarWorkspace} numberOfLines={1}>
                      {formatWorkspaceLabel(activeConversation?.workspacePath)}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.topBarActions}>
                <TouchableOpacity testID="open-settings-button" style={styles.topBarAction} onPress={openSettings}>
                  <GearIcon color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity testID="new-chat-button" style={styles.topBarAction} onPress={openNewChatSheet}>
                  <ComposeIcon color={theme.text} />
                </TouchableOpacity>
              </View>
            </View>

            {viewMode === 'settings' ? renderSettingsPane() : renderChatPane()}
          </View>

          {newChatSheetVisible ? (
            <View style={styles.newChatOverlay} pointerEvents="box-none">
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setNewChatSheetVisible(false)}
              />
              <View style={styles.newChatSheet}>
                <Text style={styles.newChatTitle}>New chat</Text>
                <Text style={styles.newChatCopy}>
                  Pick a repo if you want Codex to work locally on this Mac, or leave the thread unbound
                  for a general chat.
                </Text>

                <View style={styles.workspaceSection}>
                  <Text style={styles.workspaceSectionTitle}>Quick picks</Text>
                  <View style={styles.workspaceQuickPickGrid}>
                    {WORKSPACE_QUICK_PICKS.map((workspace) => {
                      const selected = selectedWorkspaceId === workspace.id;
                      return (
                        <TouchableOpacity
                          key={workspace.id}
                          testID={`workspace-pick-${workspace.id}`}
                          style={[styles.workspaceQuickPick, selected ? styles.workspaceQuickPickActive : null]}
                          onPress={() => applyWorkspaceQuickPick(workspace)}
                        >
                          <Text style={styles.workspaceQuickPickLabel}>{workspace.label}</Text>
                          <Text style={styles.workspaceQuickPickDescription}>{workspace.description}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.workspaceSection}>
                  <Text style={styles.workspaceSectionTitle}>Custom directory</Text>
                  <TextInput
                    testID="workspace-path-input"
                    value={workspaceDraft}
                    onChangeText={(value) => {
                      setSelectedWorkspaceId('custom');
                      setWorkspaceDraft(value);
                      setWorkspaceValidation({
                        state: 'idle',
                        message: value.trim()
                          ? 'Validate this path before starting the chat.'
                          : 'Choose a quick pick or enter an absolute directory path.',
                        resolvedPath: null,
                        isGitRepo: false
                      });
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="/Users/team7agent/stick2it/stick2it"
                    placeholderTextColor={theme.textSubtle}
                    style={styles.workspacePathInput}
                  />
                  <View style={styles.workspaceValidationRow}>
                    <Text
                      style={[
                        styles.workspaceValidationCopy,
                        workspaceValidation.state === 'invalid'
                          ? styles.workspaceValidationCopyInvalid
                          : null,
                        workspaceValidation.state === 'valid'
                          ? styles.workspaceValidationCopyValid
                          : null
                      ]}
                    >
                      {workspaceValidation.message}
                    </Text>
                    <Pressable
                      testID="validate-workspace-button"
                      style={styles.workspaceValidationButton}
                      onPress={() => {
                        validateWorkspacePath(workspaceDraft).catch((error) => {
                          setWorkspaceValidation({
                            state: 'invalid',
                            message: error instanceof Error ? error.message : 'Failed to validate directory.',
                            resolvedPath: null,
                            isGitRepo: false
                          });
                        });
                      }}
                    >
                      <Text style={styles.workspaceValidationButtonText}>
                        {workspaceValidation.state === 'checking' ? 'Checking…' : 'Validate'}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.newChatActions}>
                  <Pressable
                    style={styles.newChatActionSecondary}
                    onPress={() => setNewChatSheetVisible(false)}
                  >
                    <Text style={styles.newChatActionSecondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    testID="start-new-chat-button"
                    style={[
                      styles.newChatActionPrimary,
                      !canStartNewChat ? styles.newChatActionPrimaryDisabled : null
                    ]}
                    disabled={!canStartNewChat}
                    onPress={() => {
                      startNewChat().catch((error) => {
                        setStatus(error instanceof Error ? error.message : 'Failed to start new chat.');
                      });
                    }}
                  >
                    <Text style={styles.newChatActionPrimaryText}>
                      {creatingConversation ? 'Starting…' : 'Start New Chat'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

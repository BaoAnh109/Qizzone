import { create } from "zustand";
import { errorMessage } from "@/lib/cloud";
import {
  notificationService,
  type NotificationRealtimeEvent,
} from "@/services/notificationService";
import type { InAppNotification } from "@qizzone/domain";

let loadVersion = 0;
let activeRealtimeCleanup: (() => void) | null = null;
let activeRealtimeUid: string | null = null;

function computeUnreadCount(items: InAppNotification[]): number {
  return items.reduce((count, item) => (item.isRead ? count : count + 1), 0);
}

interface NotificationStoreState {
  notifications: InAppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
  load: (limit?: number, unreadOnly?: boolean) => Promise<void>;
  markRead: (ids?: string[] | null) => Promise<number>;
  markAllRead: () => Promise<number>;
  subscribeRealtime: (userId: string) => () => void;
  unsubscribeRealtime: () => void;
  applyRealtimeEvent: (event: NotificationRealtimeEvent) => void;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,

  reset: () => {
    loadVersion += 1;
    get().unsubscribeRealtime();
    set({
      notifications: [],
      unreadCount: 0,
      isLoading: false,
      error: null,
    });
  },

  load: async (limit = 30, unreadOnly = false) => {
    const version = loadVersion;
    set({ isLoading: true, error: null });
    try {
      const response = await notificationService.listMyNotifications(limit, unreadOnly);
      if (version !== loadVersion) return;
      const items = Array.isArray(response?.items) ? response.items : [];
      const unreadCount =
        typeof response?.unreadCount === "number"
          ? response.unreadCount
          : computeUnreadCount(items);
      set({
        notifications: items,
        unreadCount,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (version === loadVersion) {
        set({ isLoading: false, error: errorMessage(error) });
      }
      throw error;
    }
  },

  markRead: async (ids = null) => {
    const targetIds = ids && ids.length > 0 ? new Set(ids) : null;
    const prevNotifications = get().notifications;
    const prevUnreadCount = get().unreadCount;

    let newlyReadCount = 0;
    const optimistic = prevNotifications.map((item) => {
      const matches = targetIds ? targetIds.has(item.id) : !item.isRead;
      if (matches && !item.isRead) {
        newlyReadCount += 1;
        return {
          ...item,
          isRead: true,
          readAt: item.readAt ?? new Date().toISOString(),
        };
      }
      return item;
    });

    if (newlyReadCount > 0) {
      set({
        notifications: optimistic,
        unreadCount: targetIds
          ? Math.max(0, prevUnreadCount - newlyReadCount)
          : 0,
      });
    }

    try {
      const updatedCount = await notificationService.markNotificationsRead(ids);
      return updatedCount;
    } catch (error) {
      set({
        notifications: prevNotifications,
        unreadCount: prevUnreadCount,
      });
      throw error;
    }
  },

  markAllRead: () => get().markRead(null),

  applyRealtimeEvent: (event) => {
    set((state) => {
      if (event.eventType === "DELETE") {
        if (!event.oldId) return state;
        const removed = state.notifications.find((n) => n.id === event.oldId);
        if (!removed) return state;
        const nextItems = state.notifications.filter((n) => n.id !== event.oldId);
        return {
          notifications: nextItems,
          unreadCount: removed.isRead
            ? state.unreadCount
            : Math.max(0, state.unreadCount - 1),
        };
      }

      const incoming = event.record;
      if (!incoming) return state;

      const existingIdx = state.notifications.findIndex((n) => n.id === incoming.id);
      if (existingIdx === -1) {
        const nextItems = [incoming, ...state.notifications];
        return {
          notifications: nextItems,
          unreadCount: incoming.isRead ? state.unreadCount : state.unreadCount + 1,
        };
      }

      const existing = state.notifications[existingIdx];
      const nextItems = [...state.notifications];
      nextItems[existingIdx] = incoming;
      let delta = 0;
      if (existing.isRead && !incoming.isRead) delta = 1;
      if (!existing.isRead && incoming.isRead) delta = -1;

      return {
        notifications: nextItems,
        unreadCount: Math.max(0, state.unreadCount + delta),
      };
    });
  },

  subscribeRealtime: (userId) => {
    if (activeRealtimeUid === userId && activeRealtimeCleanup) {
      return activeRealtimeCleanup;
    }
    get().unsubscribeRealtime();
    activeRealtimeUid = userId;
    const cleanup = notificationService.subscribeToNotifications(userId, (event) => {
      get().applyRealtimeEvent(event);
    });
    activeRealtimeCleanup = () => {
      cleanup();
      if (activeRealtimeUid === userId) {
        activeRealtimeUid = null;
        activeRealtimeCleanup = null;
      }
    };
    return activeRealtimeCleanup;
  },

  unsubscribeRealtime: () => {
    if (activeRealtimeCleanup) {
      const cleanup = activeRealtimeCleanup;
      activeRealtimeCleanup = null;
      activeRealtimeUid = null;
      cleanup();
    } else {
      activeRealtimeUid = null;
    }
  },
}));

export default useNotificationStore;

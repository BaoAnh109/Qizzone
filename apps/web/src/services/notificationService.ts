import { rpc, supabase } from "@/lib/cloud";
import {
  markNotificationsReadSchema,
  type InAppNotification,
} from "@qizzone/domain";

export interface NotificationListResponse {
  unreadCount: number;
  items: InAppNotification[];
}

export interface NotificationRealtimeEvent {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  record: InAppNotification | null;
  oldId?: string;
}

export function mapRealtimeNotification(row: Record<string, unknown>): InAppNotification {
  return {
    id: String(row.id ?? ""),
    recipientUid: String(row.recipient_uid ?? row.recipientUid ?? ""),
    actorUid:
      typeof row.actor_uid === "string"
        ? row.actor_uid
        : typeof row.actorUid === "string"
        ? row.actorUid
        : null,
    type: String(row.type ?? "system_notice"),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    targetRoute: String(row.target_route ?? row.targetRoute ?? "/"),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    isRead: Boolean(row.is_read ?? row.isRead ?? false),
    readAt:
      typeof row.read_at === "string"
        ? row.read_at
        : typeof row.readAt === "string"
        ? row.readAt
        : null,
    createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
  };
}

export const notificationService = {
  listMyNotifications: (limit = 30, unreadOnly = false) =>
    rpc<NotificationListResponse>("list_my_notifications", {
      p_limit: limit,
      p_unread_only: unreadOnly,
    }),

  markNotificationsRead: (ids?: string[] | null) => {
    const parsed = markNotificationsReadSchema.parse({ ids: ids ?? null });
    return rpc<number>("mark_notifications_read", {
      p_ids: parsed.ids,
    });
  },

  subscribeToNotifications: (
    recipientUid: string,
    onEvent: (event: NotificationRealtimeEvent) => void
  ): (() => void) => {
    const client = supabase();
    const channel = client
      .channel(`in-app-notifications:${recipientUid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "in_app_notifications",
          filter: `recipient_uid=eq.${recipientUid}`,
        },
        (payload) => {
          const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
          if (eventType === "DELETE") {
            const oldRecord = (payload.old || {}) as Record<string, unknown>;
            onEvent({
              eventType,
              record: null,
              oldId: typeof oldRecord.id === "string" ? oldRecord.id : undefined,
            });
            return;
          }
          const raw = (payload.new || {}) as Record<string, unknown>;
          if (!raw.id) return;
          onEvent({
            eventType,
            record: mapRealtimeNotification(raw),
          });
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  },
};

import type { Platform } from "@/lib/platforms";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type { Platform };

export type FlowStatus = "draft" | "published" | "archived";
export type ConversationStatus = "open" | "closed" | "snoozed";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "pending" | "sent" | "delivered" | "failed";
/** De donde sale la conexion del canal (migracion 00019). */
export type ChannelProvider = "zernio" | "evolution";
export type ChannelConnectionStatus =
  | "connected"
  | "disconnected"
  | "connecting"
  | "error"
  | "unknown";
/** Clase de integracion en integration_configs (migracion 00020). */
export type IntegrationType = "channel" | "ai_provider" | "email_provider";

/** Estado de procesamiento de un documento de la base de conocimiento (00049). */
export type KnowledgeStatus = "processing" | "ready" | "error";
/** Por que se vinculo un remitente a un contacto ya existente (migracion 00025). */
export type ContactLinkReason = "channel" | "phone" | "email" | "username";
/** Entidades que registra el audit log (migracion 00023). */
export type AuditEntityType =
  | "contact"
  | "contact_note"
  | "conversation"
  | "channel"
  | "workspace"
  | "workspace_member"
  | "response_template"
  | "csv_import"
  | "sequence"
  | "sequence_enrollment";
/** Acciones que registra el audit log (migracion 00023). */
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "assign"
  | "link"
  | "import"
  | "do_not_contact"
  /** Un evento del CRM disparo un flow (Fase 2, F3/F4). */
  | "automation_triggered"
  /** Se inscribio un contacto en una secuencia (Fase 2, F13/F15). */
  | "enroll"
  /** Al inscribir habia otra secuencia viva en el mismo canal (F13). */
  | "collision_detected"
  /** Un admin decidio que hacer con una colision (F13). */
  | "collision_resolved"
  /** Se frenaron secuencias del contacto (F11: respondio; o decision de un admin). */
  | "sequence_paused"
  /** Se reanudo una inscripcion pausada. */
  | "sequence_resumed";
/** Los 6 tipos de campo personalizado (CHECK de la migracion 00001). */
export type CustomFieldType = "text" | "number" | "boolean" | "date" | "url" | "email";
/** Temperatura del lead (migracion 00022). */
export type LeadTemperature = "cold" | "warm" | "hot";
/** Como termino un envio de email (migracion 00021). */
export type EmailLogStatus = "sent" | "failed" | "skipped_not_configured";
export type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "completed"
  | "cancelled";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type TriggerType =
  | "keyword"
  | "postback"
  | "quick_reply"
  | "welcome"
  | "default"
  | "comment_keyword"
  // Los tres que suma la Fase 2 (CHECK de la migracion 00038).
  | "new_contact"
  | "crm_event"
  | "inactivity";
export type FlowSessionStatus =
  | "active"
  | "completed"
  | "expired"
  | "cancelled";
export type NodeType =
  | "trigger"
  | "sendMessage"
  | "condition"
  | "delay"
  | "addTag"
  | "removeTag"
  | "setCustomField"
  | "httpRequest"
  | "goToFlow"
  | "subscribe"
  | "unsubscribe"
  | "humanTakeover"
  | "commentReply"
  | "privateReply"
  | "abSplit"
  | "smartDelay"
  | "aiResponse"
  | "enrollSequence";

export type SequenceStatus = "draft" | "active" | "paused";
/**
 * Estado de una inscripcion a una secuencia.
 *
 * "paused" es una frenada reversible; el motivo esta en paused_reason y decide
 * si se puede reanudar. La unica pausa que NO se reanuda sola ni a mano es la
 * de opt-out: volver a escribirle a alguien que pidio que no lo contacten es
 * una decision explicita de una persona, y se hace re-inscribiendolo.
 */
export type SequenceEnrollmentStatus = "active" | "paused" | "completed" | "cancelled";

/**
 * Por que quedo pausada una inscripcion (migracion 00042).
 *
 * Se guarda como texto libre en la base para que sumar un motivo no pida DDL,
 * pero estos son los que el sistema escribe hoy.
 */
export type SequencePauseReason =
  /** El lead respondio por ese canal (F11). */
  | "contact_replied"
  /** Pidio no ser contactado, o esta marcado como tal. */
  | "opt_out"
  /** Se pauso la secuencia entera. */
  | "sequence_paused"
  /** No hay conversacion abierta por donde escribirle. */
  | "no_conversation"
  /** Un admin la freno al resolver una colision (F13). */
  | "collision";

/** Como se resolvio una colision de secuencias (F13). */
export type SequenceCollisionResolution =
  | "kept_both"
  | "paused_other"
  | "removed_other"
  | "removed_this";

export interface SequenceStep {
  type: "message" | "delay" | "aiMessage";
  /** Texto del paso de mensaje. Admite {{variables}} del contacto. */
  content?: string;
  /** Espera del paso de delay, en minutos. */
  delayMinutes?: number;
  /**
   * Consigna para el modelo, en los pasos de IA (F10).
   *
   * A diferencia del nodo AI Response de un flow, aca no hay un mensaje
   * entrante al que contestar: hay una instruccion ("escribile recordandole
   * que la promo vence manana"). Admite {{variables}}.
   */
  prompt?: string;
  /** Proveedor de IA. Si falta, se usa el que este conectado. */
  provider?: string;
  /** Modelo. Si falta, el que tenga por defecto el proveedor. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Cuantos mensajes del hilo se le pasan al modelo como contexto. */
  contextMessages?: number;
}

export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          late_api_key_encrypted: string | null;
          webhook_secret: string | null;
          ai_api_key: string | null;
          ai_provider: string;
          global_keywords: Json | null;
          /** Frases que marcan "no contactar" al recibir un mensaje (migracion 00027). */
          opt_out_phrases: string[];
          lead_scope_enabled: boolean;
          unassigned_leads_visible_to_members: boolean;
          /**
           * Si se guardan localmente los entrantes de los canales de Zernio
           * (Instagram). Apagado, el receptor no inserta (migracion 00053).
           */
          persist_zernio_inbound: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          late_api_key_encrypted?: string | null;
          webhook_secret?: string | null;
          ai_api_key?: string | null;
          ai_provider?: string;
          global_keywords?: Json | null;
          opt_out_phrases?: string[];
          lead_scope_enabled?: boolean;
          unassigned_leads_visible_to_members?: boolean;
          persist_zernio_inbound?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          late_api_key_encrypted?: string | null;
          webhook_secret?: string | null;
          ai_api_key?: string | null;
          ai_provider?: string;
          global_keywords?: Json | null;
          opt_out_phrases?: string[];
          lead_scope_enabled?: boolean;
          unassigned_leads_visible_to_members?: boolean;
          persist_zernio_inbound?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channels: {
        Row: {
          id: string;
          workspace_id: string;
          platform: Platform;
          late_account_id: string;
          username: string | null;
          display_name: string | null;
          profile_picture: string | null;
          webhook_id: string | null;
          webhook_secret: string | null;
          is_active: boolean;
          last_comment_cursor: string | null;
          comment_rules: Json | null;
          provider: ChannelProvider;
          evolution_instance: string | null;
          connection_status: ChannelConnectionStatus;
          last_connected_at: string | null;
          last_error: string | null;
          disconnected_notified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          platform: Platform;
          late_account_id: string;
          username?: string | null;
          display_name?: string | null;
          profile_picture?: string | null;
          webhook_id?: string | null;
          webhook_secret?: string | null;
          is_active?: boolean;
          last_comment_cursor?: string | null;
          comment_rules?: Json | null;
          provider?: ChannelProvider;
          evolution_instance?: string | null;
          connection_status?: ChannelConnectionStatus;
          last_connected_at?: string | null;
          last_error?: string | null;
          disconnected_notified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          platform?: Platform;
          late_account_id?: string;
          username?: string | null;
          display_name?: string | null;
          profile_picture?: string | null;
          webhook_id?: string | null;
          webhook_secret?: string | null;
          is_active?: boolean;
          last_comment_cursor?: string | null;
          comment_rules?: Json | null;
          provider?: ChannelProvider;
          evolution_instance?: string | null;
          connection_status?: ChannelConnectionStatus;
          last_connected_at?: string | null;
          last_error?: string | null;
          disconnected_notified_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channels_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          id: string;
          workspace_id: string;
          display_name: string | null;
          email: string | null;
          avatar_url: string | null;
          is_subscribed: boolean;
          last_interaction_at: string | null;
          metadata: Json | null;
          // Datos de CRM (migracion 00022)
          phone: string | null;
          secondary_email: string | null;
          country: string | null;
          instagram_username: string | null;
          tiktok_username: string | null;
          youtube_channel_id: string | null;
          linkedin_profile_url: string | null;
          whatsapp_phone: string | null;
          twitter_username: string | null;
          facebook_id: string | null;
          setter_id: string | null;
          vendedor_id: string | null;
          next_followup_date: string | null;
          do_not_contact: boolean;
          do_not_contact_reason: string | null;
          do_not_contact_at: string | null;
          ai_conversation_summary: string | null;
          lead_temperature: LeadTemperature | null;
          attribution: Json;
          /** Notas internas del contacto, en un solo texto (migracion 00033). */
          notes: string | null;
          /**
           * La calcula la base (migracion 00032): true cuando no hay con que
           * reconocer a la persona. Solo lectura — PostgREST rechaza escribir
           * en una columna generada, por eso no esta en Insert ni en Update.
           */
          is_anonymous: boolean;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          display_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          is_subscribed?: boolean;
          last_interaction_at?: string | null;
          metadata?: Json | null;
          phone?: string | null;
          secondary_email?: string | null;
          country?: string | null;
          instagram_username?: string | null;
          tiktok_username?: string | null;
          youtube_channel_id?: string | null;
          linkedin_profile_url?: string | null;
          whatsapp_phone?: string | null;
          twitter_username?: string | null;
          facebook_id?: string | null;
          setter_id?: string | null;
          vendedor_id?: string | null;
          next_followup_date?: string | null;
          do_not_contact?: boolean;
          do_not_contact_reason?: string | null;
          do_not_contact_at?: string | null;
          ai_conversation_summary?: string | null;
          lead_temperature?: LeadTemperature | null;
          attribution?: Json;
          notes?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          is_subscribed?: boolean;
          last_interaction_at?: string | null;
          metadata?: Json | null;
          phone?: string | null;
          secondary_email?: string | null;
          country?: string | null;
          instagram_username?: string | null;
          tiktok_username?: string | null;
          youtube_channel_id?: string | null;
          linkedin_profile_url?: string | null;
          whatsapp_phone?: string | null;
          twitter_username?: string | null;
          facebook_id?: string | null;
          setter_id?: string | null;
          vendedor_id?: string | null;
          next_followup_date?: string | null;
          do_not_contact?: boolean;
          do_not_contact_reason?: string | null;
          do_not_contact_at?: string | null;
          ai_conversation_summary?: string | null;
          lead_temperature?: LeadTemperature | null;
          attribution?: Json;
          notes?: string | null;
          deleted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_channels: {
        Row: {
          id: string;
          contact_id: string;
          channel_id: string;
          platform_sender_id: string;
          platform_username: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          channel_id: string;
          platform_sender_id: string;
          platform_username?: string | null;
          created_at?: string;
        };
        Update: {
          /** Se reasigna al unir un contacto duplicado con el principal. */
          contact_id?: string;
          platform_username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contact_channels_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_channels_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          color?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_tags: {
        Row: {
          contact_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          contact_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: {
          /** Se reasigna al unir un contacto duplicado con el principal. */
          contact_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_field_definitions: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          slug: string;
          type: CustomFieldType;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          slug: string;
          type: CustomFieldType;
          created_at?: string;
        };
        Update: {
          // El slug no esta: se genera al crear y no cambia al renombrar,
          // porque los flows buscan los campos por slug.
          name?: string;
          type?: CustomFieldType;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_custom_fields: {
        Row: {
          contact_id: string;
          field_id: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          contact_id: string;
          field_id: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          value?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_custom_fields_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_custom_fields_field_id_fkey";
            columns: ["field_id"];
            isOneToOne: false;
            referencedRelation: "custom_field_definitions";
            referencedColumns: ["id"];
          },
        ];
      };
      flow_versions: {
        Row: {
          id: string;
          flow_id: string;
          version: number;
          nodes: Json;
          edges: Json;
          viewport: Json | null;
          name: string;
          published_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          flow_id: string;
          version: number;
          nodes: Json;
          edges: Json;
          viewport?: Json | null;
          name: string;
          published_by?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "flow_versions_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
        ];
      };
      flows: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: FlowStatus;
          nodes: Json;
          edges: Json;
          viewport: Json | null;
          version: number;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: FlowStatus;
          nodes?: Json;
          edges?: Json;
          viewport?: Json | null;
          version?: number;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: FlowStatus;
          nodes?: Json;
          edges?: Json;
          viewport?: Json | null;
          version?: number;
          published_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flows_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      triggers: {
        Row: {
          id: string;
          flow_id: string;
          channel_id: string | null;
          type: TriggerType;
          config: Json;
          priority: number;
          is_active: boolean;
          created_at: string;
          /** Desnormalizado desde flows (migracion 00038). Lo llena un trigger de la base. */
          workspace_id: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          flow_id: string;
          channel_id?: string | null;
          type: TriggerType;
          config?: Json;
          priority?: number;
          is_active?: boolean;
          created_at?: string;
          workspace_id?: string;
          updated_at?: string;
        };
        Update: {
          channel_id?: string | null;
          type?: TriggerType;
          config?: Json;
          priority?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "triggers_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "triggers_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      flow_sessions: {
        Row: {
          id: string;
          contact_id: string;
          flow_id: string;
          channel_id: string;
          status: FlowSessionStatus;
          current_node_id: string | null;
          variables: Json;
          flow_stack: Json;
          waiting_until: string | null;
          waiting_for_input: boolean;
          human_takeover_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          flow_id: string;
          channel_id: string;
          status?: FlowSessionStatus;
          current_node_id?: string | null;
          variables?: Json;
          flow_stack?: Json;
          waiting_until?: string | null;
          waiting_for_input?: boolean;
          human_takeover_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: FlowSessionStatus;
          current_node_id?: string | null;
          variables?: Json;
          flow_stack?: Json;
          waiting_until?: string | null;
          waiting_for_input?: boolean;
          human_takeover_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flow_sessions_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flow_sessions_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flow_sessions_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          contact_id: string;
          late_conversation_id: string | null;
          platform: Platform;
          status: ConversationStatus;
          assigned_to: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          unread_count: number;
          is_automation_paused: boolean;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          channel_id: string;
          contact_id: string;
          late_conversation_id?: string | null;
          platform: Platform;
          status?: ConversationStatus;
          assigned_to?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          unread_count?: number;
          is_automation_paused?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          /** Se reasigna al unir un contacto duplicado con el principal. */
          contact_id?: string;
          late_conversation_id?: string | null;
          status?: ConversationStatus;
          assigned_to?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          unread_count?: number;
          is_automation_paused?: boolean;
          deleted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          direction: MessageDirection;
          text: string | null;
          attachments: Json | null;
          quick_reply_payload: string | null;
          postback_payload: string | null;
          callback_data: string | null;
          platform_message_id: string | null;
          sent_by_flow_id: string | null;
          sent_by_node_id: string | null;
          sent_by_user_id: string | null;
          /** Que agente de IA lo mando. Sin FK hasta que exista `agents` (Bloque 2). */
          sent_by_agent_id: string | null;
          status: MessageStatus;
          created_at: string;
          /** Denormalizado desde conversations (migracion 00053). */
          workspace_id: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          direction: MessageDirection;
          text?: string | null;
          attachments?: Json | null;
          quick_reply_payload?: string | null;
          postback_payload?: string | null;
          callback_data?: string | null;
          platform_message_id?: string | null;
          sent_by_flow_id?: string | null;
          sent_by_node_id?: string | null;
          sent_by_user_id?: string | null;
          sent_by_agent_id?: string | null;
          status?: MessageStatus;
          created_at?: string;
          /**
           * Opcional a proposito: si no viene, lo completa el trigger
           * messages_fill_workspace_id desde la conversacion (migracion 00053).
           * Por eso los inserts que ya existian siguen compilando sin tocarlos.
           */
          workspace_id?: string;
        };
        Update: {
          status?: MessageStatus;
          platform_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcasts: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          status: BroadcastStatus;
          message_content: Json;
          segment_filter: Json | null;
          scheduled_for: string | null;
          total_recipients: number;
          sent: number;
          delivered: number;
          failed: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          status?: BroadcastStatus;
          message_content: Json;
          segment_filter?: Json | null;
          scheduled_for?: string | null;
          total_recipients?: number;
          sent?: number;
          delivered?: number;
          failed?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          status?: BroadcastStatus;
          message_content?: Json;
          segment_filter?: Json | null;
          scheduled_for?: string | null;
          total_recipients?: number;
          sent?: number;
          delivered?: number;
          failed?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcasts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_recipients: {
        Row: {
          id: string;
          broadcast_id: string;
          contact_id: string;
          channel_id: string;
          status: string;
          sent_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          broadcast_id: string;
          contact_id: string;
          channel_id: string;
          status?: string;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          status?: string;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_jobs: {
        Row: {
          id: string;
          type: string;
          payload: Json;
          run_at: string;
          status: JobStatus;
          attempts: number;
          last_error: string | null;
          claimed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          payload: Json;
          run_at: string;
          status?: JobStatus;
          attempts?: number;
          last_error?: string | null;
          claimed_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: JobStatus;
          attempts?: number;
          last_error?: string | null;
          claimed_at?: string | null;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          workspace_id: string;
          flow_id: string | null;
          contact_id: string | null;
          event_type: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          flow_id?: string | null;
          contact_id?: string | null;
          event_type: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          workspace_id?: string;
          flow_id?: string | null;
          contact_id?: string | null;
          event_type?: string;
          metadata?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invites: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: string;
          invited_by: string;
          status: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: string;
          invited_by: string;
          status?: string;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          email?: string;
          role?: string;
          status?: string;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      comment_logs: {
        Row: {
          id: string;
          channel_id: string;
          workspace_id: string;
          post_id: string | null;
          platform_comment_id: string;
          author_id: string | null;
          author_name: string | null;
          author_username: string | null;
          comment_text: string;
          matched_trigger_id: string | null;
          dm_sent: boolean;
          reply_sent: boolean;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          workspace_id: string;
          post_id?: string | null;
          platform_comment_id: string;
          author_id?: string | null;
          author_name?: string | null;
          author_username?: string | null;
          comment_text: string;
          matched_trigger_id?: string | null;
          dm_sent?: boolean;
          reply_sent?: boolean;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          matched_trigger_id?: string | null;
          dm_sent?: boolean;
          reply_sent?: boolean;
          error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "comment_logs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_logs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_logs_matched_trigger_id_fkey";
            columns: ["matched_trigger_id"];
            isOneToOne: false;
            referencedRelation: "triggers";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Cola de cambios del CRM que pueden disparar un flow (migracion 00039). */
      automation_events: {
        Row: {
          id: string;
          workspace_id: string;
          event_type: string;
          contact_id: string;
          payload: Json;
          created_at: string;
          processed_at: string | null;
          error: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          event_type: string;
          contact_id: string;
          payload?: Json;
          created_at?: string;
          processed_at?: string | null;
          error?: string | null;
        };
        Update: {
          payload?: Json;
          processed_at?: string | null;
          error?: string | null;
        };
        Relationships: [];
      };
      /** Un disparo ya ocurrido, para no repetirlo (migracion 00038). */
      trigger_fires: {
        Row: {
          id: string;
          trigger_id: string;
          workspace_id: string;
          dedupe_key: string;
          contact_id: string | null;
          fired_at: string;
        };
        Insert: {
          id?: string;
          trigger_id: string;
          workspace_id: string;
          dedupe_key: string;
          contact_id?: string | null;
          fired_at?: string;
        };
        Update: {
          dedupe_key?: string;
        };
        Relationships: [];
      };
      /** Contador de envios automatizados por canal y por hora (migracion 00037). */
      channel_send_windows: {
        Row: {
          channel_id: string;
          window_start: string;
          sent_count: number;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          window_start: string;
          sent_count?: number;
          updated_at?: string;
        };
        Update: {
          sent_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          event_id: string;
          received_at: string;
        };
        Insert: {
          event_id: string;
          received_at?: string;
        };
        Update: {
          received_at?: string;
        };
        Relationships: [];
      };
      sequences: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: SequenceStatus;
          steps: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: SequenceStatus;
          steps?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: SequenceStatus;
          steps?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sequences_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sequence_enrollments: {
        Row: {
          id: string;
          sequence_id: string;
          contact_id: string;
          channel_id: string;
          current_step_index: number;
          status: SequenceEnrollmentStatus;
          enrolled_at: string;
          next_step_at: string | null;
          completed_at: string | null;
          /** Migracion 00042: estado de corrida. */
          paused_reason: string | null;
          paused_at: string | null;
          attempt_count: number;
          last_error: string | null;
          last_error_at: string | null;
          locked_at: string | null;
          /** Migracion 00043: colision (F13). */
          collision_detected_at: string | null;
          collision_with: Json | null;
          collision_reviewed_at: string | null;
          collision_reviewed_by: string | null;
          collision_resolution: SequenceCollisionResolution | null;
        };
        Insert: {
          id?: string;
          sequence_id: string;
          contact_id: string;
          channel_id: string;
          current_step_index?: number;
          status?: SequenceEnrollmentStatus;
          enrolled_at?: string;
          next_step_at?: string | null;
          completed_at?: string | null;
          paused_reason?: string | null;
          paused_at?: string | null;
          attempt_count?: number;
          last_error?: string | null;
          last_error_at?: string | null;
          locked_at?: string | null;
          collision_detected_at?: string | null;
          collision_with?: Json | null;
          collision_reviewed_at?: string | null;
          collision_reviewed_by?: string | null;
          collision_resolution?: SequenceCollisionResolution | null;
        };
        Update: {
          current_step_index?: number;
          status?: SequenceEnrollmentStatus;
          next_step_at?: string | null;
          completed_at?: string | null;
          paused_reason?: string | null;
          paused_at?: string | null;
          attempt_count?: number;
          last_error?: string | null;
          last_error_at?: string | null;
          locked_at?: string | null;
          collision_detected_at?: string | null;
          collision_with?: Json | null;
          collision_reviewed_at?: string | null;
          collision_reviewed_by?: string | null;
          collision_resolution?: SequenceCollisionResolution | null;
        };
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "sequences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_enrollments_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_enrollments_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_configs: {
        Row: {
          id: string;
          workspace_id: string;
          type: IntegrationType;
          provider: string;
          display_name: string | null;
          vault_secret_name: string | null;
          oauth_data: Json | null;
          config: Json;
          is_active: boolean;
          connected_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          type: IntegrationType;
          provider: string;
          display_name?: string | null;
          vault_secret_name?: string | null;
          oauth_data?: Json | null;
          config?: Json;
          is_active?: boolean;
          connected_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          vault_secret_name?: string | null;
          oauth_data?: Json | null;
          config?: Json;
          is_active?: boolean;
          connected_at?: string | null;
          last_error?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integration_configs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      email_log: {
        Row: {
          id: string;
          workspace_id: string;
          to_email: string;
          subject: string;
          kind: string;
          status: EmailLogStatus;
          provider_message_id: string | null;
          attempts: number;
          last_error: string | null;
          related_entity_type: string | null;
          related_entity_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          to_email: string;
          subject: string;
          kind: string;
          status: EmailLogStatus;
          provider_message_id?: string | null;
          attempts?: number;
          last_error?: string | null;
          related_entity_type?: string | null;
          related_entity_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          status?: EmailLogStatus;
          provider_message_id?: string | null;
          attempts?: number;
          last_error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "email_log_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_notes: {
        Row: {
          id: string;
          contact_id: string;
          workspace_id: string;
          content: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          contact_id: string;
          workspace_id: string;
          content: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          /** Se reasigna al unir un contacto duplicado con el principal. */
          contact_id?: string;
          content?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contact_notes_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_notes_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          workspace_id: string;
          entity_type: AuditEntityType;
          entity_id: string;
          action: AuditAction;
          changes: Json | null;
          metadata: Json | null;
          performed_by: string | null;
          performed_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          entity_type: AuditEntityType;
          entity_id: string;
          action: AuditAction;
          changes?: Json | null;
          metadata?: Json | null;
          performed_by?: string | null;
          performed_at?: string;
        };
        // Inmutable: no hay UPDATE ni DELETE en la RLS.
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "audit_log_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      csv_imports: {
        Row: {
          id: string;
          workspace_id: string;
          file_name: string;
          total_rows: number;
          imported: number;
          updated: number;
          errors: number;
          error_details: Json;
          imported_by: string | null;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          file_name: string;
          total_rows?: number;
          imported?: number;
          updated?: number;
          errors?: number;
          error_details?: Json;
          imported_by?: string | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          total_rows?: number;
          imported?: number;
          updated?: number;
          errors?: number;
          error_details?: Json;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "csv_imports_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      response_templates: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          content: string;
          shortcut: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          content: string;
          shortcut?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          content?: string;
          shortcut?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "response_templates_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Centro de notificaciones in-app (migracion 00051). */
      notifications: {
        Row: {
          id: string;
          workspace_id: string;
          type: string;
          title: string;
          body: string | null;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Json;
          recipient_id: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          type: string;
          title: string;
          body?: string | null;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json;
          recipient_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      /** Documentos de la base de conocimiento (migracion 00049). */
      knowledge_base: {
        Row: {
          id: string;
          workspace_id: string;
          title: string;
          tags: string[];
          source_file_path: string | null;
          source_mime: string | null;
          source_size_bytes: number | null;
          source_filename: string | null;
          content_md: string | null;
          status: KnowledgeStatus;
          error_detail: string | null;
          chunk_count: number;
          embedding_model: string | null;
          indexed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          title: string;
          tags?: string[];
          source_file_path?: string | null;
          source_mime?: string | null;
          source_size_bytes?: number | null;
          source_filename?: string | null;
          content_md?: string | null;
          status?: KnowledgeStatus;
          error_detail?: string | null;
          chunk_count?: number;
          embedding_model?: string | null;
          indexed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          title?: string;
          tags?: string[];
          source_file_path?: string | null;
          source_mime?: string | null;
          source_size_bytes?: number | null;
          source_filename?: string | null;
          content_md?: string | null;
          status?: KnowledgeStatus;
          error_detail?: string | null;
          chunk_count?: number;
          embedding_model?: string | null;
          indexed_at?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_base_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * Fragmentos indexados (migracion 00049).
       *
       * `embedding` se escribe como el literal que espera pgvector
       * ("[0.1,0.2,...]", ver toPgVector) y se lee como string: el tipo vector
       * no tiene representacion propia en JS.
       */
      knowledge_chunks: {
        Row: {
          id: string;
          workspace_id: string;
          document_id: string;
          chunk_index: number;
          content: string;
          token_estimate: number | null;
          embedding: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          document_id: string;
          chunk_index: number;
          content: string;
          token_estimate?: number | null;
          embedding: string;
          created_at?: string;
        };
        Update: {
          content?: string;
          token_estimate?: number | null;
          embedding?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_base";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_chunks_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      /** Deduplicacion cross-canal (migracion 00025). Unica fuente de verdad. */
      find_or_link_contact: {
        Args: {
          p_channel_id: string;
          p_sender_id: string;
          p_display_name?: string | null;
          p_username?: string | null;
          p_avatar_url?: string | null;
          p_phone?: string | null;
          p_email?: string | null;
          p_interaction_at?: string;
          p_stamp_existing?: boolean;
        };
        Returns: {
          contact_id: string | null;
          existed: boolean;
          linked_by: ContactLinkReason | null;
          suggested_contact_id: string | null;
        };
      };
      /**
       * Marca de "no contactar" automatica (migracion 00027). Solo service_role:
       * la llaman los dos receptores de webhooks. Idempotente.
       */
      apply_opt_out_check: {
        Args: {
          p_contact_id: string;
          p_conversation_id?: string | null;
          p_text?: string | null;
        };
        Returns: {
          matched: boolean;
          phrase?: string | null;
          already: boolean;
          sequences_paused: number;
        };
      };
      /** true si el mensaje contiene la frase como palabras completas (migracion 00027). */
      text_matches_phrase: {
        Args: {
          p_text: string | null;
          p_phrase: string | null;
        };
        Returns: boolean;
      };
      /**
       * Reclama un envio automatizado en la ventana horaria del canal
       * (migracion 00037). Devuelve false cuando se llego al tope de la hora.
       * Solo service_role.
       */
      claim_automated_send: {
        Args: {
          p_channel_id: string;
          p_limit?: number;
        };
        Returns: boolean;
      };
      /**
       * Reclama las inscripciones vencidas para una corrida del cron
       * (migracion 00042). El claim es lo que evita que dos corridas
       * solapadas manden el mismo mensaje dos veces. Solo service_role.
       */
      claim_sequence_enrollments: {
        Args: {
          p_limit?: number;
          p_stale_after?: string;
        };
        Returns: Database["public"]["Tables"]["sequence_enrollments"]["Row"][];
      };
      /**
       * Pausa las secuencias activas del contacto en ese canal cuando responde
       * (migracion 00044, F11). Devuelve cuantas freno. Solo service_role.
       */
      pause_sequences_on_reply: {
        Args: {
          p_contact_id: string;
          p_channel_id: string;
        };
        Returns: number;
      };
      /** Borra las ventanas de envio viejas (migracion 00037). Solo service_role. */
      purge_send_windows: {
        Args: {
          p_retention_days?: number;
        };
        Returns: number;
      };
      /** Purga de los borrados logicos (migracion 00025). Solo service_role. */
      purge_soft_deleted: {
        Args: {
          p_retention_days?: number;
        };
        Returns: {
          cutoff: string;
          contacts: number;
          conversations: number;
          contact_notes: number;
          response_templates: number;
        };
      };
      increment_unread: {
        Args: {
          conv_id: string;
          preview: string;
        };
        Returns: undefined;
      };
      increment_broadcast_sent: {
        Args: {
          b_id: string;
        };
        Returns: undefined;
      };
      increment_broadcast_failed: {
        Args: {
          b_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

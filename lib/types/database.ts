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
/** Origen de un saliente (migracion 00074). null en entrantes. */
export type MessageOrigin =
  | "agent"
  | "user"
  | "flow"
  | "sequence"
  | "broadcast"
  | "external";
/** De donde sale la conexion del canal (migracion 00019). */
export type ChannelProvider = "zernio" | "evolution";
export type ChannelConnectionStatus =
  | "connected"
  | "disconnected"
  | "connecting"
  | "error"
  | "unknown";
/** Clase de integracion en integration_configs (migracion 00020). */
export type IntegrationType =
  | "channel"
  | "ai_provider"
  | "email_provider"
  // Etapa 2 (migracion 00081). El CHECK de la tabla acepta los siete.
  | "social_network"
  | "publishing_service"
  | "google"
  | "meta";

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
  | "sequence_enrollment"
  /** Configuracion de un agente de IA (Fase 3). */
  | "agent"
  /** Una etiqueta del workspace: su efecto sobre el agente (Bloque 2d-A). */
  | "tag"
  /** Patrones de mensajes (Bloque 4): categorías y textos. */
  | "message_category"
  | "message_text";
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
  | "sequence_resumed"
  /** La conversacion paso a una persona (agente o nodo Human Takeover). */
  | "human_takeover"
  /** Se encendio o apago el agente en una conversacion. */
  | "agent_toggled"
  /** Un flow pauso o reanudo el agente en una conversacion. */
  | "agent_paused"
  | "agent_resumed"
  /** Se guardo o se restauro una version del system prompt. */
  | "prompt_version"
  /** El agente etiqueto un contacto (Fase 3, Bloque 2b). changes.tags {old,new}. */
  | "tag"
  /** El agente cambio la temperatura del lead. */
  | "temperature"
  /** El agente programo el proximo seguimiento. */
  | "followup"
  /** El agente guardo el resumen acumulativo del contacto. */
  | "summary"
  /** Una persona revirtio una accion del agente. metadata.reverted_audit_id. */
  | "revert"
  /**
   * Una etiqueta con efecto apago el agente y/o asigno el contacto, o se
   * libero al sacarla (Bloque 2d-A, 00073). Lo escriben los triggers.
   */
  | "tag_effect";
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

/** Que origino una llamada a IA (migracion 00059). */
export type AgentRunSource =
  | "agent"
  | "flow_ai_node"
  | "sequence_ai_step"
  | "kb_indexing"
  | "conversation_summary"
  /** Corridas del clasificador de patrones y su evaluacion (00076, Bloques 4-5). */
  | "message_classification"
  | "message_classification_eval";
export type AgentRunTrigger =
  | "inbound_message"
  | "cron_close"
  | "manual"
  | "flow_node"
  | "sequence_step"
  | "job";
/**
 * Resultado de un run. `running` = abierto (el run se crea antes de llamar al
 * proveedor); `completed` = fuentes que no "responden" (indexacion).
 */
export type AgentRunStatus =
  | "running"
  | "responded"
  | "escalated"
  | "skipped_automation"
  /** No actuo por una palanca: apagado, canal, conversacion, pausa (migracion 00065). */
  | "skipped"
  | "blocked_guardrail"
  | "completed"
  | "error"
  /** El turno dejo un borrador en vez de enviar (modo borrador, migracion 00070). */
  | "drafted"
  /** El turno se retiro porque ya hubo una respuesta (verificacion, 00076/00077). */
  | "already_answered";
/** Estado de un borrador del agente (migracion 00070). */
export type AgentDraftStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "discarded"
  | "superseded"
  | "regenerated";
/** Modo de entrega del agente en un canal (agents.channel_modes, migracion 00070). */
/** Modo de entrega del agente en un canal: envía directo, deja borrador, o decide por reglas (F9). */
export type AgentChannelMode = "send" | "draft" | "rules";
/** Acción por defecto de las reglas de respuesta (agents.response_rules_default, 00077). */
export type ResponseRuleAction = "send" | "draft" | "skip";
export type AgentRunStepKind = "model_call" | "kb_search" | "tool_call" | "guardrail";
export type KnowledgeFallback = "escalate" | "general";
export type CostLimitAction = "notify" | "disable";
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
  | "enrollSequence"
  /** Pausar / reanudar el agente de IA en la conversacion (Fase 3). */
  | "pauseAgent"
  | "resumeAgent";

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
      message_categories: {
        Row: {
          id: string;
          workspace_id: string;
          direction: "inbound" | "outbound";
          name: string;
          description: string | null;
          examples: string[];
          is_fallback: boolean;
          created_by: "model" | "user" | "system";
          created_by_user_id: string | null;
          merged_into_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          direction: "inbound" | "outbound";
          name: string;
          description?: string | null;
          examples?: string[];
          is_fallback?: boolean;
          created_by: "model" | "user" | "system";
          created_by_user_id?: string | null;
          merged_into_id?: string | null;
          archived_at?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
          examples?: string[];
          merged_into_id?: string | null;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      message_texts: {
        Row: {
          id: string;
          workspace_id: string;
          direction: "inbound" | "outbound";
          normalized_text: string;
          sample_text: string;
          category_id: string | null;
          confidence: number | null;
          source: "rule" | "model" | "human" | null;
          prompt_version: number | null;
          run_id: string | null;
          is_button: boolean;
          classified_at: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          review_result: "ok" | "corrected" | null;
          first_seen_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          direction: "inbound" | "outbound";
          normalized_text: string;
          sample_text: string;
          category_id?: string | null;
          confidence?: number | null;
          source?: "rule" | "model" | "human" | null;
          prompt_version?: number | null;
          run_id?: string | null;
          is_button?: boolean;
          classified_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_result?: "ok" | "corrected" | null;
          first_seen_at?: string;
        };
        Update: {
          category_id?: string | null;
          confidence?: number | null;
          source?: "rule" | "model" | "human" | null;
          prompt_version?: number | null;
          run_id?: string | null;
          is_button?: boolean;
          classified_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_result?: "ok" | "corrected" | null;
          updated_at?: string;
        };
        Relationships: [];
      };
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
          /** Zona horaria IANA del negocio (migracion 00075). */
          timezone: string;
          ai_background_settings: Json;
          /** Topes globales de gasto de IA del workspace. NULL = sin tope (migracion 00058). */
          ai_daily_cost_limit_usd: number | null;
          ai_monthly_cost_limit_usd: number | null;
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
          timezone?: string;
          ai_background_settings?: Json;
          ai_daily_cost_limit_usd?: number | null;
          ai_monthly_cost_limit_usd?: number | null;
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
          timezone?: string;
          ai_background_settings?: Json;
          ai_daily_cost_limit_usd?: number | null;
          ai_monthly_cost_limit_usd?: number | null;
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
          /** Ventana de mensajeria en horas; NULL = default por plataforma (00070). */
          messaging_window_hours: number | null;
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
          messaging_window_hours?: number | null;
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
          messaging_window_hours?: number | null;
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
          /** Cuando se actualizo la memoria del agente (00070). */
          ai_summary_updated_at: string | null;
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
          ai_summary_updated_at?: string | null;
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
          ai_summary_updated_at?: string | null;
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
          /** Etiqueta con efecto (00073): apaga el agente en las conversaciones del contacto. */
          disables_agent: boolean;
          /** Etiqueta con efecto (00073): al ponerla, setter y vendedor pasan a esta persona. */
          assigns_to: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          color?: string | null;
          disables_agent?: boolean;
          assigns_to?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          color?: string | null;
          /** Solo Owner/Admin (policies de tags, 00073). */
          disables_agent?: boolean;
          assigns_to?: string | null;
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
          /**
           * Agente de IA en esta conversacion, tres estados (migracion 00066).
           * null = hereda del canal; true = forzado prendido; false = forzado apagado.
           */
          agent_enabled: boolean | null;
          /** Pausa temporal puesta por un flow. NULL = sin pausa; "infinity" = hasta reanudar. */
          agent_paused_until: string | null;
          /** El agente fallo aca y el lead puede estar sin respuesta (migracion 00059). */
          last_agent_error_at: string | null;
          last_agent_error_run_id: string | null;
          /** Cierre y resumen (migracion 00067). */
          closed_at: string | null;
          summarized_at: string | null;
          /**
           * La etiqueta que apago el agente aca (00073). La escriben y la limpian
           * solo los triggers: nunca se actualiza desde la app.
           */
          agent_disabled_by_tag_id: string | null;
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
          agent_enabled?: boolean | null;
          agent_paused_until?: string | null;
          last_agent_error_at?: string | null;
          last_agent_error_run_id?: string | null;
          closed_at?: string | null;
          summarized_at?: string | null;
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
          agent_enabled?: boolean | null;
          agent_paused_until?: string | null;
          last_agent_error_at?: string | null;
          last_agent_error_run_id?: string | null;
          closed_at?: string | null;
          summarized_at?: string | null;
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
          /** Id de Zernio (o de Evolution). Es el que deduplica: ver migracion 00019. */
          platform_message_id: string | null;
          /** Id nativo de la plataforma (Meta). Solo lo trae el webhook en vivo (migracion 00056). */
          platform_native_message_id: string | null;
          sent_by_flow_id: string | null;
          sent_by_node_id: string | null;
          sent_by_user_id: string | null;
          /** Que agente de IA lo mando. FK a agents desde la migracion 00058. */
          sent_by_agent_id: string | null;
          /** Run del agente que genero este mensaje (migracion 00059). */
          agent_run_id: string | null;
          /** De donde salio el saliente (migracion 00074). null en entrantes. */
          origin: MessageOrigin | null;
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
          platform_native_message_id?: string | null;
          sent_by_flow_id?: string | null;
          sent_by_node_id?: string | null;
          sent_by_user_id?: string | null;
          sent_by_agent_id?: string | null;
          agent_run_id?: string | null;
          /** Requerido en salientes despues del backfill; null en entrantes. El trigger lo deriva si falta. */
          origin?: MessageOrigin | null;
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
          /** Clave de un job reprogramable; unica entre los pending (migracion 00061). */
          dedupe_key: string | null;
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
          dedupe_key?: string | null;
          created_at?: string;
        };
        Update: {
          status?: JobStatus;
          attempts?: number;
          last_error?: string | null;
          claimed_at?: string | null;
          run_at?: string;
          payload?: Json;
          dedupe_key?: string | null;
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
          /** Agente que ejecuto la accion (migracion 00058). */
          performed_by_agent_id: string | null;
          performed_at: string;
          /** Marca de reversion desde la pestana Acciones (migracion 00068). */
          reverted_at: string | null;
          reverted_by_audit_id: string | null;
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
          performed_by_agent_id?: string | null;
          performed_at?: string;
          reverted_at?: string | null;
          reverted_by_audit_id?: string | null;
        };
        // Inmutable para los usuarios (sin UPDATE ni DELETE en la RLS). Solo el
        // service role marca la reversion.
        Update: {
          reverted_at?: string | null;
          reverted_by_audit_id?: string | null;
        };
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
          /** Uso interno: nunca llega al prompt de un agente (migracion 00058). */
          internal_only: boolean;
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
          internal_only?: boolean;
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
          internal_only?: boolean;
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

      /**
       * Agentes de IA (migracion 00058). Las columnas de topes de gasto no las
       * puede leer el cliente de un usuario (privilegio de columna, 00060): se
       * leen con service role detras de requireWorkspaceAdmin().
       */
      agents: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          type: string;
          is_enabled: boolean;
          system_prompt: string | null;
          active_prompt_version: number | null;
          provider: string | null;
          model: string | null;
          fallback_provider: string | null;
          fallback_model: string | null;
          temperature: number | null;
          max_output_tokens: number | null;
          model_timeout_seconds: number;
          bundle_window_seconds: number;
          response_delay_seconds: number;
          max_wait_seconds: number | null;
          /** NULL = sin tope (default desde la 00070). */
          max_replies_per_conversation: number | null;
          /** La rafaga ignora entrantes mas viejos que esto, en horas (migracion 00066). */
          burst_max_age_hours: number;
          /** Cierre por inactividad, resumen y clasificacion al cierre (migracion 00067). */
          close_after_inactive_hours: number;
          summary_on_close: boolean;
          classify_on_close: boolean;
          output_format: Json;
          allowed_tools: string[];
          tools_config: Json;
          guardrails: Json;
          knowledge_enabled: boolean;
          knowledge_tags: string[];
          knowledge_fallback: KnowledgeFallback;
          daily_cost_limit_usd: number | null;
          daily_cost_limit_action: CostLimitAction;
          monthly_cost_limit_usd: number | null;
          monthly_cost_limit_action: CostLimitAction;
          enabled_channel_ids: string[];
          /** { channel_id: "send" | "draft" | "rules" }; sin entrada = send (00070/00077). */
          channel_modes: Json;
          /** Reglas de respuesta condición→acción (00077). */
          response_rules: Json;
          response_rules_default: ResponseRuleAction;
          /** Espera tras un saliente externo, en minutos (00077, F7). */
          external_reply_cooldown_minutes: number;
          config: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          type?: string;
          is_enabled?: boolean;
          system_prompt?: string | null;
          active_prompt_version?: number | null;
          provider?: string | null;
          model?: string | null;
          fallback_provider?: string | null;
          fallback_model?: string | null;
          temperature?: number | null;
          max_output_tokens?: number | null;
          model_timeout_seconds?: number;
          bundle_window_seconds?: number;
          response_delay_seconds?: number;
          max_wait_seconds?: number | null;
          max_replies_per_conversation?: number | null;
          burst_max_age_hours?: number;
          close_after_inactive_hours?: number;
          summary_on_close?: boolean;
          classify_on_close?: boolean;
          output_format?: Json;
          allowed_tools?: string[];
          tools_config?: Json;
          guardrails?: Json;
          knowledge_enabled?: boolean;
          knowledge_tags?: string[];
          knowledge_fallback?: KnowledgeFallback;
          daily_cost_limit_usd?: number | null;
          daily_cost_limit_action?: CostLimitAction;
          monthly_cost_limit_usd?: number | null;
          monthly_cost_limit_action?: CostLimitAction;
          enabled_channel_ids?: string[];
          channel_modes?: Json;
          response_rules?: Json;
          response_rules_default?: ResponseRuleAction;
          external_reply_cooldown_minutes?: number;
          config?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          type?: string;
          is_enabled?: boolean;
          system_prompt?: string | null;
          active_prompt_version?: number | null;
          provider?: string | null;
          model?: string | null;
          fallback_provider?: string | null;
          fallback_model?: string | null;
          temperature?: number | null;
          max_output_tokens?: number | null;
          model_timeout_seconds?: number;
          bundle_window_seconds?: number;
          response_delay_seconds?: number;
          max_wait_seconds?: number | null;
          max_replies_per_conversation?: number | null;
          burst_max_age_hours?: number;
          close_after_inactive_hours?: number;
          summary_on_close?: boolean;
          classify_on_close?: boolean;
          output_format?: Json;
          allowed_tools?: string[];
          tools_config?: Json;
          guardrails?: Json;
          knowledge_enabled?: boolean;
          knowledge_tags?: string[];
          knowledge_fallback?: KnowledgeFallback;
          daily_cost_limit_usd?: number | null;
          daily_cost_limit_action?: CostLimitAction;
          monthly_cost_limit_usd?: number | null;
          monthly_cost_limit_action?: CostLimitAction;
          enabled_channel_ids?: string[];
          channel_modes?: Json;
          response_rules?: Json;
          response_rules_default?: ResponseRuleAction;
          external_reply_cooldown_minutes?: number;
          config?: Json;
          created_by?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      /** Historial inmutable del system prompt (migracion 00058). */
      agent_prompt_versions: {
        Row: {
          id: string;
          workspace_id: string;
          agent_id: string;
          version: number;
          system_prompt: string;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          agent_id: string;
          version: number;
          system_prompt: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        // Inmutable: sin UPDATE en la RLS.
        Update: Record<string, never>;
        Relationships: [];
      };
      /**
       * Una fila por llamada a IA del sistema (migracion 00059). Solo la escribe
       * el service role. Tokens y costo: solo legibles por service role (00060);
       * el cliente de usuario tiene que listar AGENT_RUN_PUBLIC_COLUMNS.
       */
      agent_runs: {
        Row: {
          id: string;
          workspace_id: string;
          source: AgentRunSource;
          agent_id: string | null;
          prompt_version: number | null;
          conversation_id: string | null;
          thread_id: string | null;
          contact_id: string | null;
          channel_id: string | null;
          trigger: AgentRunTrigger;
          status: AgentRunStatus;
          status_detail: string | null;
          /** Que decidio el turno (00077, F9/F12). */
          routing: Json | null;
          intent: Json | null;
          provider: string | null;
          model: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          cached_tokens: number | null;
          embedding_tokens: number | null;
          cost_usd: number | null;
          pricing_id: string | null;
          latency_ms: number | null;
          step_count: number;
          error: string | null;
          created_at: string;
          completed_at: string | null;
          /** Ultimo entrante de la rafaga que responde el turno (00070). */
          inbound_at: string | null;
          /** Cuando salio la respuesta de verdad (00070). */
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          source: AgentRunSource;
          agent_id?: string | null;
          prompt_version?: number | null;
          conversation_id?: string | null;
          thread_id?: string | null;
          contact_id?: string | null;
          channel_id?: string | null;
          trigger: AgentRunTrigger;
          status?: AgentRunStatus;
          routing?: Json | null;
          intent?: Json | null;
          status_detail?: string | null;
          provider?: string | null;
          model?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          cached_tokens?: number | null;
          embedding_tokens?: number | null;
          cost_usd?: number | null;
          pricing_id?: string | null;
          latency_ms?: number | null;
          step_count?: number;
          error?: string | null;
          created_at?: string;
          completed_at?: string | null;
          inbound_at?: string | null;
          responded_at?: string | null;
        };
        Update: {
          prompt_version?: number | null;
          conversation_id?: string | null;
          thread_id?: string | null;
          contact_id?: string | null;
          channel_id?: string | null;
          status?: AgentRunStatus;
          routing?: Json | null;
          intent?: Json | null;
          status_detail?: string | null;
          provider?: string | null;
          model?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          cached_tokens?: number | null;
          embedding_tokens?: number | null;
          cost_usd?: number | null;
          pricing_id?: string | null;
          latency_ms?: number | null;
          step_count?: number;
          error?: string | null;
          completed_at?: string | null;
          inbound_at?: string | null;
          responded_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * Respuestas del agente que esperan aprobacion (modo borrador, 00070).
       * Solo el service role inserta. El usuario puede tomar (sending),
       * descartar o pedir otra version, siempre a su nombre (RLS).
       */
      agent_drafts: {
        Row: {
          id: string;
          workspace_id: string;
          agent_id: string | null;
          conversation_id: string;
          contact_id: string;
          channel_id: string;
          run_id: string | null;
          status: AgentDraftStatus;
          body: string | null;
          body_parts: Json | null;
          no_reply_reason: string | null;
          suggested_actions: Json;
          applied_actions: Json;
          burst_message_ids: string[];
          burst_started_at: string | null;
          burst_last_inbound_at: string | null;
          sendable_until: string | null;
          alerted_thresholds: number[];
          window_missed_at: string | null;
          missed_while_assigned_to: string | null;
          sent_body: string | null;
          send_error: string | null;
          sent_message_id: string | null;
          discard_reason: string | null;
          regenerate_instruction: string | null;
          previous_draft_id: string | null;
          decided_at: string | null;
          decided_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          agent_id?: string | null;
          conversation_id: string;
          contact_id: string;
          channel_id: string;
          run_id?: string | null;
          status?: AgentDraftStatus;
          body?: string | null;
          body_parts?: Json | null;
          no_reply_reason?: string | null;
          suggested_actions?: Json;
          applied_actions?: Json;
          burst_message_ids?: string[];
          burst_started_at?: string | null;
          burst_last_inbound_at?: string | null;
          sendable_until?: string | null;
          alerted_thresholds?: number[];
          window_missed_at?: string | null;
          missed_while_assigned_to?: string | null;
          sent_body?: string | null;
          send_error?: string | null;
          sent_message_id?: string | null;
          discard_reason?: string | null;
          regenerate_instruction?: string | null;
          previous_draft_id?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: AgentDraftStatus;
          sendable_until?: string | null;
          alerted_thresholds?: number[];
          window_missed_at?: string | null;
          missed_while_assigned_to?: string | null;
          sent_body?: string | null;
          send_error?: string | null;
          sent_message_id?: string | null;
          discard_reason?: string | null;
          regenerate_instruction?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      agent_run_steps: {
        Row: {
          id: string;
          workspace_id: string;
          run_id: string;
          step_index: number;
          kind: AgentRunStepKind;
          name: string | null;
          input: Json | null;
          output: Json | null;
          kb_chunk_ids: string[] | null;
          audit_log_id: string | null;
          duration_ms: number | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          run_id: string;
          step_index: number;
          kind: AgentRunStepKind;
          name?: string | null;
          input?: Json | null;
          output?: Json | null;
          kb_chunk_ids?: string[] | null;
          audit_log_id?: string | null;
          duration_ms?: number | null;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          input?: Json | null;
          output?: Json | null;
        };
        Relationships: [];
      };
      /** Precios por millon de tokens con vigencia (migracion 00059). */
      model_pricing: {
        Row: {
          id: string;
          workspace_id: string;
          provider: string;
          model: string;
          input_per_mtok: number;
          output_per_mtok: number;
          cached_input_per_mtok: number;
          currency: string;
          valid_from: string;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          provider: string;
          model: string;
          input_per_mtok: number;
          output_per_mtok: number;
          cached_input_per_mtok: number;
          currency?: string;
          valid_from?: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          provider?: string;
          model?: string;
          input_per_mtok?: number;
          output_per_mtok?: number;
          cached_input_per_mtok?: number;
          currency?: string;
          valid_from?: string;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
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
       * Momento 2 de la verificación (migración 00077): bajo advisory lock por
       * conversación, true si ya hubo un saliente posterior al inbound del turno
       * que no es el propio run. Solo service_role.
       */
      claim_agent_reply: {
        Args: {
          p_conversation_id: string;
          p_inbound_at: string;
          p_run_id: string | null;
        };
        Returns: boolean;
      };
      /** Normaliza un texto para agrupar mensajes (migración 00076). */
      normalize_for_grouping: {
        Args: { p_raw: string | null };
        Returns: string;
      };
      /** Funciones de métricas del dashboard de Chat (migración 00078, F15). */
      chat_dashboard_numbers: {
        Args: { p_workspace_id: string; p_from: string | null; p_to: string | null; p_channel?: string | null; p_author?: string | null };
        Returns: { new_conversations: number; messages_in: number; messages_out: number; first_response_median_seconds: number | null }[];
      };
      chat_waiting_now: {
        Args: { p_workspace_id: string; p_channel?: string | null };
        Returns: number;
      };
      chat_dashboard_agent: {
        Args: { p_workspace_id: string; p_from: string | null; p_to: string | null; p_channel?: string | null };
        Returns: { new_conversations: number; agent_acted: number; agent_took_first: number; agent_escalated: number }[];
      };
      chat_dashboard_team: {
        Args: { p_workspace_id: string; p_from: string | null; p_to: string | null; p_channel?: string | null };
        Returns: { author: string; messages_out: number; first_response_median_seconds: number | null; reply_median_seconds: number | null; replies_under_1h_pct: number | null }[];
      };
      chat_dashboard_trends: {
        Args: { p_workspace_id: string; p_from: string | null; p_to: string | null; p_channel?: string | null; p_author?: string | null; p_tz?: string };
        Returns: { day: string; messages_in: number; messages_out: number; new_conversations: number }[];
      };
      chat_episodes: {
        Args: { p_workspace_id: string; p_channel?: string | null };
        Returns: { conversation_id: string; contact_id: string; channel_id: string; episode_no: number; episode_start: string; first_inbound_at: string | null; first_outbound_at: string | null; first_outbound_origin: string | null }[];
      };
      chat_dashboard_patterns: {
        Args: { p_workspace_id: string; p_direction: string; p_from: string | null; p_to: string | null };
        Returns: { category_id: string; category_name: string; is_fallback: boolean; message_count: number; text_count: number; top_variants: Json }[];
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
      /**
       * Agenda o empuja un job reprogramable (migracion 00061). Atomica. Solo
       * service_role.
       */
      push_debounced_job: {
        Args: {
          p_type: string;
          p_dedupe_key: string;
          p_payload: Json;
          p_run_at: string;
          p_deadline: string | null;
          /**
           * Claves del payload que se descartan si el job se fusiona con otro
           * disparador (migracion 00070). Opcional: sin ellas, la firma vieja.
           */
          p_volatile_keys?: string[];
        };
        Returns: { job_id: string; job_run_at: string; created: boolean }[];
      };
      /**
       * Busqueda semantica con el filtro de acceso del agente adentro del SQL
       * (migracion 00062): tags permitidos y exclusion de internal_only.
       */
      match_knowledge_chunks_filtered: {
        Args: {
          p_workspace_id: string;
          p_query_embedding: string;
          p_match_count: number;
          p_min_similarity: number;
          p_tags: string[] | null;
          p_include_internal: boolean;
        };
        Returns: {
          chunk_id: string;
          document_id: string;
          document_title: string;
          chunk_index: number;
          content: string;
          similarity: number;
        }[];
      };
      /** Agregados de costo de IA de un periodo (migracion 00069). Solo service_role. */
      ai_cost_report: {
        Args: {
          p_workspace_id: string;
          p_from: string;
          p_to: string;
        };
        Returns: Json;
      };
      /**
       * Franja de la cola de borradores (migracion 00071). Se llama con el
       * cliente del usuario: a un Member le devuelve sus numeros siempre.
       */
      draft_queue_metrics: {
        Args: {
          p_workspace_id: string;
          p_from: string;
          p_to: string;
          p_user_id?: string | null;
        };
        Returns: Json;
      };
      /** Desglose por persona de la cola de borradores (00071). Solo Owner/Admin. */
      draft_queue_metrics_by_person: {
        Args: {
          p_workspace_id: string;
          p_from: string;
          p_to: string;
        };
        Returns: Json;
      };
      /** Gasto de IA en USD desde un instante (migracion 00064). Solo service_role. */
      sum_ai_spend: {
        Args: {
          p_workspace_id: string;
          p_since: string;
          p_agent_id?: string | null;
        };
        Returns: number;
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

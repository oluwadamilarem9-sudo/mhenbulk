export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "paused"
  | "completed"
  | "cancelled";

export type RecipientStatus =
  | "pending"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "bounced";

export type EmailEventType =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "failed"
  | "unsubscribed"
  | "complained"
  | "retry_scheduled";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          company_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          company_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          company_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          user_id: string;
          first_name: string;
          last_name: string;
          email: string;
          email_normalized: string;
          is_unsubscribed: boolean;
          is_suppressed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          first_name: string;
          last_name: string;
          email: string;
          email_normalized?: string;
          is_unsubscribed?: boolean;
          is_suppressed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          first_name?: string;
          last_name?: string;
          email?: string;
          email_normalized?: string;
          is_unsubscribed?: boolean;
          is_suppressed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      campaigns: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          subject: string;
          html_content: string;
          text_content: string | null;
          status: CampaignStatus;
          scheduled_at: string | null;
          started_at: string | null;
          paused_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          subject: string;
          html_content: string;
          text_content?: string | null;
          status?: CampaignStatus;
          scheduled_at?: string | null;
          started_at?: string | null;
          paused_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          subject?: string;
          html_content?: string;
          text_content?: string | null;
          status?: CampaignStatus;
          scheduled_at?: string | null;
          started_at?: string | null;
          paused_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      campaign_recipients: {
        Row: {
          id: string;
          campaign_id: string;
          contact_id: string;
          user_id: string;
          email: string;
          status: RecipientStatus;
          attempt_count: number;
          max_attempts: number;
          last_error: string | null;
          next_attempt_at: string | null;
          queued_at: string | null;
          sent_at: string | null;
          failed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          contact_id: string;
          user_id: string;
          email: string;
          status?: RecipientStatus;
          attempt_count?: number;
          max_attempts?: number;
          last_error?: string | null;
          next_attempt_at?: string | null;
          queued_at?: string | null;
          sent_at?: string | null;
          failed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          contact_id?: string;
          user_id?: string;
          email?: string;
          status?: RecipientStatus;
          attempt_count?: number;
          max_attempts?: number;
          last_error?: string | null;
          next_attempt_at?: string | null;
          queued_at?: string | null;
          sent_at?: string | null;
          failed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_events: {
        Row: {
          id: string;
          user_id: string;
          campaign_id: string | null;
          campaign_recipient_id: string | null;
          contact_id: string | null;
          event_type: EmailEventType;
          provider: string | null;
          provider_message_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          campaign_id?: string | null;
          campaign_recipient_id?: string | null;
          contact_id?: string | null;
          event_type: EmailEventType;
          provider?: string | null;
          provider_message_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          campaign_id?: string | null;
          campaign_recipient_id?: string | null;
          contact_id?: string | null;
          event_type?: EmailEventType;
          provider?: string | null;
          provider_message_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      suppression_list: {
        Row: {
          id: string;
          user_id: string;
          email: string;
          email_normalized: string;
          reason: string;
          source: string;
          contact_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          email: string;
          email_normalized?: string;
          reason: string;
          source?: string;
          contact_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          email?: string;
          email_normalized?: string;
          reason?: string;
          source?: string;
          contact_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      campaign_status: CampaignStatus;
      recipient_status: RecipientStatus;
      email_event_type: EmailEventType;
    };
    CompositeTypes: Record<string, never>;
  };
};

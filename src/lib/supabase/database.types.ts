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

export type EmailAccountProvider = "gmail" | "outlook" | "smtp" | "resend";

export type EmailAccountStatus =
  | "connected"
  | "needs_reauth"
  | "disconnected"
  | "error"
  | "rate_limited";

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
      email_accounts: {
        Row: {
          id: string;
          user_id: string;
          provider: EmailAccountProvider;
          provider_account_id: string;
          email: string;
          display_name: string | null;
          status: EmailAccountStatus;
          scopes: string[];
          token_expiry: string | null;
          rate_limited_until: string | null;
          last_error: string | null;
          last_used_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: EmailAccountProvider;
          provider_account_id: string;
          email: string;
          display_name?: string | null;
          status?: EmailAccountStatus;
          scopes?: string[];
          token_expiry?: string | null;
          rate_limited_until?: string | null;
          last_error?: string | null;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          provider?: EmailAccountProvider;
          provider_account_id?: string;
          email?: string;
          display_name?: string | null;
          status?: EmailAccountStatus;
          scopes?: string[];
          token_expiry?: string | null;
          rate_limited_until?: string | null;
          last_error?: string | null;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_account_credentials: {
        Row: {
          email_account_id: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          key_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          email_account_id: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          key_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email_account_id?: string;
          encrypted_access_token?: string;
          encrypted_refresh_token?: string;
          key_version?: number;
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
          email_account_id: string | null;
          from_email: string | null;
          from_name: string | null;
          pause_reason: string | null;
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
          email_account_id?: string | null;
          from_email?: string | null;
          from_name?: string | null;
          pause_reason?: string | null;
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
          email_account_id?: string | null;
          from_email?: string | null;
          from_name?: string | null;
          pause_reason?: string | null;
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
          provider_message_id: string | null;
          claimed_at: string | null;
          claim_expires_at: string | null;
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
          provider_message_id?: string | null;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
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
          provider_message_id?: string | null;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
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
      email_account_provider: EmailAccountProvider;
      email_account_status: EmailAccountStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

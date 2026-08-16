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
  | "cancelled"
  | "failed";

export type RecipientStatus =
  | "pending"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "bounced"
  | "replied"
  | "unsubscribed"
  | "completed";

export type ContactStatus = "active" | "unsubscribed" | "bounced" | "invalid";

export type CampaignStepType =
  | "initial"
  | "manual_followup"
  | "automated_followup";

export type CampaignStepSendMode = "immediate" | "scheduled" | "automated";

export type CampaignStepStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type CampaignStepAudienceMode =
  | "all_eligible"
  | "not_replied"
  | "custom";

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

export type EmailFinderScanStatus = "running" | "completed" | "partial" | "failed";

export type EmailFinderCategory = "personal" | "business" | "generic";

export type ContactSourceType = "manual" | "csv_import" | "email_finder";

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
          company: string | null;
          phone: string | null;
          notes: string | null;
          status: ContactStatus;
          is_unsubscribed: boolean;
          is_suppressed: boolean;
          source_type: ContactSourceType;
          source_url: string | null;
          source_result_id: string | null;
          discovered_at: string | null;
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
          company?: string | null;
          phone?: string | null;
          notes?: string | null;
          status?: ContactStatus;
          is_unsubscribed?: boolean;
          is_suppressed?: boolean;
          source_type?: ContactSourceType;
          source_url?: string | null;
          source_result_id?: string | null;
          discovered_at?: string | null;
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
          company?: string | null;
          phone?: string | null;
          notes?: string | null;
          status?: ContactStatus;
          is_unsubscribed?: boolean;
          is_suppressed?: boolean;
          source_type?: ContactSourceType;
          source_url?: string | null;
          source_result_id?: string | null;
          discovered_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_source_result_id_fkey";
            columns: ["source_result_id"];
            isOneToOne: false;
            referencedRelation: "email_finder_results";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "email_account_credentials_email_account_id_fkey";
            columns: ["email_account_id"];
            isOneToOne: true;
            referencedRelation: "email_accounts";
            referencedColumns: ["id"];
          },
        ];
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
          automation_enabled: boolean;
          timezone: string;
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
          automation_enabled?: boolean;
          timezone?: string;
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
          automation_enabled?: boolean;
          timezone?: string;
          scheduled_at?: string | null;
          started_at?: string | null;
          paused_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_email_account_id_fkey";
            columns: ["email_account_id"];
            isOneToOne: false;
            referencedRelation: "email_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_recipients: {
        Row: {
          id: string;
          campaign_id: string;
          campaign_step_id: string;
          contact_id: string;
          user_id: string;
          email: string;
          to_email: string;
          to_name: string | null;
          status: RecipientStatus;
          attempt_count: number;
          max_attempts: number;
          last_error: string | null;
          next_attempt_at: string | null;
          queued_at: string | null;
          sent_at: string | null;
          failed_at: string | null;
          replied_at: string | null;
          reply_source: string | null;
          sequence_stopped_at: string | null;
          sequence_stop_reason: string | null;
          provider_message_id: string | null;
          provider_thread_id: string | null;
          claimed_at: string | null;
          claim_expires_at: string | null;
          claim_token: string | null;
          delivery_unknown_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          campaign_step_id: string;
          contact_id: string;
          user_id: string;
          email: string;
          to_email: string;
          to_name?: string | null;
          status?: RecipientStatus;
          attempt_count?: number;
          max_attempts?: number;
          last_error?: string | null;
          next_attempt_at?: string | null;
          queued_at?: string | null;
          sent_at?: string | null;
          failed_at?: string | null;
          replied_at?: string | null;
          reply_source?: string | null;
          sequence_stopped_at?: string | null;
          sequence_stop_reason?: string | null;
          provider_message_id?: string | null;
          provider_thread_id?: string | null;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
          claim_token?: string | null;
          delivery_unknown_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          campaign_step_id?: string;
          contact_id?: string;
          user_id?: string;
          email?: string;
          to_email?: string;
          to_name?: string | null;
          status?: RecipientStatus;
          attempt_count?: number;
          max_attempts?: number;
          last_error?: string | null;
          next_attempt_at?: string | null;
          queued_at?: string | null;
          sent_at?: string | null;
          failed_at?: string | null;
          replied_at?: string | null;
          reply_source?: string | null;
          sequence_stopped_at?: string | null;
          sequence_stop_reason?: string | null;
          provider_message_id?: string | null;
          provider_thread_id?: string | null;
          claimed_at?: string | null;
          claim_expires_at?: string | null;
          claim_token?: string | null;
          delivery_unknown_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_recipients_campaign_step_id_fkey";
            columns: ["campaign_step_id"];
            isOneToOne: false;
            referencedRelation: "campaign_steps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          name_normalized: string;
          color: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          name_normalized?: string;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          name_normalized?: string;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      contact_tags: {
        Row: {
          id: string;
          user_id: string;
          contact_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          contact_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          contact_id?: string;
          tag_id?: string;
          created_at?: string;
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
      campaign_contacts: {
        Row: {
          id: string;
          user_id: string;
          campaign_id: string;
          contact_id: string;
          added_at: string;
          removed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          campaign_id: string;
          contact_id: string;
          added_at?: string;
          removed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          campaign_id?: string;
          contact_id?: string;
          added_at?: string;
          removed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_contacts_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_contacts_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_steps: {
        Row: {
          id: string;
          user_id: string;
          campaign_id: string;
          step_number: number;
          step_type: CampaignStepType;
          subject: string | null;
          html_content: string;
          text_content: string | null;
          delay_minutes: number;
          send_mode: CampaignStepSendMode;
          status: CampaignStepStatus;
          scheduled_at: string | null;
          timezone: string;
          stop_on_reply: boolean;
          stop_on_unsubscribe: boolean;
          stop_on_bounce: boolean;
          audience_mode: CampaignStepAudienceMode;
          target_contact_ids: string[];
          email_account_id: string | null;
          sent_at: string | null;
          failed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          campaign_id: string;
          step_number: number;
          step_type: CampaignStepType;
          subject?: string | null;
          html_content?: string;
          text_content?: string | null;
          delay_minutes?: number;
          send_mode?: CampaignStepSendMode;
          status?: CampaignStepStatus;
          scheduled_at?: string | null;
          timezone?: string;
          stop_on_reply?: boolean;
          stop_on_unsubscribe?: boolean;
          stop_on_bounce?: boolean;
          audience_mode?: CampaignStepAudienceMode;
          target_contact_ids?: string[];
          email_account_id?: string | null;
          sent_at?: string | null;
          failed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          campaign_id?: string;
          step_number?: number;
          step_type?: CampaignStepType;
          subject?: string | null;
          html_content?: string;
          text_content?: string | null;
          delay_minutes?: number;
          send_mode?: CampaignStepSendMode;
          status?: CampaignStepStatus;
          scheduled_at?: string | null;
          timezone?: string;
          stop_on_reply?: boolean;
          stop_on_unsubscribe?: boolean;
          stop_on_bounce?: boolean;
          audience_mode?: CampaignStepAudienceMode;
          target_contact_ids?: string[];
          email_account_id?: string | null;
          sent_at?: string | null;
          failed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_steps_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_steps_email_account_id_fkey";
            columns: ["email_account_id"];
            isOneToOne: false;
            referencedRelation: "email_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_activity: {
        Row: {
          id: string;
          user_id: string;
          campaign_id: string | null;
          campaign_step_id: string | null;
          campaign_contact_id: string | null;
          campaign_recipient_id: string | null;
          contact_id: string | null;
          event_type: string;
          metadata: Json;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          campaign_id?: string | null;
          campaign_step_id?: string | null;
          campaign_contact_id?: string | null;
          campaign_recipient_id?: string | null;
          contact_id?: string | null;
          event_type: string;
          metadata?: Json;
          occurred_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          campaign_id?: string | null;
          campaign_step_id?: string | null;
          campaign_contact_id?: string | null;
          campaign_recipient_id?: string | null;
          contact_id?: string | null;
          event_type?: string;
          metadata?: Json;
          occurred_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_activity_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_activity_campaign_step_id_fkey";
            columns: ["campaign_step_id"];
            isOneToOne: false;
            referencedRelation: "campaign_steps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_activity_campaign_contact_id_fkey";
            columns: ["campaign_contact_id"];
            isOneToOne: false;
            referencedRelation: "campaign_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_activity_campaign_recipient_id_fkey";
            columns: ["campaign_recipient_id"];
            isOneToOne: false;
            referencedRelation: "campaign_recipients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_activity_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      email_events: {
        Row: {
          id: string;
          user_id: string;
          campaign_id: string | null;
          campaign_step_id: string | null;
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
          campaign_step_id?: string | null;
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
          campaign_step_id?: string | null;
          campaign_recipient_id?: string | null;
          contact_id?: string | null;
          event_type?: EmailEventType;
          provider?: string | null;
          provider_message_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_events_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_events_campaign_step_id_fkey";
            columns: ["campaign_step_id"];
            isOneToOne: false;
            referencedRelation: "campaign_steps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_events_campaign_recipient_id_fkey";
            columns: ["campaign_recipient_id"];
            isOneToOne: false;
            referencedRelation: "campaign_recipients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_events_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "suppression_list_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      email_finder_scans: {
        Row: {
          id: string;
          user_id: string;
          target_url: string;
          domain: string;
          status: EmailFinderScanStatus;
          pages_scanned: number;
          emails_found: number;
          limit_reached: boolean;
          javascript_hint: boolean;
          error_code: string | null;
          error_message: string | null;
          started_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          target_url: string;
          domain: string;
          status?: EmailFinderScanStatus;
          pages_scanned?: number;
          emails_found?: number;
          limit_reached?: boolean;
          javascript_hint?: boolean;
          error_code?: string | null;
          error_message?: string | null;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          target_url?: string;
          domain?: string;
          status?: EmailFinderScanStatus;
          pages_scanned?: number;
          emails_found?: number;
          limit_reached?: boolean;
          javascript_hint?: boolean;
          error_code?: string | null;
          error_message?: string | null;
          started_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_finder_results: {
        Row: {
          id: string;
          user_id: string;
          scan_id: string;
          email: string;
          email_normalized: string;
          source_url: string;
          category: EmailFinderCategory;
          selected: boolean;
          added_to_contacts: boolean;
          contact_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scan_id: string;
          email: string;
          email_normalized?: string;
          source_url: string;
          category?: EmailFinderCategory;
          selected?: boolean;
          added_to_contacts?: boolean;
          contact_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          scan_id?: string;
          email?: string;
          email_normalized?: string;
          source_url?: string;
          category?: EmailFinderCategory;
          selected?: boolean;
          added_to_contacts?: boolean;
          contact_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_finder_results_scan_id_fkey";
            columns: ["scan_id"];
            isOneToOne: false;
            referencedRelation: "email_finder_scans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_finder_results_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
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
      contact_status: ContactStatus;
      campaign_step_type: CampaignStepType;
      campaign_step_send_mode: CampaignStepSendMode;
      campaign_step_status: CampaignStepStatus;
      campaign_step_audience_mode: CampaignStepAudienceMode;
      email_finder_scan_status: EmailFinderScanStatus;
      email_finder_category: EmailFinderCategory;
    };
    CompositeTypes: Record<string, never>;
  };
};

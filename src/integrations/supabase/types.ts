export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bid_activity_log: {
        Row: {
          action: string
          bid_id: string
          created_at: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          bid_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          bid_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_activity_log_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_deliverables: {
        Row: {
          assigned_team: Database["public"]["Enums"]["assigned_team"]
          assigned_to: string | null
          bid_id: string
          created_at: string
          due_date: string | null
          id: string
          label: string
          order_index: number
          stage: Database["public"]["Enums"]["bid_stage"]
          status: Database["public"]["Enums"]["task_status"]
          storage_path: string | null
          type: Database["public"]["Enums"]["deliverable_type"]
          updated_at: string
          version: number
        }
        Insert: {
          assigned_team?: Database["public"]["Enums"]["assigned_team"]
          assigned_to?: string | null
          bid_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          label: string
          order_index?: number
          stage: Database["public"]["Enums"]["bid_stage"]
          status?: Database["public"]["Enums"]["task_status"]
          storage_path?: string | null
          type?: Database["public"]["Enums"]["deliverable_type"]
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_team?: Database["public"]["Enums"]["assigned_team"]
          assigned_to?: string | null
          bid_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          label?: string
          order_index?: number
          stage?: Database["public"]["Enums"]["bid_stage"]
          status?: Database["public"]["Enums"]["task_status"]
          storage_path?: string | null
          type?: Database["public"]["Enums"]["deliverable_type"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bid_deliverables_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_deliverables_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_questions: {
        Row: {
          assigned_team: Database["public"]["Enums"]["assigned_team"]
          assigned_to: string | null
          bid_id: string
          created_at: string
          due_date: string | null
          id: string
          internal_notes: string | null
          order_index: number
          question_text: string
          response_text: string | null
          stage: Database["public"]["Enums"]["bid_stage"]
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
        }
        Insert: {
          assigned_team: Database["public"]["Enums"]["assigned_team"]
          assigned_to?: string | null
          bid_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          internal_notes?: string | null
          order_index?: number
          question_text: string
          response_text?: string | null
          stage: Database["public"]["Enums"]["bid_stage"]
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Update: {
          assigned_team?: Database["public"]["Enums"]["assigned_team"]
          assigned_to?: string | null
          bid_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          internal_notes?: string | null
          order_index?: number
          question_text?: string
          response_text?: string | null
          stage?: Database["public"]["Enums"]["bid_stage"]
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_questions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_questions_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_stage_history: {
        Row: {
          bid_id: string
          entered_at: string
          exited_at: string | null
          id: string
          moved_by: string | null
          stage: Database["public"]["Enums"]["bid_stage"]
        }
        Insert: {
          bid_id: string
          entered_at?: string
          exited_at?: string | null
          id?: string
          moved_by?: string | null
          stage: Database["public"]["Enums"]["bid_stage"]
        }
        Update: {
          bid_id?: string
          entered_at?: string
          exited_at?: string | null
          id?: string
          moved_by?: string | null
          stage?: Database["public"]["Enums"]["bid_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "bid_stage_history_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_stage_history_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bids: {
        Row: {
          clarification_deadline: string | null
          client_name: string
          created_at: string
          created_by: string | null
          deadline: string
          gonogo_completed_at: string | null
          gonogo_completed_by: string | null
          gonogo_decision: Database["public"]["Enums"]["gonogo_decision"] | null
          gonogo_score: number | null
          hubspot_deal_id: string | null
          id: string
          contact_name: string | null
          contact_email: string | null
          contact_phone: string | null
          product_type: "TA" | "TM" | null
          orals_date: string | null
          owner_id: string | null
          priority: Database["public"]["Enums"]["priority_level"]
          procurement_portal: string | null
          stage: Database["public"]["Enums"]["bid_stage"]
          status: Database["public"]["Enums"]["bid_status"]
          title: string
          type: Database["public"]["Enums"]["bid_type"]
          updated_at: string
          value: number
        }
        Insert: {
          clarification_deadline?: string | null
          client_name: string
          created_at?: string
          created_by?: string | null
          deadline: string
          gonogo_completed_at?: string | null
          gonogo_completed_by?: string | null
          gonogo_decision?:
            | Database["public"]["Enums"]["gonogo_decision"]
            | null
          gonogo_score?: number | null
          hubspot_deal_id?: string | null
          id?: string
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          product_type?: "TA" | "TM" | null
          orals_date?: string | null
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          procurement_portal?: string | null
          stage?: Database["public"]["Enums"]["bid_stage"]
          status?: Database["public"]["Enums"]["bid_status"]
          title: string
          type: Database["public"]["Enums"]["bid_type"]
          updated_at?: string
          value?: number
        }
        Update: {
          clarification_deadline?: string | null
          client_name?: string
          created_at?: string
          created_by?: string | null
          deadline?: string
          gonogo_completed_at?: string | null
          gonogo_completed_by?: string | null
          gonogo_decision?:
            | Database["public"]["Enums"]["gonogo_decision"]
            | null
          gonogo_score?: number | null
          hubspot_deal_id?: string | null
          id?: string
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          product_type?: "TA" | "TM" | null
          orals_date?: string | null
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          procurement_portal?: string | null
          stage?: Database["public"]["Enums"]["bid_stage"]
          status?: Database["public"]["Enums"]["bid_status"]
          title?: string
          type?: Database["public"]["Enums"]["bid_type"]
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "bids_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_gonogo_completed_by_fkey"
            columns: ["gonogo_completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "pre_sales" | "legal" | "finance" | "admin"
      assigned_team:
        | "pre_sales"
        | "legal"
        | "finance"
        | "product"
        | "engineering"
      bid_stage:
        | "deal_qualification"
        | "rfi"
        | "rfp"
        | "orals"
        | "due_diligence"
        | "bafo"
        | "contract_closure"
        | "post_closure"
      bid_status: "active" | "submitted" | "won" | "lost" | "no_go" | "on_hold"
      bid_type: "rfp" | "rfi" | "rfq" | "direct"
      deliverable_type: "document" | "approval" | "review" | "action"
      gonogo_decision: "go" | "conditional_go" | "no_go"
      priority_level: "high" | "medium" | "low"
      task_status: "pending" | "in_progress" | "done" | "blocked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["pre_sales", "legal", "finance", "admin"],
      assigned_team: [
        "pre_sales",
        "legal",
        "finance",
        "product",
        "engineering",
      ],
      bid_stage: [
        "deal_qualification",
        "rfi",
        "rfp",
        "orals",
        "due_diligence",
        "bafo",
        "contract_closure",
        "post_closure",
      ],
      bid_status: ["active", "submitted", "won", "lost", "no_go", "on_hold"],
      bid_type: ["rfp", "rfi", "rfq", "direct"],
      deliverable_type: ["document", "approval", "review", "action"],
      gonogo_decision: ["go", "conditional_go", "no_go"],
      priority_level: ["high", "medium", "low"],
      task_status: ["pending", "in_progress", "done", "blocked"],
    },
  },
} as const

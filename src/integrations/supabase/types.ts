export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      addon_groups: {
        Row: {
          branch_id: string;
          created_at: string;
          id: string;
          is_required: boolean;
          max_select: number;
          min_select: number;
          name: string;
        };
        Insert: {
          branch_id: string;
          created_at?: string;
          id?: string;
          is_required?: boolean;
          max_select?: number;
          min_select?: number;
          name: string;
        };
        Update: {
          branch_id?: string;
          created_at?: string;
          id?: string;
          is_required?: boolean;
          max_select?: number;
          min_select?: number;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "addon_groups_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      addons: {
        Row: {
          group_id: string;
          id: string;
          is_active: boolean;
          name: string;
          price: number;
        };
        Insert: {
          group_id: string;
          id?: string;
          is_active?: boolean;
          name: string;
          price?: number;
        };
        Update: {
          group_id?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "addons_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "addon_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          branch_id: string | null;
          created_at: string;
          entity: string;
          entity_id: string | null;
          id: string;
          meta: Json | null;
          restaurant_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          branch_id?: string | null;
          created_at?: string;
          entity: string;
          entity_id?: string | null;
          id?: string;
          meta?: Json | null;
          restaurant_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          branch_id?: string | null;
          created_at?: string;
          entity?: string;
          entity_id?: string | null;
          id?: string;
          meta?: Json | null;
          restaurant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      branches: {
        Row: {
          address: string | null;
          code: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          phone: string | null;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          code: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          phone?: string | null;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          code?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          phone?: string | null;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branches_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      item_addon_groups: {
        Row: {
          group_id: string;
          item_id: string;
        };
        Insert: {
          group_id: string;
          item_id: string;
        };
        Update: {
          group_id?: string;
          item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_addon_groups_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "addon_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "item_addon_groups_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
        ];
      };
      item_variants: {
        Row: {
          id: string;
          is_default: boolean;
          item_id: string;
          name: string;
          price_delta: number;
          sort_order: number;
        };
        Insert: {
          id?: string;
          is_default?: boolean;
          item_id: string;
          name: string;
          price_delta?: number;
          sort_order?: number;
        };
        Update: {
          id?: string;
          is_default?: boolean;
          item_id?: string;
          name?: string;
          price_delta?: number;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "item_variants_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_categories: {
        Row: {
          branch_id: string;
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          branch_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          name: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          branch_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_categories_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_items: {
        Row: {
          base_price: number;
          branch_id: string;
          category_id: string;
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          is_available: boolean;
          is_veg: boolean | null;
          name: string;
          prep_time_min: number | null;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          base_price: number;
          branch_id: string;
          category_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_available?: boolean;
          is_veg?: boolean | null;
          name: string;
          prep_time_min?: number | null;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          base_price?: number;
          branch_id?: string;
          category_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_available?: boolean;
          is_veg?: boolean | null;
          name?: string;
          prep_time_min?: number | null;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_items_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "menu_items_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "menu_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      operating_hours: {
        Row: {
          branch_id: string;
          close_time: string | null;
          id: string;
          is_closed: boolean;
          open_time: string | null;
          weekday: number;
        };
        Insert: {
          branch_id: string;
          close_time?: string | null;
          id?: string;
          is_closed?: boolean;
          open_time?: string | null;
          weekday: number;
        };
        Update: {
          branch_id?: string;
          close_time?: string | null;
          id?: string;
          is_closed?: boolean;
          open_time?: string | null;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "operating_hours_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      order_counters: {
        Row: {
          branch_id: string;
          counter_date: string;
          last_seq: number;
        };
        Insert: {
          branch_id: string;
          counter_date: string;
          last_seq?: number;
        };
        Update: {
          branch_id?: string;
          counter_date?: string;
          last_seq?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_counters_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item_addons: {
        Row: {
          addon_id: string | null;
          id: string;
          name_snapshot: string;
          order_item_id: string;
          price_snapshot: number;
        };
        Insert: {
          addon_id?: string | null;
          id?: string;
          name_snapshot: string;
          order_item_id: string;
          price_snapshot: number;
        };
        Update: {
          addon_id?: string | null;
          id?: string;
          name_snapshot?: string;
          order_item_id?: string;
          price_snapshot?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_addons_addon_id_fkey";
            columns: ["addon_id"];
            isOneToOne: false;
            referencedRelation: "addons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_item_addons_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          addons_total: number;
          id: string;
          item_id: string | null;
          line_subtotal: number;
          name_snapshot: string;
          notes: string | null;
          order_id: string;
          qty: number;
          unit_price: number;
          variant_id: string | null;
          variant_snapshot: string | null;
        };
        Insert: {
          addons_total?: number;
          id?: string;
          item_id?: string | null;
          line_subtotal: number;
          name_snapshot: string;
          notes?: string | null;
          order_id: string;
          qty: number;
          unit_price: number;
          variant_id?: string | null;
          variant_snapshot?: string | null;
        };
        Update: {
          addons_total?: number;
          id?: string;
          item_id?: string | null;
          line_subtotal?: number;
          name_snapshot?: string;
          notes?: string | null;
          order_id?: string;
          qty?: number;
          unit_price?: number;
          variant_id?: string | null;
          variant_snapshot?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "item_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      order_taxes: {
        Row: {
          amount: number;
          id: string;
          name_snapshot: string;
          order_id: string;
          rate_snapshot: number;
          tax_id: string | null;
        };
        Insert: {
          amount: number;
          id?: string;
          name_snapshot: string;
          order_id: string;
          rate_snapshot: number;
          tax_id?: string | null;
        };
        Update: {
          amount?: number;
          id?: string;
          name_snapshot?: string;
          order_id?: string;
          rate_snapshot?: number;
          tax_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_taxes_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_taxes_tax_id_fkey";
            columns: ["tax_id"];
            isOneToOne: false;
            referencedRelation: "taxes";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          amount_paid: number;
          bill_print_count: number;
          branch_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          dining_type: Database["public"]["Enums"]["dining_type"];
          discount_total: number;
          grand_total: number;
          id: string;
          idempotency_key: string | null;
          kot_print_count: number;
          last_printed_at: string | null;
          notes: string | null;
          order_no: string;
          payment_status: Database["public"]["Enums"]["payment_status_t"];
          receipt_print_count: number;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          table_label: string | null;
          tax_total: number;
          updated_at: string;
        };
        Insert: {
          amount_paid?: number;
          bill_print_count?: number;
          branch_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          dining_type?: Database["public"]["Enums"]["dining_type"];
          discount_total?: number;
          grand_total?: number;
          id?: string;
          idempotency_key?: string | null;
          kot_print_count?: number;
          last_printed_at?: string | null;
          notes?: string | null;
          order_no: string;
          payment_status?: Database["public"]["Enums"]["payment_status_t"];
          receipt_print_count?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          table_label?: string | null;
          tax_total?: number;
          updated_at?: string;
        };
        Update: {
          amount_paid?: number;
          bill_print_count?: number;
          branch_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          dining_type?: Database["public"]["Enums"]["dining_type"];
          discount_total?: number;
          grand_total?: number;
          id?: string;
          idempotency_key?: string | null;
          kot_print_count?: number;
          last_printed_at?: string | null;
          notes?: string | null;
          order_no?: string;
          payment_status?: Database["public"]["Enums"]["payment_status_t"];
          receipt_print_count?: number;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          table_label?: string | null;
          tax_total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          id: string;
          kind: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          paid_at: string;
          received_by: string | null;
          reference: string | null;
        };
        Insert: {
          amount: number;
          id?: string;
          kind?: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          paid_at?: string;
          received_by?: string | null;
          reference?: string | null;
        };
        Update: {
          amount?: number;
          id?: string;
          kind?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          order_id?: string;
          paid_at?: string;
          received_by?: string | null;
          reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      restaurants: {
        Row: {
          address: string | null;
          created_at: string;
          currency: string;
          currency_symbol: string;
          email: string | null;
          id: string;
          legal_name: string | null;
          logo_url: string | null;
          name: string;
          owner_id: string;
          phone: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          currency?: string;
          currency_symbol?: string;
          email?: string | null;
          id?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          name: string;
          owner_id: string;
          phone?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          currency?: string;
          currency_symbol?: string;
          email?: string | null;
          id?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          name?: string;
          owner_id?: string;
          phone?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      taxes: {
        Row: {
          apply_by_default: boolean;
          created_at: string;
          id: string;
          is_active: boolean;
          is_inclusive: boolean;
          name: string;
          rate: number;
          restaurant_id: string;
        };
        Insert: {
          apply_by_default?: boolean;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_inclusive?: boolean;
          name: string;
          rate: number;
          restaurant_id: string;
        };
        Update: {
          apply_by_default?: boolean;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_inclusive?: boolean;
          name?: string;
          rate?: number;
          restaurant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "taxes_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          branch_id: string | null;
          created_at: string;
          id: string;
          restaurant_id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          branch_id?: string | null;
          created_at?: string;
          id?: string;
          restaurant_id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          branch_id?: string | null;
          created_at?: string;
          id?: string;
          restaurant_id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      adjust_order_discount: {
        Args: { _discount: number; _order_id: string; _reason?: string };
        Returns: {
          new_grand_total: number;
          new_payment_status: Database["public"]["Enums"]["payment_status_t"];
          order_id: string;
          order_no: string;
        }[];
      };
      can_access_branch: {
        Args: { _branch: string; _user: string };
        Returns: boolean;
      };
      cancel_order: { Args: { _order_id: string; _reason?: string }; Returns: undefined };
      can_manage_branch: {
        Args: { _branch: string; _user: string };
        Returns: boolean;
      };
      create_pos_order: {
        Args: {
          _branch: string;
          _customer_name: string;
          _customer_phone: string;
          _dining_type: Database["public"]["Enums"]["dining_type"];
          _discount: number;
          _idempotency_key: string;
          _items: Json;
          _table_label: string;
        };
        Returns: {
          order_id: string;
          order_no: string;
        }[];
      };
      update_pos_order: {
        Args: {
          _customer_name: string;
          _customer_phone: string;
          _dining_type: Database["public"]["Enums"]["dining_type"];
          _discount: number;
          _items: Json;
          _order_id: string;
          _table_label: string;
        };
        Returns: {
          order_id: string;
          order_no: string;
        }[];
      };
      current_user_restaurant: { Args: never; Returns: string };
      delete_order_admin: {
        Args: { _order_id: string; _reason: string };
        Returns: undefined;
      };
      has_role_in_restaurant: {
        Args: {
          _restaurant: string;
          _role: Database["public"]["Enums"]["app_role"];
          _user: string;
        };
        Returns: boolean;
      };
      is_restaurant_admin: {
        Args: { _restaurant: string; _user: string };
        Returns: boolean;
      };
      is_restaurant_member: {
        Args: { _restaurant: string; _user: string };
        Returns: boolean;
      };
      next_order_number: { Args: { _branch: string }; Returns: string };
      record_payment: {
        Args: {
          _amount: number;
          _method: Database["public"]["Enums"]["payment_method"];
          _order_id: string;
          _reference?: string;
        };
        Returns: {
          new_amount_paid: number;
          new_payment_status: Database["public"]["Enums"]["payment_status_t"];
          payment_id: string;
        }[];
      };
      record_print: {
        Args: { _kind: string; _order_id: string };
        Returns: undefined;
      };
      refund_order: {
        Args: {
          _amount: number;
          _method: Database["public"]["Enums"]["payment_method"];
          _order_id: string;
          _reason: string;
          _reference?: string;
          _restore_inventory?: boolean;
        };
        Returns: {
          new_amount_paid: number;
          new_payment_status: Database["public"]["Enums"]["payment_status_t"];
          refund_payment_id: string;
        }[];
      };
      reopen_order: {
        Args: { _order_id: string; _reason: string };
        Returns: undefined;
      };
      reverse_order_inventory: {
        Args: { _actor_id: string; _branch_id: string; _note: string; _order_id: string };
        Returns: number;
      };
      void_order: {
        Args: {
          _method?: Database["public"]["Enums"]["payment_method"];
          _order_id: string;
          _reason: string;
          _reference?: string;
          _refund_paid?: boolean;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "owner" | "admin" | "manager" | "cashier" | "kitchen" | "waiter";
      dining_type: "dine_in" | "takeaway" | "delivery";
      order_status:
        | "open"
        | "placed"
        | "preparing"
        | "ready"
        | "served"
        | "completed"
        | "cancelled"
        | "voided"
        | "refunded";
      payment_method: "cash" | "card" | "upi" | "wallet" | "other";
      payment_status_t: "pending" | "partial" | "paid" | "refunded";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "manager", "cashier", "kitchen", "waiter"],
      dining_type: ["dine_in", "takeaway", "delivery"],
      order_status: [
        "open",
        "placed",
        "preparing",
        "ready",
        "served",
        "completed",
        "cancelled",
        "voided",
        "refunded",
      ],
      payment_method: ["cash", "card", "upi", "wallet", "other"],
      payment_status_t: ["pending", "partial", "paid", "refunded"],
    },
  },
} as const;

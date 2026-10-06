import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export type JobStatus = "pending" | "booked" | "simulated" | "failed" | "cancelled" | "uncertain";

export interface BookingJob {
  id: string;
  complex_id: string;
  complex_name: string;
  facility_id: string;
  facility_name: string;
  min_people: number;
  target_date: string; // YYYY-MM-DD
  pref_from: number; // start hour, inclusive
  pref_to: number;
  dry_run: boolean;
  release_at: string;
  start_at: string;
  give_up_at: string;
  status: JobStatus;
  first_free_seen_at: string | null;
  booked_hour: number | null;
  court_id: string | null;
  reservation_id: string | null;
  invite_link: string | null;
  result_message: string | null;
  attempts: number;
  booking_attempts: number;
  created_at: string;
}

export interface TerenuriAccount {
  email: string;
  terenuri_user_id: string | null;
  display_name: string | null;
  verified_at: string | null;
  last_error: string | null;
}

export const inviteUrl = (link: string) => `https://sportinclujnapoca.ro/reservations/confirm?id=${link}`;

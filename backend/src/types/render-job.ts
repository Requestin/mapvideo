export interface RenderJobRow {
  id: string;
  user_id: string;
  status: string;
  progress: number;
  state_json: unknown;
  output_path: string | null;
  thumbnail_path: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export const ALLOWED_UPDATE_FIELDS = [
  "title",
  "prompt",
  "cron_schedule",
  "agent",
  "type",
] as const;

export const CRON_FORMAT =
  /^[0-9*,/-]+\s+[0-9*,/-]+\s+[0-9*,/-]+\s+[0-9*,/-]+\s+[0-9*,/-]+$/;

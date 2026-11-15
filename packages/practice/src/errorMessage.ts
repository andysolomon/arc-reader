/** The message inside an error body from VoiceStudio or a proxy in front of it, whatever its shape. */
export function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(errorMessage).join("; ");
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const key of ["message", "detail", "error", "reason", "msg"]) {
      if (v[key]) return errorMessage(v[key]);
    }
  }
  return "VoiceStudio could not complete this request.";
}

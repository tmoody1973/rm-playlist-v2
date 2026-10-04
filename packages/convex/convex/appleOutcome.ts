export type AppleOutcome = {
  status: "added" | "failed" | "expired";
  retry: boolean;
  reason?: string;
};

export function appleOutcome(httpStatus: number | "network"): AppleOutcome {
  if (httpStatus === "network" || httpStatus === 429 || httpStatus >= 500)
    return { status: "failed", retry: true, reason: "Apple Music unavailable" };
  if (httpStatus === 200 || httpStatus === 202) return { status: "added", retry: false };
  if (httpStatus === 401 || httpStatus === 403)
    return { status: "expired", retry: false, reason: "Apple Music needs reconnecting" };
  return { status: "failed", retry: false, reason: `Apple Music returned ${httpStatus}` };
}

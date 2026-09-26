/** Best-effort client IP. Behind Vercel/any proxy, x-forwarded-for is the real one. */
export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "0.0.0.0").trim();
}

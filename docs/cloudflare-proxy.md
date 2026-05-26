# Cloudflare proxy in front of the API

Why: free DDoS protection, WAF, bot management, and a single tunable choke
point. Caddy on the VPS still terminates TLS at the origin so traffic between
Cloudflare and Hetzner is encrypted.

## One-time setup

1. Add `api.example.com` and `app.example.com` as DNS records in Cloudflare
   - Type `A` → VPS IP
   - **Proxy status: Proxied (orange cloud)** — this is what enables WAF/DDoS
2. SSL/TLS mode: **Full (strict)** — verifies the origin cert that Caddy issues
3. In Edge Certificates: enable
   - **Always Use HTTPS**
   - **Automatic HTTPS Rewrites**
   - **Minimum TLS Version: 1.2**

## WAF / firewall rules

In Security → WAF, add custom rules:

- **Block known scrapers**: `(cf.client.bot) and not (http.user_agent contains "Googlebot")` → Block
- **Rate-limit `/api/v1/auth/login`**: 10 req/min/IP → Block 5m
- **Rate-limit `/api/v1/videos/*/key`**: 60 req/min/IP → Block 10m
  (per-user limit is enforced in app; this is the edge layer)
- **Geo-restrict** if your audience is regional (e.g. allow only TH/SG/MY) →
  Managed Challenge instead of Block to avoid false positives

## Origin lockdown

Once Cloudflare proxies traffic, restrict the VPS firewall to accept HTTPS only
from Cloudflare IPs (https://www.cloudflare.com/ips-v4):

```bash
# On VPS, replace ufw rule
ufw delete allow 80/tcp
ufw delete allow 443/tcp
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from "$ip" to any port 443 proto tcp
done
ufw reload
```

This blocks direct origin scrapes that bypass Cloudflare's WAF.

## Caching

- `api.example.com`: **bypass cache** (set Page Rule). API responses are
  user-specific; caching would leak data
- Static assets on app: respect origin cache headers (Next.js already sets them)

## Headers Caddy sees

When proxied, `request.client.host` is a Cloudflare IP. Use `CF-Connecting-IP`
or `X-Forwarded-For` instead. The app already reads `X-Real-IP` set by Caddy;
configure Caddy to set it from `CF-Connecting-IP` when behind Cloudflare:

```caddy
api.example.com {
  request_header X-Real-IP {http.request.header.CF-Connecting-IP}
  reverse_proxy api:8000 { ... }
}
```

## Honest limits

Cloudflare blocks volumetric DDoS and obvious bot patterns. It does NOT stop:
- Targeted credential stuffing from residential proxies (use app-level rate
  limit + structured login alerts)
- Authenticated scraping by paying customers (use watermark + forensic logs)

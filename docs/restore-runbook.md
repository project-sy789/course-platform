# Restore runbook

A backup is only as good as your most recent successful restore. **Run a
restore drill quarterly** (calendar reminder, not "when we remember").

## What is backed up

Daily, by Ofelia in `docker-compose.yml` at 03:17 UTC:
- `s3://$AWS_BACKUP_BUCKET/media/<key>` — every R2 object (HLS variants, manifests, segments)
- `s3://$AWS_BACKUP_BUCKET/db/<ts>.sql.gz` — full Postgres dump (includes encrypted `video_keys`)

Storage class: `DEEP_ARCHIVE` (12–48h to restore).

The KEK lives in environment variables, not in the backup. **Without the KEK,
`video_keys` rows are useless even if you have the DB dump.** Store the KEK
in a separate password manager / sealed envelope.

## Quick health check (no full restore)

```sh
docker compose exec api python -m scripts.restore_drill
```

This verifies:
1. Latest `db/*.sql.gz` is present and non-trivial in size.
2. A random sample of media objects can be HEADed.

It does **not** restore Deep Archive objects (those are skipped unless
`--max-wait-min` is set). Run this monthly as a smoke test.

## Quarterly drill (real restore round-trip)

```sh
docker compose exec api python -m scripts.restore_drill --sample 5 --max-wait-min 60
```

This issues `restore_object` for the latest dump + 5 random media objects,
polls until ready, downloads, decompresses the dump, and grep-checks for
expected table names. Cost: a few cents per sampled object.

## Full disaster recovery

When the primary R2 bucket and/or Postgres are gone:

### 1. Restore the database

```sh
LATEST=$(aws s3 ls s3://$AWS_BACKUP_BUCKET/db/ | sort | tail -1 | awk '{print $4}')
aws s3api restore-object --bucket $AWS_BACKUP_BUCKET --key db/$LATEST \
  --restore-request '{"Days":7,"GlacierJobParameters":{"Tier":"Standard"}}'

# wait 12-48h, then:
aws s3 cp s3://$AWS_BACKUP_BUCKET/db/$LATEST ./dump.sql.gz
gunzip dump.sql.gz
docker compose exec -T db psql -U course -d course < dump.sql
```

### 2. Restore media

For a full bucket restore, issue a Batch Operations job (S3 console →
Batch Operations → Restore). Don't `restore-object` per-key in a loop —
that's slow and expensive.

```sh
# After Batch Restore finishes, copy back to R2:
aws s3 sync s3://$AWS_BACKUP_BUCKET/media/ s3://$R2_BUCKET/ \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
  --profile r2
```

### 3. Verify the KEK still works

```sh
docker compose exec api python -c "
from app.db import SessionLocal
from app.models import VideoKey
from app.crypto import decrypt_video_key
s = SessionLocal()
vk = s.query(VideoKey).first()
print('OK' if decrypt_video_key(vk.key_ciphertext, vk.key_nonce, vk.key_tag) else 'FAIL')
"
```

If this prints anything other than `OK`, the KEK in the environment does
not match the one used at encryption time. Stop and find the right KEK
before doing anything else — re-issuing keys means re-encrypting every
video.

## RTO / RPO

- **RPO** (data loss tolerance): up to 24h — the gap between backup runs.
- **RTO** (time to recover): 12–48h dominated by Deep Archive thaw.

If either of those is unacceptable for your business, switch the dump
target to STANDARD_IA (faster, ~5x more expensive) and run the dump every
6h instead of daily.

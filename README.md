# GeoChat

Chat realtime + map location realtime (MapLibre GL + OpenStreetMap) trên Next.js + Supabase.
Xem [CLAUDE.md](CLAUDE.md) cho stack + workflow, [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md) cho bối cảnh.

## Local dev

```bash
cp .env.example .env.local   # rồi điền NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:3000
```

App chạy được ở "chế độ mock" khi chưa có key Supabase (UI không crash).

## Kiểm tra trước khi push

```bash
npm run lint && npx tsc --noEmit && npm run build
```

Đây đúng là 3 bước CI chạy trên mỗi PR (xem [.github/workflows/ci.yml](.github/workflows/ci.yml)).

---

## Deploy (Vercel)

Hosting trên **Vercel** với Git integration native: mỗi PR có preview URL, merge vào `master` → deploy production.

### Cài đặt một lần (Vercel dashboard)
1. **Import repo** vào Vercel → framework tự nhận là Next.js (cấu hình build ở [vercel.json](vercel.json)).
2. **Environment Variables** (cho cả Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   (Cùng 2 biến trong `.env.example`. Cả hai là anon key public — an toàn nằm trong client bundle.)
3. **Production branch** = `master`.
4. **Supabase Auth redirect**: vào Supabase → Authentication → URL Configuration, thêm URL production
   + preview của Vercel vào *Redirect URLs* (magic-link callback ở [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts)).
   Thiếu bước này → đăng nhập trên domain deploy bị hỏng redirect.

---

## CI/CD

| Workflow | Trigger | Việc làm |
|----------|---------|----------|
| [ci.yml](.github/workflows/ci.yml) | mọi PR + push `master` | lint → typecheck → build |
| [db-migrate.yml](.github/workflows/db-migrate.yml) | push `master`, chỉ khi `supabase/migrations/**` đổi | áp migration Supabase (có duyệt tay) |

### Migration flow (CÓ KIỂM SOÁT — bài học DB safety)

Áp SQL lên DB shared phải qua cổng người duyệt. Luồng:

```
sửa supabase/migrations/000N_*.sql → PR (CI gate) → merge master
   → workflow db-migrate.yml DỪNG chờ duyệt (environment production-db)
   → reviewer đọc DANH SÁCH migration từ bước `db push --dry-run` trong log → bấm Approve
   → migration được áp
```

- `db push --dry-run` **liệt kê các file migration** sẽ chạy — KHÔNG phải diff schema thật.
  Cơ chế an toàn chính là **cổng duyệt tay** `production-db`, không phải output dry-run.
- Workflow **không bao giờ** chạy trên PR — chỉ sau merge.
- Migration phải **reversible** (kèm comment rollback) + **idempotent** (`if exists` / `if not exists`) — giữ đúng quy ước file 0001–0003.
- TUYỆT ĐỐI không `DROP TABLE` / `TRUNCATE` / `DELETE` không `WHERE` trên DB thật.

#### ⚠️ Reconcile migration history (BẮT BUỘC trước lần `db push` đầu)

Migration 0001–0003 vốn được **paste tay** vào SQL Editor, nên bảng lịch sử migration của CLI
(`supabase_migrations.schema_migrations`) đang rỗng. Nếu bật workflow ngay, `db push` đầu tiên sẽ
**áp lại cả 3** lên DB thật. Cả 3 idempotent nên không phá dữ liệu, nhưng vẫn vi phạm nguyên tắc
"không chạy SQL chưa review lên DB shared". Baseline trước:

```bash
supabase link --project-ref <project-ref>
# Đánh dấu 3 migration đã áp sẵn (KHÔNG chạy lại SQL):
supabase migration repair --status applied 0001 0002 0003
supabase db push --dry-run    # phải hiện "no migrations to apply"
```

Sau bước này, workflow chỉ áp migration MỚI thêm sau đó.

### Cài đặt một lần (GitHub dashboard)
1. **Settings → Secrets and variables → Actions** — thêm 3 secret:
   - `SUPABASE_ACCESS_TOKEN` — personal access token (Supabase → Account → Access Tokens)
   - `SUPABASE_PROJECT_REF` — project ref (Supabase → Project Settings → General)
   - `SUPABASE_DB_PASSWORD` — mật khẩu Postgres của project
2. **Settings → Environments** — tạo environment `production-db`, bật **Required reviewers** (thêm ít nhất 1 người).
3. Sửa `project_id` trong [supabase/config.toml](supabase/config.toml) khớp với `SUPABASE_PROJECT_REF`.

> Test/lint hôm nay chỉ có ESLint. Vitest + Playwright đã có trong kế hoạch (xem CLAUDE.md) —
> khi cài, bỏ comment bước `Test` trong [ci.yml](.github/workflows/ci.yml).

---

## Thông báo Discord

Status deploy/CI đẩy vào Discord từ 2 nguồn:

### GitHub Actions (CI + migration)
Cả `ci.yml` và `db-migrate.yml` có bước `Notify Discord` (gửi embed qua webhook). Cài:
1. Discord: chuột phải channel → **Edit Channel → Integrations → Webhooks → New Webhook** → **Copy Webhook URL**.
2. GitHub: **Settings → Secrets and variables → Actions** → thêm secret `DISCORD_WEBHOOK_URL` = URL vừa copy.

Bước notify tự **skip êm** nếu chưa set secret (không làm đỏ CI). Báo cả pass lẫn fail; migration báo riêng vì đã áp lên DB thật.

### Vercel deploy status
Cài qua **Vercel Marketplace** (không cần code):
- Vercel dashboard → **Integrations → Browse Marketplace** → tìm **Discord** → **Add Integration** → dán webhook URL (dùng lại webhook trên hoặc tạo channel riêng).
- Vercel sẽ tự bắn thông báo khi deploy production/preview success/error.

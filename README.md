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
   → reviewer đọc diff từ bước `db push --dry-run` trong log → bấm Approve
   → migration được áp
```

- Workflow **không bao giờ** chạy trên PR — chỉ sau merge.
- Migration phải **reversible** (kèm comment rollback) + **idempotent** (`if exists` / `if not exists`) — giữ đúng quy ước file 0001–0003.
- TUYỆT ĐỐI không `DROP TABLE` / `TRUNCATE` / `DELETE` không `WHERE` trên DB thật.

### Cài đặt một lần (GitHub dashboard)
1. **Settings → Secrets and variables → Actions** — thêm 3 secret:
   - `SUPABASE_ACCESS_TOKEN` — personal access token (Supabase → Account → Access Tokens)
   - `SUPABASE_PROJECT_REF` — project ref (Supabase → Project Settings → General)
   - `SUPABASE_DB_PASSWORD` — mật khẩu Postgres của project
2. **Settings → Environments** — tạo environment `production-db`, bật **Required reviewers** (thêm ít nhất 1 người).
3. Sửa `project_id` trong [supabase/config.toml](supabase/config.toml) khớp với `SUPABASE_PROJECT_REF`.

> Test/lint hôm nay chỉ có ESLint. Vitest + Playwright đã có trong kế hoạch (xem CLAUDE.md) —
> khi cài, bỏ comment bước `Test` trong [ci.yml](.github/workflows/ci.yml).
